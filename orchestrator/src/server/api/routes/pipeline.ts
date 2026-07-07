import {
  AppError,
  badRequest,
  conflict,
  notFound,
  requestTimeout,
  serviceUnavailable,
} from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { setupSse, startSseHeartbeat, writeSseData } from "@infra/sse";
import {
  type ExtractorRegistry,
  getExtractorRegistry,
} from "@server/extractors/registry";
import {
  getPipelineStatus,
  requestPipelineCancel,
  runPipeline,
  subscribeToProgress,
} from "@server/pipeline/index";
import { getRunJobs } from "@server/pipeline/run-job-capture";
import * as pipelineRepo from "@server/repositories/pipeline";
import { getProfile } from "@server/repositories/profiles";
import { getEnabledProviderInstances } from "@server/repositories/provider-instances";
import { getDefaultProfile } from "@server/services/profiles";
import {
  type ExtractorSourceId,
  PIPELINE_EXTRACTOR_SOURCE_IDS,
} from "@shared/extractors";
import {
  createLocationIntent,
  planLocationSources,
} from "@shared/location-intelligence.js";
import {
  LOCATION_MATCH_STRICTNESS_VALUES,
  LOCATION_SEARCH_SCOPE_VALUES,
} from "@shared/location-preferences.js";
import { deriveMaxJobsPerTerm } from "@shared/run-budget.js";
import { parseSearchCitiesSetting } from "@shared/search-cities.js";
import {
  type PipelineStatusResponse,
  RUN_JOB_BUCKETS,
  type RunJobsResponse,
  SUITABILITY_CATEGORIES,
} from "@shared/types";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const pipelineRouter = Router();
const WORKPLACE_TYPE_VALUES = ["remote", "hybrid", "onsite"] as const;

/**
 * GET /api/pipeline/status - Get pipeline status
 */
pipelineRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    const { isRunning } = getPipelineStatus();
    const lastRun = await pipelineRepo.getLatestPipelineRun();
    const data: PipelineStatusResponse = {
      isRunning,
      lastRun,
      nextScheduledRun: null,
    };
    ok(res, data);
  } catch (error) {
    fail(
      res,
      new AppError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  }
});

/**
 * GET /api/pipeline/progress - Server-Sent Events endpoint for live progress
 */
pipelineRouter.get("/progress", (req: Request, res: Response) => {
  setupSse(res, {
    cacheControl: "no-cache, no-transform",
    disableBuffering: true,
    flushHeaders: true,
  });

  // Send initial progress
  const sendProgress = (data: unknown) => {
    writeSseData(res, data);
  };

  // Subscribe to progress updates
  const unsubscribe = subscribeToProgress(sendProgress);

  // Send heartbeat every 30 seconds to keep connection alive
  const stopHeartbeat = startSseHeartbeat(res);

  // Cleanup on close
  req.on("close", () => {
    stopHeartbeat();
    unsubscribe();
  });
});

/**
 * GET /api/pipeline/runs - Get recent pipeline runs
 */
pipelineRouter.get("/runs", async (_req: Request, res: Response) => {
  try {
    const runs = await pipelineRepo.getRecentPipelineRuns(20);
    ok(res, runs);
  } catch (error) {
    fail(
      res,
      new AppError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  }
});

const runJobsQuerySchema = z.object({
  source: z.string().min(1),
  bucket: z.enum(
    RUN_JOB_BUCKETS as [
      (typeof RUN_JOB_BUCKETS)[number],
      ...(typeof RUN_JOB_BUCKETS)[number][],
    ],
  ),
});

/**
 * GET /api/pipeline/run-jobs - jobs behind a per-source funnel count for the
 * current run (captured in-memory; resets when the next run starts).
 */
pipelineRouter.get("/run-jobs", (req: Request, res: Response) => {
  try {
    const { source, bucket } = runJobsQuerySchema.parse(req.query);
    const response: RunJobsResponse = {
      source,
      bucket,
      jobs: getRunJobs(source, bucket),
    };
    ok(res, response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    fail(
      res,
      new AppError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  }
});

/**
 * GET /api/pipeline/runs/:id/insights - Get exact and inferred metrics for a run
 */
pipelineRouter.get(
  "/runs/:id/insights",
  async (req: Request, res: Response) => {
    try {
      const insights = await pipelineRepo.getPipelineRunInsights(req.params.id);
      if (!insights) {
        return fail(res, notFound("Pipeline run not found"));
      }
      ok(res, insights);
    } catch (error) {
      fail(
        res,
        new AppError({
          status: 500,
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    }
  },
);

/**
 * POST /api/pipeline/run - Trigger the pipeline manually
 */
const runPipelineSchema = z.object({
  topN: z.number().min(1).max(50).optional(),
  minSuitabilityCategory: z.enum(SUITABILITY_CATEGORIES).optional(),
  // An empty array is meaningful: "run no built-in extractors" (used by a
  // provider-instance-only re-run). `undefined` = all enabled extractors.
  sources: z
    .array(
      z.enum(
        PIPELINE_EXTRACTOR_SOURCE_IDS as [
          (typeof PIPELINE_EXTRACTOR_SOURCE_IDS)[number],
          ...(typeof PIPELINE_EXTRACTOR_SOURCE_IDS)[number][],
        ],
      ),
    )
    .optional(),
  // Marketplace provider instance ids to scope the run to. `undefined` = all
  // enabled instances; `[]` = none; a list = only those instances.
  providerInstanceIds: z.array(z.string().min(1)).optional(),
  maxJobsPerTerm: z.number().int().min(1).max(10_000).optional(),
  searchTerms: z.array(z.string().trim().min(1)).optional(),
  country: z.string().trim().optional(),
  cityLocations: z.array(z.string().trim().min(1)).optional(),
  workplaceTypes: z
    .array(z.enum(WORKPLACE_TYPE_VALUES))
    .min(1)
    .max(3)
    .optional(),
  searchScope: z.enum(LOCATION_SEARCH_SCOPE_VALUES).optional(),
  matchStrictness: z.enum(LOCATION_MATCH_STRICTNESS_VALUES).optional(),
  enableAutoTailoring: z.boolean().optional(),
  // Per-source re-run: reconcile the scoped sources into the existing banner
  // funnel instead of resetting every source's results.
  partial: z.boolean().optional(),
  // Resolve the run's scrape config from this Profile. Body fields still win
  // per-field (one-off overrides); absent → the default Profile.
  profileId: z.string().min(1).optional(),
});

pipelineRouter.post("/run", async (req: Request, res: Response) => {
  try {
    const body = runPipelineSchema.parse(req.body);

    // Resolve the Profile that backs this run: an explicit id (404 if missing),
    // else the default Profile. A null default (pre-seed only) means the run is
    // driven from the body alone — today's behavior. Every scrape field below
    // resolves `body.X ?? profile.config.X`, so a one-off body override wins
    // per-field without persisting to the Profile.
    let profile: Awaited<ReturnType<typeof getProfile>> = null;
    if (body.profileId) {
      profile = await getProfile(body.profileId);
      if (!profile) {
        return fail(res, notFound(`Profile not found: ${body.profileId}`));
      }
    } else {
      profile = await getDefaultProfile();
    }
    const profileConfig = profile?.config ?? null;

    let cachedRegistry: ExtractorRegistry | null = null;
    let registryFailed = false;
    const loadRegistry = async (): Promise<ExtractorRegistry | null> => {
      if (cachedRegistry) return cachedRegistry;
      if (registryFailed) return null;
      try {
        cachedRegistry = await getExtractorRegistry();
        return cachedRegistry;
      } catch (error) {
        registryFailed = true;
        logger.error("Extractor registry unavailable during run assembly", {
          route: "/api/pipeline/run",
          error,
        });
        return null;
      }
    };

    const resolvedSearchTerms = body.searchTerms ?? profileConfig?.searchTerms;
    const resolvedProviderInstanceIds =
      body.providerInstanceIds ?? profileConfig?.providerInstanceIds;

    const locationIntent = createLocationIntent({
      selectedCountry: body.country ?? profileConfig?.searchCountry,
      cityLocations:
        body.cityLocations ??
        (profileConfig
          ? parseSearchCitiesSetting(profileConfig.searchCities)
          : undefined),
      workplaceTypes: body.workplaceTypes ?? profileConfig?.workplaceTypes,
      geoScope: body.searchScope ?? profileConfig?.locationSearchScope,
      matchStrictness:
        body.matchStrictness ?? profileConfig?.locationMatchStrictness,
    });

    // Sources: a body list wins verbatim (including `[]` = "no built-in
    // extractors"). Otherwise expand the Profile's pinned extractor ids to
    // their platform ids via the registry. No profile / empty pin → leave
    // undefined so discovery uses all enabled extractors, or `[]` respectively.
    let resolvedSources: ExtractorSourceId[] | undefined;
    if (body.sources !== undefined) {
      resolvedSources = body.sources;
    } else if (profileConfig && profileConfig.enabledSourceIds.length > 0) {
      const registry = await loadRegistry();
      if (!registry) {
        return fail(
          res,
          serviceUnavailable(
            "Extractor registry is unavailable. Try again after fixing startup errors.",
          ),
        );
      }
      const pinned = new Set(profileConfig.enabledSourceIds);
      resolvedSources = Array.from(registry.manifestBySource.entries())
        .filter(([, manifest]) => pinned.has(manifest.id))
        .map(([platform]) => platform);
    }

    // Body-provided sources are validated (unknown → 400, incompatible with the
    // resolved location intent → 400). Profile-derived sources are NOT gated
    // here — discovery skips incompatible ones rather than failing the run.
    if (body.sources && body.sources.length > 0) {
      const registry = await loadRegistry();
      if (!registry) {
        return fail(
          res,
          serviceUnavailable(
            "Extractor registry is unavailable. Try again after fixing startup errors.",
          ),
        );
      }
      const unavailableSources = body.sources.filter(
        (source) => !registry.manifestBySource.has(source),
      );
      if (unavailableSources.length > 0) {
        return fail(
          res,
          badRequest(
            `Requested sources are not available at runtime: ${unavailableSources.join(", ")}`,
            { unavailableSources },
          ),
        );
      }

      const sourcePlans = planLocationSources({
        intent: locationIntent,
        sources: body.sources,
      });
      if (sourcePlans.incompatibleSources.length > 0) {
        const incompatible = sourcePlans.plans
          .filter((plan) => !plan.isCompatible)
          .map((plan) => ({
            source: plan.source,
            reasons: plan.reasons,
          }));

        return fail(
          res,
          badRequest(
            "Requested sources are incompatible with the selected location setup",
            { incompatibleSources: incompatible },
          ),
        );
      }
    }

    if (body.providerInstanceIds && body.providerInstanceIds.length > 0) {
      const enabledInstances = await getEnabledProviderInstances();
      const enabledIds = new Set(enabledInstances.map((row) => row.id));
      const unknownInstanceIds = body.providerInstanceIds.filter(
        (id) => !enabledIds.has(id),
      );
      if (unknownInstanceIds.length > 0) {
        return fail(
          res,
          badRequest(
            `Requested provider instances are not enabled or do not exist: ${unknownInstanceIds.join(", ")}`,
            { unknownInstanceIds },
          ),
        );
      }
    }

    // maxJobsPerTerm: a body value wins; otherwise derive it from the Profile's
    // run budget spread across the run's compatible extractor sources × terms
    // (provider instances excluded from the divisor, mirroring the client).
    let resolvedMaxJobsPerTerm = body.maxJobsPerTerm;
    if (resolvedMaxJobsPerTerm === undefined && profileConfig) {
      const compatibleSourceCount = resolvedSources
        ? planLocationSources({
            intent: locationIntent,
            sources: resolvedSources,
          }).compatibleSources.length
        : 0;
      resolvedMaxJobsPerTerm = deriveMaxJobsPerTerm({
        budget: profileConfig.runBudget,
        termCount: (resolvedSearchTerms ?? []).length,
        sourceCount: compatibleSourceCount,
      });
    }

    // Start pipeline in background
    runWithRequestContext({}, () => {
      runPipeline({
        topN: body.topN ?? profileConfig?.topN,
        minSuitabilityCategory:
          body.minSuitabilityCategory ?? profileConfig?.minSuitabilityCategory,
        sources: resolvedSources,
        providerInstanceIds: resolvedProviderInstanceIds,
        maxJobsPerTerm: resolvedMaxJobsPerTerm,
        searchTerms: resolvedSearchTerms,
        scrapeMaxAgeDays: profileConfig?.scrapeMaxAgeDays,
        blockedCompanyKeywords: profileConfig?.blockedCompanyKeywords,
        locationIntent,
        enableAutoTailoring: body.enableAutoTailoring,
        partial: body.partial,
      }).catch((error) => {
        logger.error("Background pipeline run failed", error);
      });
    });
    ok(res, { message: "Pipeline started" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    if (error instanceof Error && error.name === "AbortError") {
      return fail(res, requestTimeout("Request timed out"));
    }
    fail(
      res,
      new AppError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  }
});

/**
 * POST /api/pipeline/cancel - Request cancellation of active pipeline run
 */
pipelineRouter.post("/cancel", async (_req: Request, res: Response) => {
  try {
    const cancelResult = requestPipelineCancel();
    if (!cancelResult.accepted) {
      return fail(res, conflict("No running pipeline to cancel"));
    }

    logger.info("Pipeline cancellation requested", {
      route: "/api/pipeline/cancel",
      action: "cancel",
      status: "accepted",
      pipelineRunId: cancelResult.pipelineRunId,
      alreadyRequested: cancelResult.alreadyRequested,
    });

    ok(res, {
      message: cancelResult.alreadyRequested
        ? "Pipeline cancellation already requested"
        : "Pipeline cancellation requested",
      pipelineRunId: cancelResult.pipelineRunId,
      alreadyRequested: cancelResult.alreadyRequested,
    });
  } catch (error) {
    fail(
      res,
      new AppError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
  }
});
