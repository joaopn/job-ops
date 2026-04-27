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

const MAX_JOB_DESCRIPTION = 4000;
const MAX_BRIEF_SNAPSHOT = 6000;
const MAX_TEMPLATE_SNAPSHOT = 3000;
const MAX_TAILORED_CONTENT = 6000;
const MAX_COVER_LETTER = 8000;

function truncate(value: string | null | undefined, max: number): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}...`;
}

function buildJobSnapshot(job: Job): string {
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
      suitabilityScore: job.suitabilityScore,
      suitabilityReason: truncate(job.suitabilityReason, 600),
      jobDescription: truncate(job.jobDescription, MAX_JOB_DESCRIPTION),
    },
  };

  return JSON.stringify(snapshot, null, 2);
}

function buildBriefSnapshot(brief: string): string {
  return truncate(brief, MAX_BRIEF_SNAPSHOT);
}

function buildCvSnapshot(job: Job, cv: CvDocument | null): string {
  const tailoredContentJson = job.tailoredContent
    ? truncate(JSON.stringify(job.tailoredContent, null, 2), MAX_TAILORED_CONTENT)
    : null;

  const snapshot = {
    cv: cv
      ? {
          id: cv.id,
          name: cv.name,
          template: truncate(cv.template, MAX_TEMPLATE_SNAPSHOT),
        }
      : null,
    tailoredContent: tailoredContentJson,
    ats: {
      matched: job.tailoringMatched ?? [],
      skipped: job.tailoringSkipped ?? [],
    },
  };

  return JSON.stringify(snapshot, null, 2);
}

function buildCoverLetterSnapshot(job: Job): string {
  return truncate(job.coverLetterDraft, MAX_COVER_LETTER);
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
