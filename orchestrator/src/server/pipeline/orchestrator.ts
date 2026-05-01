/**
 * Main pipeline logic - orchestrates the daily job processing flow.
 *
 * Flow:
 * 1. Run crawler to discover new jobs
 * 2. Score jobs for suitability
 * 3. Leave all jobs in "discovered" for manual processing
 */

import { join } from "node:path";
import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { createLocationIntentFromLegacyInputs } from "@shared/location-domain.js";
import type { PipelineConfig, PipelineRunSavedDetails } from "@shared/types";
import { getDataDir } from "../config/dataDir";
import * as jobsRepo from "../repositories/jobs";
import * as pipelineRepo from "../repositories/pipeline";
import * as settingsRepo from "../repositories/settings";
import { llmAdjustContent } from "../services/cv";
import { getActiveCvDocument } from "../services/cv-active";
import { generatePdf } from "../services/pdf";
import { progressHelpers, resetProgress } from "./progress";
import {
  buildPipelineRunSavedDetails,
  createPipelineRunResultSummary,
  updatePipelineRunResultSummary,
} from "./run-details";
import {
  ageJobsStep,
  discoverJobsStep,
  importJobsStep,
  loadBriefStep,
  processJobsStep,
  scoreJobsStep,
  selectJobsStep,
} from "./steps";

const DEFAULT_CONFIG: PipelineConfig = {
  topN: 10,
  minSuitabilityScore: 50,
  // Keep Glassdoor opt-in via source picker/settings; do not enable by default.
  sources: ["indeed", "linkedin"],
  outputDir: join(getDataDir(), "pdfs"),
  enableCrawling: true,
  enableScoring: true,
  enableImporting: true,
  enableAutoTailoring: false,
};

async function resolveAutoTailoring(
  configValue: boolean | undefined,
): Promise<boolean> {
  if (typeof configValue === "boolean") return configValue;
  const raw = await settingsRepo.getSetting("autoTailoringEnabled");
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return false;
}

async function resolveInboxAgeoutDays(): Promise<number> {
  const raw = await settingsRepo.getSetting("inboxAgeoutThresholdDays");
  if (raw === null) return 14;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? 14 : parsed;
}

// Track if pipeline is currently running
let isPipelineRunning = false;
let activePipelineRunId: string | null = null;
let cancelRequestedAt: string | null = null;

function parseWorkplaceTypes(
  raw: string | undefined,
): Array<"remote" | "hybrid" | "onsite"> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is "remote" | "hybrid" | "onsite" =>
        value === "remote" || value === "hybrid" || value === "onsite",
    );
  } catch {
    return [];
  }
}

async function resolveLocationIntent(
  config: Partial<PipelineConfig>,
): Promise<NonNullable<PipelineConfig["locationIntent"]>> {
  if (config.locationIntent) {
    return createLocationIntentFromLegacyInputs(config.locationIntent);
  }

  const settings = await settingsRepo.getAllSettings();
  return createLocationIntentFromLegacyInputs({
    selectedCountry: settings.jobspyCountryIndeed ?? "",
    searchCities: settings.searchCities ?? settings.jobspyLocation ?? "",
    workplaceTypes: parseWorkplaceTypes(settings.workplaceTypes),
    searchScope: settings.locationSearchScope,
    matchStrictness: settings.locationMatchStrictness,
  });
}

class PipelineCancelledError extends Error {
  constructor(message = "Pipeline cancellation requested") {
    super(message);
    this.name = "PipelineCancelledError";
  }
}

function ensureNotCancelled(): void {
  if (cancelRequestedAt) {
    throw new PipelineCancelledError();
  }
}

/**
 * Run the full job discovery and processing pipeline.
 */
export async function runPipeline(
  config: Partial<PipelineConfig> = {},
): Promise<{
  success: boolean;
  jobsDiscovered: number;
  jobsProcessed: number;
  error?: string;
}> {
  if (isPipelineRunning) {
    return {
      success: false,
      jobsDiscovered: 0,
      jobsProcessed: 0,
      error: "Pipeline is already running",
    };
  }

  isPipelineRunning = true;
  activePipelineRunId = "pending";
  cancelRequestedAt = null;
  resetProgress();
  const locationIntent = await resolveLocationIntent(config);
  const enableAutoTailoring = await resolveAutoTailoring(
    config.enableAutoTailoring,
  );
  const mergedConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    enableAutoTailoring,
    locationIntent,
  };
  const configSnapshot = {
    topN: mergedConfig.topN,
    minSuitabilityScore: mergedConfig.minSuitabilityScore,
    sources: mergedConfig.sources,
    locationIntent,
  } as const;

  let savedDetails: PipelineRunSavedDetails | null = null;
  try {
    savedDetails = await buildPipelineRunSavedDetails(mergedConfig);
  } catch (error) {
    logger.warn("Failed to capture pipeline run settings snapshot", { error });
  }

  const pipelineRun = await pipelineRepo.createPipelineRun({
    configSnapshot,
    savedDetails,
  });
  activePipelineRunId = pipelineRun.id;

  return runWithRequestContext({ pipelineRunId: pipelineRun.id }, async () => {
    const pipelineLogger = logger.child({ pipelineRunId: pipelineRun.id });
    let jobsDiscovered = 0;
    let jobsProcessed = 0;
    let resultSummary =
      savedDetails?.resultSummary ?? createPipelineRunResultSummary();
    const persistResultSummary = async (
      update: Parameters<typeof updatePipelineRunResultSummary>[1],
    ) => {
      resultSummary = updatePipelineRunResultSummary(resultSummary, update);
      await pipelineRepo.updatePipelineRun(pipelineRun.id, {
        resultSummary,
      });
    };
    pipelineLogger.info("Starting pipeline run", {
      topN: mergedConfig.topN,
      minSuitabilityScore: mergedConfig.minSuitabilityScore,
      sources: mergedConfig.sources,
      locationIntent: mergedConfig.locationIntent,
    });

    try {
      ensureNotCancelled();
      await persistResultSummary({ stage: "started" });
      const brief = await loadBriefStep();
      await persistResultSummary({ stage: "profile_loaded" });

      ensureNotCancelled();
      await persistResultSummary({ stage: "discovery" });
      const { discoveredJobs, sourceErrors } = await discoverJobsStep({
        mergedConfig,
        shouldCancel: () => cancelRequestedAt !== null,
      });
      await persistResultSummary({
        stage: "discovery",
        sourceErrors,
      });

      ensureNotCancelled();
      const { created, reposted } = await importJobsStep({ discoveredJobs });
      jobsDiscovered = created;

      await persistResultSummary({ stage: "import" });
      await pipelineRepo.updatePipelineRun(pipelineRun.id, {
        jobsDiscovered: created,
      });

      ensureNotCancelled();
      const ageoutDays = await resolveInboxAgeoutDays();
      const { moved: agedOut } = await ageJobsStep({ ageoutDays });
      pipelineLogger.info("Auto-aging completed", {
        ageoutDays,
        agedOut,
        reposted,
      });

      ensureNotCancelled();
      await persistResultSummary({ stage: "scoring" });
      const { scoredJobs } = await scoreJobsStep({
        brief,
        shouldCancel: () => cancelRequestedAt !== null,
      });
      await persistResultSummary({
        stage: "scoring",
        jobsScored: scoredJobs.length,
      });

      ensureNotCancelled();
      await persistResultSummary({ stage: "selection" });
      const jobsToProcess = await selectJobsStep({
        scoredJobs,
        mergedConfig,
      });
      await persistResultSummary({
        stage: "selection",
        jobsScored: scoredJobs.length,
        jobsSelected: jobsToProcess.length,
      });

      pipelineLogger.info("Selected jobs for processing", {
        candidates: jobsToProcess.length,
      });

      let processedCount = 0;
      if (mergedConfig.enableAutoTailoring) {
        await persistResultSummary({
          stage: "processing",
          jobsScored: scoredJobs.length,
          jobsSelected: jobsToProcess.length,
        });
        ({ processedCount } = await processJobsStep({
          jobsToProcess,
          processJob,
          shouldCancel: () => cancelRequestedAt !== null,
        }));
      } else {
        pipelineLogger.info(
          "Auto-tailoring disabled; skipping processing step",
          { jobsSelected: jobsToProcess.length },
        );
      }
      jobsProcessed = processedCount;

      resultSummary = updatePipelineRunResultSummary(resultSummary, {
        stage: "completed",
        jobsScored: scoredJobs.length,
        jobsSelected: jobsToProcess.length,
      });
      await pipelineRepo.updatePipelineRun(pipelineRun.id, {
        status: "completed",
        completedAt: new Date().toISOString(),
        jobsProcessed: processedCount,
        resultSummary,
      });

      progressHelpers.complete(created, processedCount);
      pipelineLogger.info("Pipeline run completed", {
        jobsDiscovered: created,
        jobsProcessed: processedCount,
      });

      return {
        success: true,
        jobsDiscovered: created,
        jobsProcessed: processedCount,
      };
    } catch (error) {
      if (error instanceof PipelineCancelledError) {
        const message = "Cancelled by user request";
        await pipelineRepo.updatePipelineRun(pipelineRun.id, {
          status: "cancelled",
          completedAt: new Date().toISOString(),
          jobsDiscovered,
          jobsProcessed,
          errorMessage: message,
          resultSummary,
        });
        progressHelpers.cancelled(message);
        pipelineLogger.info("Pipeline run cancelled", {
          jobsDiscovered,
          jobsProcessed,
        });
        return {
          success: false,
          jobsDiscovered,
          jobsProcessed,
          error: message,
        };
      }

      const message = error instanceof Error ? error.message : "Unknown error";

      await pipelineRepo.updatePipelineRun(pipelineRun.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage: message,
        resultSummary,
      });

      progressHelpers.failed(message);
      pipelineLogger.error("Pipeline run failed", error);

      return {
        success: false,
        jobsDiscovered,
        jobsProcessed,
        error: message,
      };
    } finally {
      isPipelineRunning = false;
      activePipelineRunId = null;
      cancelRequestedAt = null;
    }
  });
}

export type ProcessJobOptions = {
  force?: boolean;
  requestOrigin?: string | null;
};

/**
 * Step 1: Pin the active CV to this job, then run cv-adjust to populate
 * `tailoredFields` and the ATS sidecar columns. The override map and the
 * matched/skipped lists are stored in place; `generateFinalPdf` then renders
 * the CV with those overrides applied.
 */
export async function summarizeJob(
  jobId: string,
  _options?: ProcessJobOptions,
): Promise<{
  success: boolean;
  error?: string;
}> {
  return runWithRequestContext({ jobId }, async () => {
    const jobLogger = logger.child({ jobId });
    jobLogger.info("Pinning job to active CV");
    try {
      const job = await jobsRepo.getJobById(jobId);
      if (!job) return { success: false, error: "Job not found" };

      const cv = await getActiveCvDocument();
      if (!cv) {
        return {
          success: false,
          error: "No CV uploaded yet. Upload a LaTeX CV before tailoring.",
        };
      }

      const adjust = await llmAdjustContent({
        personalBrief: cv.personalBrief,
        jobDescription: job.jobDescription ?? "",
        currentFields: cv.fields,
        currentOverrides: {},
      });

      if (!adjust.success) {
        jobLogger.warn("cv-adjust failed; pinning CV with no overrides", {
          error: adjust.error,
        });
        await jobsRepo.updateJob(job.id, {
          cvDocumentId: cv.id,
          tailoredFields: {},
          tailoringMatched: [],
          tailoringSkipped: [],
        });
        return { success: true };
      }

      const fieldIds = new Set(cv.fields.map((field) => field.id));
      const overrides: Record<string, string> = {};
      for (const patch of adjust.patches) {
        if (fieldIds.has(patch.fieldId)) {
          overrides[patch.fieldId] = patch.newValue;
        }
      }

      await jobsRepo.updateJob(job.id, {
        cvDocumentId: cv.id,
        tailoredFields: overrides,
        tailoringMatched: adjust.matched,
        tailoringSkipped: adjust.skipped,
      });

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      jobLogger.error("Pinning failed", error);
      return { success: false, error: message };
    }
  });
}

/**
 * Step 2: Render the pinned CV through the verbatim overrides + Tectonic
 * pass to a PDF. Reads the job again so cv-adjust's tailoredFields are
 * picked up.
 */
export async function generateFinalPdf(
  jobId: string,
  _options?: ProcessJobOptions,
): Promise<{
  success: boolean;
  error?: string;
}> {
  return runWithRequestContext({ jobId }, async () => {
    const jobLogger = logger.child({ jobId });
    jobLogger.info("Generating final PDF");
    try {
      const job = await jobsRepo.getJobById(jobId);
      if (!job) return { success: false, error: "Job not found" };

      const cvDocumentId = job.cvDocumentId;
      if (!cvDocumentId) {
        return {
          success: false,
          error:
            "Job is not pinned to a CV document. Run summarizeJob first.",
        };
      }

      await jobsRepo.updateJob(job.id, { status: "processing" });

      const pdfResult = await generatePdf({
        jobId: job.id,
        cvDocumentId,
        overrides: job.tailoredFields,
      });

      if (!pdfResult.success) {
        await jobsRepo.updateJob(job.id, { status: "discovered" });
        return { success: false, error: pdfResult.error };
      }

      await jobsRepo.updateJob(job.id, {
        status: "ready",
        pdfPath: pdfResult.pdfPath,
      });

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      jobLogger.error("PDF generation failed", error);
      return { success: false, error: message };
    }
  });
}

/**
 * Process a single job (runs both steps in sequence).
 */
export async function processJob(
  jobId: string,
  options?: ProcessJobOptions,
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    // Step 1: Summarize & Select Projects
    const sumResult = await summarizeJob(jobId, options);
    if (!sumResult.success) return sumResult;

    // Step 2: Generate PDF
    const pdfResult = await generateFinalPdf(jobId, options);
    return pdfResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

/**
 * Check if pipeline is currently running.
 */
export function getPipelineStatus(): { isRunning: boolean } {
  return { isRunning: isPipelineRunning };
}

export function requestPipelineCancel(): {
  accepted: boolean;
  pipelineRunId: string | null;
  alreadyRequested: boolean;
} {
  if (!isPipelineRunning) {
    return { accepted: false, pipelineRunId: null, alreadyRequested: false };
  }

  const pipelineRunId =
    activePipelineRunId && activePipelineRunId !== "pending"
      ? activePipelineRunId
      : null;

  if (cancelRequestedAt) {
    return {
      accepted: true,
      pipelineRunId,
      alreadyRequested: true,
    };
  }

  cancelRequestedAt = new Date().toISOString();
  return {
    accepted: true,
    pipelineRunId,
    alreadyRequested: false,
  };
}

export function isPipelineCancelRequested(): boolean {
  return cancelRequestedAt !== null;
}
