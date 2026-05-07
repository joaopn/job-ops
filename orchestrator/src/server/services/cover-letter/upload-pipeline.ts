import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import {
  FlattenInputError,
  flattenInput,
} from "@server/services/cv/flatten-input";
import type { TemplateExtractPreviousAttempt } from "@server/services/cv/llm-template-extract";
import { pdftotextDiff } from "@server/services/cv/pdftotext-diff";
import {
  RenderTemplateError,
  renderTemplate,
} from "@server/services/cv/render-template";
import {
  RunTectonicError,
  runTectonic,
} from "@server/services/cv/run-tectonic";
import type {
  CvField,
  CvFieldOverrides,
  CvUploadPipelineAttempt,
} from "@shared/types";
import {
  CoverLetterTemplateExtractError,
  llmCoverLetterTemplateExtract,
} from "./llm-template-extract";

const DEFAULT_MAX_RETRIES = 3;

/**
 * 5h cover-letter upload pipeline. Mirrors the 5e CV pipeline:
 *
 *   1. flatten — resolve `\input{}`, gather assets. Cover-letter entrypoint
 *      priority (`coverletter.tex`, `cover-letter.tex`, `letter.tex`,
 *      `cover.tex`).
 *   2. compile-original — tectonic on the source. Failure here is "your
 *      cover letter doesn't compile" — reject before burning any LLM credit.
 *   3. extract-loop — N attempts (default 3) of:
 *        a. LLM template-extract (with previous-attempt context on retry).
 *           Validates exactly one extracted field has `role: "body"`.
 *        b. renderTemplate(templatedTex, defaultFieldValues).
 *        c. tectonic on the substituted output.
 *        d. pdftotextDiff(originalPdf, substitutedPdf) — strict zero-diff.
 *      First all-pass attempt accepts. Loop exhaustion rejects.
 *
 * Caller persists the artefacts on success or surfaces the attempt log on
 * failure.
 */

const COVER_LETTER_ENTRYPOINT_PRIORITY = [
  "coverletter.tex",
  "cover-letter.tex",
  "letter.tex",
  "cover.tex",
] as const;

export interface CoverLetterUploadPipelineArgs {
  archive: Uint8Array;
  filename: string;
  maxRetries?: number;
  extractionPrompt?: string;
}

export type CoverLetterUploadPipelineAttempt = CvUploadPipelineAttempt;

export type CoverLetterUploadPipelineResult =
  | CoverLetterUploadPipelineSuccess
  | CoverLetterUploadPipelineFailure;

export interface CoverLetterUploadPipelineSuccess {
  ok: true;
  flattenedTex: string;
  templatedTex: string;
  fields: CvField[];
  defaultFieldValues: CvFieldOverrides;
  bodyFieldId: string;
  assetReferences: string[];
  pdf: Uint8Array;
  compileStderr: string;
  compileAttempts: number;
  attempts: CoverLetterUploadPipelineAttempt[];
}

export interface CoverLetterUploadPipelineFailure {
  ok: false;
  stage: "flatten" | "compile-original" | "extract-loop";
  message: string;
  flattenCode?: string;
  originalCompileStderr?: string;
  attempts?: CoverLetterUploadPipelineAttempt[];
}

export async function runCoverLetterUploadPipeline(
  args: CoverLetterUploadPipelineArgs,
): Promise<CoverLetterUploadPipelineResult> {
  const maxRetries = clampRetries(args.maxRetries ?? DEFAULT_MAX_RETRIES);

  // Stage 1: flatten.
  let flattened: ReturnType<typeof flattenInput>;
  try {
    flattened = flattenInput({
      archive: args.archive,
      filename: args.filename,
      entrypointPriority: COVER_LETTER_ENTRYPOINT_PRIORITY,
    });
  } catch (error) {
    if (error instanceof FlattenInputError) {
      logger.warn("Cover-letter upload rejected at flatten stage", {
        code: error.code,
        message: error.message,
      });
      return {
        ok: false,
        stage: "flatten",
        message: error.message,
        flattenCode: error.code,
      };
    }
    throw error;
  }

  // Stage 2: compile original.
  let originalPdf: Uint8Array;
  try {
    const result = await runTectonic({
      renderedTex: flattened.flattenedTex,
      archive: args.archive,
      entrypoint: flattened.entrypoint,
    });
    originalPdf = result.pdf;
  } catch (error) {
    if (error instanceof RunTectonicError) {
      logger.warn(
        "Cover-letter upload rejected — original tex does not compile",
        {
          code: error.code,
          stderrTail: error.stderr.slice(-500),
        },
      );
      return {
        ok: false,
        stage: "compile-original",
        message: `Your cover letter's source LaTeX did not compile: ${error.message}`,
        originalCompileStderr: error.stderr,
      };
    }
    throw error;
  }

  // Stage 3: extract loop.
  const attempts: CoverLetterUploadPipelineAttempt[] = [];
  let previousForRetry: TemplateExtractPreviousAttempt | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await runOneAttempt({
      attemptNumber: attempt,
      flattened,
      originalPdf,
      archive: args.archive,
      extractionPrompt: args.extractionPrompt,
      previousAttempt: previousForRetry,
    });
    attempts.push(result.record);

    if (result.kind === "success") {
      logger.info("Cover-letter upload pipeline accepted", {
        attempts: attempt,
        fieldCount: result.fields.length,
      });
      const defaultFieldValues = fieldsToOverrides(result.fields);
      return {
        ok: true,
        flattenedTex: flattened.flattenedTex,
        templatedTex: result.templatedTex,
        fields: result.fields,
        defaultFieldValues,
        bodyFieldId: result.bodyFieldId,
        assetReferences: flattened.assetReferences,
        pdf: result.pdf,
        compileStderr: result.compileStderr,
        compileAttempts: attempt,
        attempts,
      };
    }

    previousForRetry = result.previousForRetry;
  }

  logger.warn("Cover-letter upload pipeline exhausted retries", {
    attempts: maxRetries,
    lastFailure: sanitizeUnknown(attempts[attempts.length - 1]?.failureMessage),
  });
  return {
    ok: false,
    stage: "extract-loop",
    message: `Failed to produce a valid template after ${maxRetries} attempts. The most recent failure was: ${attempts[attempts.length - 1]?.failureMessage ?? "unknown"}.`,
    attempts,
  };
}

type AttemptOutcome =
  | {
      kind: "success";
      record: CoverLetterUploadPipelineAttempt;
      templatedTex: string;
      fields: CvField[];
      bodyFieldId: string;
      pdf: Uint8Array;
      compileStderr: string;
    }
  | {
      kind: "failure";
      record: CoverLetterUploadPipelineAttempt;
      previousForRetry: TemplateExtractPreviousAttempt | undefined;
    };

async function runOneAttempt(input: {
  attemptNumber: number;
  flattened: ReturnType<typeof flattenInput>;
  originalPdf: Uint8Array;
  archive: Uint8Array;
  extractionPrompt: string | undefined;
  previousAttempt: TemplateExtractPreviousAttempt | undefined;
}): Promise<AttemptOutcome> {
  const {
    attemptNumber,
    flattened,
    originalPdf,
    archive,
    extractionPrompt,
    previousAttempt,
  } = input;

  // 3a. LLM template-extract. Body-count validation is enforced inside
  // the extractor.
  let extracted: Awaited<ReturnType<typeof llmCoverLetterTemplateExtract>>;
  try {
    extracted = await llmCoverLetterTemplateExtract({
      flattenedTex: flattened.flattenedTex,
      assetReferences: flattened.assetReferences,
      extractionPrompt,
      previousAttempt,
    });
  } catch (error) {
    const message =
      error instanceof CoverLetterTemplateExtractError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      kind: "failure",
      record: {
        attempt: attemptNumber,
        templatedTex: "",
        fields: [],
        failureKind: "llm",
        failureMessage: message,
        compileStderr: null,
        contentDiff: null,
      },
      previousForRetry: undefined,
    };
  }

  const defaultFieldValues = fieldsToOverrides(extracted.fields);

  // 3b. Substitute markers.
  let renderedTex: string;
  try {
    renderedTex = renderTemplate(extracted.templatedTex, defaultFieldValues);
  } catch (error) {
    const message =
      error instanceof RenderTemplateError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      kind: "failure",
      record: {
        attempt: attemptNumber,
        templatedTex: extracted.templatedTex,
        fields: extracted.fields,
        failureKind: "render",
        failureMessage: message,
        compileStderr: null,
        contentDiff: null,
      },
      previousForRetry: {
        templatedTex: extracted.templatedTex,
        fields: extracted.fields,
        failureKind: "compile",
        compileStderr: message,
      },
    };
  }

  // 3c. Compile substituted tex.
  let templatedPdf: Uint8Array;
  let templatedStderr: string;
  try {
    const result = await runTectonic({
      renderedTex,
      archive,
      entrypoint: flattened.entrypoint,
    });
    templatedPdf = result.pdf;
    templatedStderr = result.log;
  } catch (error) {
    const stderr =
      error instanceof RunTectonicError ? error.stderr : String(error);
    const message =
      error instanceof Error ? error.message : String(error);
    return {
      kind: "failure",
      record: {
        attempt: attemptNumber,
        templatedTex: extracted.templatedTex,
        fields: extracted.fields,
        failureKind: "compile",
        failureMessage: message,
        compileStderr: stderr,
        contentDiff: null,
      },
      previousForRetry: {
        templatedTex: extracted.templatedTex,
        fields: extracted.fields,
        failureKind: "compile",
        compileStderr: stderr,
      },
    };
  }

  // 3d. Content equivalence.
  const diff = await pdftotextDiff({
    original: originalPdf,
    candidate: templatedPdf,
  });
  if (!diff.ok) {
    return {
      kind: "failure",
      record: {
        attempt: attemptNumber,
        templatedTex: extracted.templatedTex,
        fields: extracted.fields,
        failureKind: "content-diff",
        failureMessage: `Substituted PDF text diverges from original by ${diff.divergentLines} line(s).`,
        compileStderr: templatedStderr,
        contentDiff: diff.diff,
      },
      previousForRetry: {
        templatedTex: extracted.templatedTex,
        fields: extracted.fields,
        failureKind: "content-diff",
        contentDiff: diff.diff,
      },
    };
  }

  return {
    kind: "success",
    record: {
      attempt: attemptNumber,
      templatedTex: extracted.templatedTex,
      fields: extracted.fields,
      failureKind: null,
      failureMessage: null,
      compileStderr: templatedStderr,
      contentDiff: null,
    },
    templatedTex: extracted.templatedTex,
    fields: extracted.fields,
    bodyFieldId: extracted.bodyFieldId,
    pdf: templatedPdf,
    compileStderr: templatedStderr,
  };
}

function fieldsToOverrides(fields: CvField[]): CvFieldOverrides {
  const out: CvFieldOverrides = {};
  for (const field of fields) out[field.id] = field.value;
  return out;
}

function clampRetries(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  if (value > 10) return 10;
  return Math.floor(value);
}
