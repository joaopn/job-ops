import type {
  CvField,
  CvFieldOverrides,
  CvUploadPipelineAttempt,
} from "@shared/types";
import { ConvertDocxError, convertDocxToPdf } from "./convert-docx-pdf";
import { type DocxSegment, extractSegments } from "./extract-segments";
import { extractStoryText } from "./extract-text";
import {
  type DocxExtractField,
  type DocxExtractPreviousAttempt,
  DocxExtractError,
  llmDocxExtract,
} from "./llm-docx-extract";
import { normalizeStoryPart } from "./normalize-runs";
import { type DocxPackage, ParseDocxError, parseDocx } from "./parse-docx";
import { RenderDocxError, renderDocx } from "./render-docx";
import { firstMismatch, roundTripCheck } from "./round-trip";
import { SpliceError, spliceMarkers } from "./splice-markers";

/**
 * The docx acceptance gate (the analog of upload-pipeline.ts): round-trip
 * → convert-original → extract-loop (LLM span selection → splice →
 * substitute defaults → exact text equality → convert-substituted), ≤N
 * attempts, hard reject on exhaustion — the no-partial-uploads invariant.
 *
 * The PUBLIC failure shape uses the ALIASED LaTeX stage vocabulary by
 * contract (word-cv §4.5 posture (a)): parse rejects → "flatten",
 * round-trip and convert-original failures → "compile-original",
 * extract-loop unchanged. The route error-mapping and CvPage branch on
 * these string literals; the docx-specific detail rides message /
 * flattenCode / originalCompileStderr.
 *
 * Caller persists the artefacts (route-side, mirroring the LaTeX route).
 */

const DEFAULT_MAX_RETRIES = 3;

export interface DocxUploadPipelineArgs {
  archive: Uint8Array;
  /** Extract-loop attempts. Default 3. Clamped to [1, 10]. */
  maxRetries?: number;
  /** Per-CV system-prompt override, forwarded to llm-docx-extract. */
  extractionPrompt?: string;
  /** Expanded-archive byte cap, forwarded to parse-docx. */
  maxExpandedBytes?: number;
}

export interface DocxUploadPipelineSuccess {
  ok: true;
  /** Extracted visible text (ordered segments) — the docx meaning of the reused flattened_tex column. */
  flattenedTex: string;
  /** JSON envelope {"parts": {partName: templatedXml}} — the docx meaning of templated_tex. */
  templatedTex: string;
  fields: CvField[];
  defaultFieldValues: CvFieldOverrides;
  personalBrief: string;
  /** Converter stderr from the accepting attempt ("" — unoconvert is silent on success). */
  compileStderr: string;
  /** 1-indexed accepting attempt number. */
  compileAttempts: number;
  attempts: CvUploadPipelineAttempt[];
}

export interface DocxUploadPipelineFailure {
  ok: false;
  stage: "flatten" | "compile-original" | "extract-loop";
  message: string;
  /** ParseDocxError code when stage === "flatten". */
  flattenCode?: string;
  /** Round-trip diff or converter stderr when stage === "compile-original". */
  originalCompileStderr?: string;
  /** Per-attempt log when stage === "extract-loop". */
  attempts?: CvUploadPipelineAttempt[];
}

export type DocxUploadPipelineResult =
  | DocxUploadPipelineSuccess
  | DocxUploadPipelineFailure;

export async function runDocxUploadPipeline(
  args: DocxUploadPipelineArgs,
): Promise<DocxUploadPipelineResult> {
  const maxRetries = clampRetries(args.maxRetries);
  const parseOpts = args.maxExpandedBytes
    ? { maxExpandedBytes: args.maxExpandedBytes }
    : undefined;

  // Stage 1+2: parse rejects + the LLM-free round-trip proof. roundTripCheck
  // re-runs the full parse validation internally, so a typed reject
  // surfaces here regardless of which parse pass hits it.
  try {
    const roundTrip = roundTripCheck(args.archive, parseOpts);
    if (!roundTrip.ok) {
      return {
        ok: false,
        stage: "compile-original",
        message:
          "We can't faithfully round-trip your .docx — re-serializing it changes its text. This is a hard reject; please report the file.",
        originalCompileStderr: `part ${roundTrip.partName}:\n${roundTrip.diff}`,
      };
    }
  } catch (error) {
    if (error instanceof ParseDocxError) {
      return {
        ok: false,
        stage: "flatten",
        message: error.message,
        flattenCode: error.code,
      };
    }
    throw error;
  }

  // The working package: T0 and the segment list are deterministic per
  // archive, so they are captured once. Attempts re-parse their own copies
  // (splice-markers mutates paragraph DOMs).
  const pkg = parseNormalized(args.archive, parseOpts);
  const originalText = extractStoryText(pkg.storyParts, pkg.storyPartOrder);
  const { segments } = extractSegments(pkg.storyParts, pkg.storyPartOrder);
  const flattenedTex = segments.map((s) => s.text).join("\n");

  // Stage 3: convert-original — the renderability proof ("a real renderer
  // opens this file"). The PDF itself is discarded; previews convert on
  // demand. Deliberate parity conflation (checker-acknowledged): an
  // UNAVAILABLE converter (unoserver daemon down — infrastructure, not
  // the document) surfaces as stage "compile-original" exactly like a
  // missing tectonic binary does on the LaTeX path. If that ever needs
  // disentangling, branch on error.code === "UNAVAILABLE" here.
  try {
    await convertDocxToPdf({ docx: args.archive });
  } catch (error) {
    if (error instanceof ConvertDocxError) {
      return {
        ok: false,
        stage: "compile-original",
        message: `Your CV failed to convert to PDF: ${error.message}`,
        originalCompileStderr: error.stderr,
      };
    }
    throw error;
  }

  // Stage 4: the extract loop.
  const attempts: CvUploadPipelineAttempt[] = [];
  let previousAttempt: DocxExtractPreviousAttempt | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const result = await runOneAttempt({
      attempt,
      archive: args.archive,
      parseOpts,
      segments,
      originalText,
      extractionPrompt: args.extractionPrompt,
      previousAttempt,
    });
    attempts.push(result.record);

    if (result.kind === "success") {
      return {
        ok: true,
        flattenedTex,
        templatedTex: result.templatedTex,
        fields: result.fields,
        defaultFieldValues: result.defaultFieldValues,
        personalBrief: result.personalBrief,
        compileStderr: "",
        compileAttempts: attempt,
        attempts,
      };
    }
    previousAttempt = result.previousForRetry;
  }

  const last = attempts[attempts.length - 1];
  return {
    ok: false,
    stage: "extract-loop",
    message: `Failed to produce a valid template after ${maxRetries} attempt(s). The most recent failure was: ${last?.failureMessage ?? "unknown"}`,
    attempts,
  };
}

interface AttemptArgs {
  attempt: number;
  archive: Uint8Array;
  parseOpts: { maxExpandedBytes: number } | undefined;
  segments: DocxSegment[];
  originalText: ReadonlyMap<string, string>;
  extractionPrompt?: string;
  previousAttempt?: DocxExtractPreviousAttempt;
}

type AttemptResult =
  | {
      kind: "success";
      record: CvUploadPipelineAttempt;
      templatedTex: string;
      fields: CvField[];
      defaultFieldValues: CvFieldOverrides;
      personalBrief: string;
    }
  | {
      kind: "failure";
      record: CvUploadPipelineAttempt;
      previousForRetry: DocxExtractPreviousAttempt | undefined;
    };

async function runOneAttempt(args: AttemptArgs): Promise<AttemptResult> {
  // 4a: span selection. The catch deliberately absorbs ANY error (not just
  // DocxExtractError) into an "llm" attempt record: a deterministic infra
  // failure (missing prompt row, model resolution) burns its attempts fast
  // and surfaces as an extract-loop reject with the real message in the
  // attempt log, rather than an opaque 500.
  let extracted: { fields: DocxExtractField[]; personalBrief: string };
  try {
    extracted = await llmDocxExtract({
      segments: args.segments,
      extractionPrompt: args.extractionPrompt,
      previousAttempt: args.previousAttempt,
    });
  } catch (error) {
    const message =
      error instanceof DocxExtractError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      kind: "failure",
      record: {
        attempt: args.attempt,
        templatedTex: "",
        fields: [],
        failureKind: "llm",
        failureMessage: message,
        compileStderr: null,
        contentDiff: null,
      },
      // No selection to carry forward — the next attempt starts fresh.
      previousForRetry: undefined,
    };
  }

  const fields: CvField[] = extracted.fields.map(({ id, role, value }) => ({
    id,
    role,
    value,
  }));

  // 4b: splice. A FRESH parse+normalize per attempt — splice-markers
  // mutates the paragraph DOMs (run splitting/replacement), so a failed
  // attempt's mutations must never leak into the next.
  const pkg = parseNormalized(args.archive, args.parseOpts);
  let templatedParts: Map<string, string>;
  try {
    templatedParts = spliceMarkers(
      pkg.storyParts,
      pkg.storyPartOrder,
      extracted.fields,
    );
  } catch (error) {
    if (!(error instanceof SpliceError)) throw error;
    // Span-location failures map onto the attempt vocabulary as "llm"
    // (word-cv §4.5) — the selection, not the document, is what failed.
    return {
      kind: "failure",
      record: {
        attempt: args.attempt,
        templatedTex: "",
        fields,
        failureKind: "llm",
        failureMessage: error.message,
        compileStderr: null,
        contentDiff: null,
      },
      previousForRetry: {
        fields: extracted.fields,
        failureKind: "splice",
        detail: error.message,
      },
    };
  }

  const templatedTex = JSON.stringify({
    parts: Object.fromEntries(templatedParts),
  });
  const defaultFieldValues = fieldsToOverrides(fields);

  // 4c: substitute the defaults back in.
  let rendered: Uint8Array;
  try {
    rendered = renderDocx({
      originalArchive: args.archive,
      templatedParts,
      effectiveValues: defaultFieldValues,
    });
  } catch (error) {
    if (!(error instanceof RenderDocxError)) throw error;
    return {
      kind: "failure",
      record: {
        attempt: args.attempt,
        templatedTex,
        fields,
        failureKind: "render",
        failureMessage: error.message,
        compileStderr: null,
        contentDiff: null,
      },
      previousForRetry: {
        fields: extracted.fields,
        failureKind: "splice",
        detail: error.message,
      },
    };
  }

  // 4d: exact text equality — the deciding check. Runs before the convert
  // (deviation from the LaTeX compile-then-diff order): equality is free
  // and deterministic, a conversion costs ~300ms.
  //
  // A ParseDocxError thrown HERE propagates as a 500 by design: the input
  // survived parse, round-trip, and splice, so an unparseable rebuild is
  // an implementation-invariant violation (our serializer emitted garbage)
  // that retrying the LLM cannot fix — not an unhandled gap for the route
  // to paper over.
  const substituted = parseDocx(rendered, args.parseOpts);
  const substitutedText = extractStoryText(
    substituted.storyParts,
    substituted.storyPartOrder,
  );
  const mismatch = firstMismatch(args.originalText, substitutedText);
  if (mismatch) {
    const contentDiff = `part ${mismatch.partName}:\n${mismatch.diff}`;
    return {
      kind: "failure",
      record: {
        attempt: args.attempt,
        templatedTex,
        fields,
        failureKind: "content-diff",
        failureMessage: `Substituted text diverges from the original in ${mismatch.partName}.`,
        compileStderr: null,
        contentDiff,
      },
      previousForRetry: {
        fields: extracted.fields,
        failureKind: "content-diff",
        detail: contentDiff,
      },
    };
  }

  // 4e: convert-substituted — the loop's renderability leg.
  try {
    await convertDocxToPdf({ docx: rendered });
  } catch (error) {
    if (!(error instanceof ConvertDocxError)) throw error;
    return {
      kind: "failure",
      record: {
        attempt: args.attempt,
        templatedTex,
        fields,
        failureKind: "compile",
        failureMessage: `Substituted document failed to convert to PDF: ${error.message}`,
        compileStderr: error.stderr,
        contentDiff: null,
      },
      previousForRetry: {
        fields: extracted.fields,
        failureKind: "convert",
        detail: error.stderr || error.message,
      },
    };
  }

  return {
    kind: "success",
    record: {
      attempt: args.attempt,
      templatedTex,
      fields,
      failureKind: null,
      failureMessage: null,
      compileStderr: null,
      contentDiff: null,
    },
    templatedTex,
    fields,
    defaultFieldValues,
    personalBrief: extracted.personalBrief,
  };
}

function parseNormalized(
  archive: Uint8Array,
  parseOpts: { maxExpandedBytes: number } | undefined,
): DocxPackage {
  const pkg = parseDocx(archive, parseOpts);
  for (const doc of pkg.storyParts.values()) {
    normalizeStoryPart(doc);
  }
  return pkg;
}

function fieldsToOverrides(fields: CvField[]): CvFieldOverrides {
  const out: CvFieldOverrides = {};
  for (const field of fields) {
    out[field.id] = field.value;
  }
  return out;
}

function clampRetries(value: number | undefined): number {
  if (!value || Number.isNaN(value)) return DEFAULT_MAX_RETRIES;
  return Math.max(1, Math.min(10, Math.floor(value)));
}
