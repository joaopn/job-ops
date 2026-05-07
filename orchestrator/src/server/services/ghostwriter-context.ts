import { badRequest, notFound } from "@infra/errors";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import type { CvDocument, Job } from "@shared/types";
import * as jobsRepo from "../repositories/jobs";
import { getActiveCvDocument } from "./cv-active";
import {
  getWritingLanguageLabel,
  resolveWritingOutputLanguage,
} from "./output-language";
import { loadPrompt } from "./prompts";
import {
  getWritingStyle,
  stripLanguageDirectivesFromConstraints,
  type WritingStyle,
} from "./writing-style";

export type JobChatPromptContext = {
  job: Job;
  cv: CvDocument | null;
  style: WritingStyle;
  systemPrompt: string;
  jobSnapshot: string;
  briefSnapshot: string;
  cvSnapshot: string;
  coverLetterSnapshot: string;
};

/**
 * Hard cap on `suitabilityReason` length. The scorer prompt asks for "1-2
 * sentences" — a value past this is a sign of a regression (LLM ignoring
 * the constraint), not a user-input limit. Fail loud rather than silently
 * truncate so the bug surfaces.
 */
const SUITABILITY_REASON_HARD_CAP = 4000;

function buildJobSnapshot(job: Job): string {
  if (
    job.suitabilityReason &&
    job.suitabilityReason.length > SUITABILITY_REASON_HARD_CAP
  ) {
    throw new Error(
      `suitabilityReason length ${job.suitabilityReason.length} exceeds the ${SUITABILITY_REASON_HARD_CAP}-char hard cap (regression detector — the scorer should emit 1-2 sentences).`,
    );
  }

  const snapshot = {
    event: "job.completed",
    sentAt: new Date().toISOString(),
    job: {
      id: job.id,
      source: job.source,
      title: job.title,
      employer: job.employer,
      location: job.location,
      salary: job.salary,
      status: job.status,
      jobUrl: job.jobUrl,
      applicationLink: job.applicationLink,
      suitabilityCategory: job.suitabilityCategory,
      suitabilityReason: job.suitabilityReason ?? "",
      jobDescription: job.jobDescription ?? "",
    },
  };

  return JSON.stringify(snapshot, null, 2);
}

function buildBriefSnapshot(brief: string): string {
  return brief.trim();
}

function buildCvSnapshot(job: Job, cv: CvDocument | null): string {
  const fields = cv?.fields ?? [];
  const overrides = job.tailoredFields ?? {};

  // Render each field with its CURRENT value (override or original).
  const fieldsView = fields.map((field) => ({
    id: field.id,
    role: field.role,
    value: overrides[field.id] ?? field.value,
    overridden: Object.hasOwn(overrides, field.id),
  }));

  const snapshot = {
    cv: cv
      ? {
          id: cv.id,
          name: cv.name,
        }
      : null,
    fields: fieldsView,
    ats: {
      matched: job.tailoringMatched ?? [],
      skipped: job.tailoringSkipped ?? [],
    },
  };

  return JSON.stringify(snapshot, null, 2);
}

function buildCoverLetterSnapshot(job: Job): string {
  return (job.coverLetterDraft ?? "").trim();
}

async function buildSystemPrompt(
  style: WritingStyle,
  brief: string,
): Promise<string> {
  const resolvedLanguage = resolveWritingOutputLanguage({
    style,
    sample: brief,
  });
  const outputLanguage = getWritingLanguageLabel(resolvedLanguage.language);
  const effectiveConstraints = stripLanguageDirectivesFromConstraints(
    style.constraints,
  );

  const loaded = await loadPrompt("ghostwriter-system", {
    outputLanguage,
    tone: style.tone,
    formality: style.formality,
    constraintsSentence: effectiveConstraints
      ? `Writing constraints: ${effectiveConstraints}`
      : "",
    avoidTermsSentence: style.doNotUse
      ? `Avoid these terms: ${style.doNotUse}`
      : "",
  });
  return loaded.system;
}

export async function buildJobChatPromptContext(
  jobId: string,
): Promise<JobChatPromptContext> {
  const job = await jobsRepo.getJobById(jobId);
  if (!job) {
    throw notFound("Job not found");
  }

  const style = await getWritingStyle();

  let cv: CvDocument | null = null;
  try {
    cv = await getActiveCvDocument();
  } catch (error) {
    logger.warn("Failed to load active CV for job chat context", {
      jobId,
      error: sanitizeUnknown(error),
    });
  }

  const brief = cv?.personalBrief?.trim() ?? "";
  const briefSnapshot = buildBriefSnapshot(brief);
  const cvSnapshot = buildCvSnapshot(job, cv);
  const coverLetterSnapshot = buildCoverLetterSnapshot(job);
  const systemPrompt = await buildSystemPrompt(style, brief);
  const jobSnapshot = buildJobSnapshot(job);

  if (!jobSnapshot.trim()) {
    throw badRequest("Unable to build job context");
  }

  logger.info("Built job chat context", {
    jobId,
    includesBrief: Boolean(briefSnapshot),
    includesCv: Boolean(cv),
    includesCoverLetter: Boolean(coverLetterSnapshot),
    contextStats: sanitizeUnknown({
      systemChars: systemPrompt.length,
      jobChars: jobSnapshot.length,
      briefChars: briefSnapshot.length,
      cvChars: cvSnapshot.length,
      coverLetterChars: coverLetterSnapshot.length,
    }),
  });

  return {
    job,
    cv,
    style,
    systemPrompt,
    jobSnapshot,
    briefSnapshot,
    cvSnapshot,
    coverLetterSnapshot,
  };
}
