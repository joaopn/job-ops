import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import type {
  CvField,
  CvFieldOverrides,
  CvUploadPipelineAttempt,
} from "@shared/types";
import { FlattenInputError, flattenInput } from "./flatten-input";
import {
  llmTemplateExtract,
  TemplateExtractError,
  type TemplateExtractPreviousAttempt,
} from "./llm-template-extract";
import { pdftotextDiff } from "./pdftotext-diff";
import { renderTemplate, RenderTemplateError } from "./render-template";
import { RunTectonicError, runTectonic } from "./run-tectonic";

const DEFAULT_MAX_RETRIES = 3;

/**
 * 5e CV upload pipeline. Honors the design invariant in
 * `.claude/CLAUDE.md`: a CV upload is accepted only when (a) the templated
 * tex compiles, (b) the substituted-PDF's text matches the original PDF's
 * text. No partial pass states, no drop-and-continue.
 *
 * Stages:
 *   1. flatten — resolve `\input{}`, gather assets.
 *   2. compile-original — tectonic on the source. Failure here is "your CV
 *      doesn't compile" — reject before burning any LLM credit.
 *   3. extract-loop — N attempts (default 3) of:
 *        a. LLM template-extract (with previous-attempt context on retry).
 *        b. renderTemplate(templatedTex, defaultFieldValues).
 *        c. tectonic on the substituted output.
 *        d. pdftotextDiff(originalPdf, substitutedPdf) — strict zero-diff.
 *      First all-pass attempt accepts. Loop exhaustion rejects.
 *
 * Caller persists the artefacts on success or surfaces the attempt log on
 * failure.
 */

export interface UploadPipelineArgs {
  archive: Uint8Array;
  filename: string;
  /** Default 3. Capped at runtime to keep extraction bounded. */
  maxRetries?: number;
  /**
   * 5e.3a per-CV system-prompt override. Empty / undefined → use the
   * server's YAML default. When provided, replaces the system prompt for
   * every retry attempt.
   */
  extractionPrompt?: string;
  /** Optional override for the expanded-LaTeX byte cap; sourced from settings. */
  maxExpandedBytes?: number;
}

/**
 * Server-side alias for the shared `CvUploadPipelineAttempt` shape. Kept
 * as a re-export so call sites inside the server can keep using the
 * shorter name without the shared/ prefix in every signature.
 */
export type UploadPipelineAttempt = CvUploadPipelineAttempt;

export type UploadPipelineResult =
  | UploadPipelineSuccess
  | UploadPipelineFailure;

export interface UploadPipelineSuccess {
  ok: true;
  flattenedTex: string;
  templatedTex: string;
  fields: CvField[];
  defaultFieldValues: CvFieldOverrides;
  personalBrief: string;
  assetReferences: string[];
  /** Substituted PDF (last successful tectonic output). Caller may persist. */
  pdf: Uint8Array;
  /** Tectonic stderr from the accepted attempt. Persist for the log viewer. */
  compileStderr: string;
  /** How many template-extract attempts the upload took (1-indexed). */
  compileAttempts: number;
  /** Attempt log for observability / UI display. */
  attempts: UploadPipelineAttempt[];
}

export interface UploadPipelineFailure {
  ok: false;
  /** Where in the pipeline we gave up. */
  stage: "flatten" | "compile-original" | "extract-loop";
  message: string;
  /** Set when stage = "flatten" — the FlattenInputError code. */
  flattenCode?: string;
  /** Set when stage = "compile-original" — tectonic stderr. */
  originalCompileStderr?: string;
  /** Set when stage = "extract-loop" — full attempt log. */
  attempts?: UploadPipelineAttempt[];
}

export async function runUploadPipeline(
  args: UploadPipelineArgs,
): Promise<UploadPipelineResult> {
  const maxRetries = clampRetries(args.maxRetries ?? DEFAULT_MAX_RETRIES);

  // Stage 1: flatten.
  let flattened: ReturnType<typeof flattenInput>;
  try {
    flattened = flattenInput({
      archive: args.archive,
      filename: args.filename,
      maxExpandedBytes: args.maxExpandedBytes,
    });
  } catch (error) {
    if (error instanceof FlattenInputError) {
      logger.warn("CV upload rejected at flatten stage", {
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

  // Stage 2: compile original. Reject before any LLM call if the user's
  // own CV is broken.
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
      logger.warn("CV upload rejected — original tex does not compile", {
        code: error.code,
        stderrTail: error.stderr.slice(-500),
      });
      return {
        ok: false,
        stage: "compile-original",
        message: `Your CV's source LaTeX did not compile: ${error.message}`,
        originalCompileStderr: error.stderr,
      };
    }
    throw error;
  }

  // Stage 3: extract loop.
  const attempts: UploadPipelineAttempt[] = [];
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
      logger.info("CV upload pipeline accepted", {
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
        personalBrief: result.personalBrief,
        assetReferences: flattened.assetReferences,
        pdf: result.pdf,
        compileStderr: result.compileStderr,
        compileAttempts: attempt,
        attempts,
      };
    }

    // Carry forward what the LLM produced (when applicable) so the next
    // call can correct rather than restart. `llm` failures don't have a
    // template to correct — start fresh next attempt.
    previousForRetry = result.previousForRetry;
  }

  logger.warn("CV upload pipeline exhausted retries", {
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
      record: UploadPipelineAttempt;
      templatedTex: string;
      fields: CvField[];
      personalBrief: string;
      pdf: Uint8Array;
      compileStderr: string;
    }
  | {
      kind: "failure";
      record: UploadPipelineAttempt;
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

  // 3a. LLM template-extract.
  let extracted: Awaited<ReturnType<typeof llmTemplateExtract>>;
  try {
    extracted = await llmTemplateExtract({
      flattenedTex: flattened.flattenedTex,
      assetReferences: flattened.assetReferences,
      extractionPrompt,
      previousAttempt,
    });
  } catch (error) {
    const message =
      error instanceof TemplateExtractError
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
      previousForRetry: undefined, // No template to carry forward.
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
    const message = error instanceof Error ? error.message : String(error);
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
    personalBrief: extracted.personalBrief,
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
