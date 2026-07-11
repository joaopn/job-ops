import { LlmService } from "@server/services/llm/service";
import type { JsonSchemaDefinition } from "@server/services/llm/types";
import { resolveLlmModel } from "@server/services/modelSelection";
import { loadPrompt } from "@server/services/prompts";
import { CV_FIELD_ROLES, type CvFieldRole } from "@shared/types";
import type { DocxSegment } from "./extract-segments";
import type { DocxFieldSpan } from "./splice-markers";

/**
 * Word-CV substrate: span selection over visible text (the analog of
 * llm-template-extract.ts). The LLM only names verbatim spans of the
 * numbered segments — it never sees or writes XML, and never writes
 * markers, so ORPHAN_MARKER/ORPHAN_FIELD failures are structurally
 * impossible here. Span LOCATION and uniqueness are deliberately NOT
 * validated in this module: splice-markers is the single authoritative
 * enforcer (SPAN_NOT_FOUND / SPAN_AMBIGUOUS / OVERLAPPING_SPANS), and
 * the pipeline maps its errors into the same retry loop. This module
 * validates shape only.
 *
 * `fieldsJson` is JSON-encoded as a string for strict structured-output
 * compatibility — same workaround as cv-template-extract / cv-adjust.
 */
const DOCX_EXTRACT_SCHEMA: JsonSchemaDefinition = {
  name: "cv_docx_extract_result",
  schema: {
    type: "object",
    properties: {
      fieldsJson: {
        type: "string",
        description:
          "Stringified JSON array of field entries: [{ id, role, value, segmentId }]. Each value is a verbatim contiguous substring of segment segmentId's text. The server JSON.parses this.",
      },
      personalBrief: {
        type: "string",
        description:
          "First-person 100–400 word candidate summary drawn from the CV's prose.",
      },
    },
    required: ["fieldsJson", "personalBrief"],
    additionalProperties: false,
  },
};

const ROLE_SET = new Set<string>(CV_FIELD_ROLES);

export class DocxExtractError extends Error {
  readonly code: string;
  readonly detail?: unknown;
  constructor(message: string, code: string, detail?: unknown) {
    super(message);
    this.name = "DocxExtractError";
    this.code = code;
    this.detail = detail;
  }
}

/** The LLM's field output: a CvField plus the segment its span lives in. */
export interface DocxExtractField extends DocxFieldSpan {
  role: CvFieldRole;
}

export interface DocxExtractPreviousAttempt {
  /** The full field list the previous attempt selected. */
  fields: DocxExtractField[];
  /** What broke last time. */
  failureKind: "splice" | "content-diff" | "convert";
  /** Span-location error, text diff, or converter stderr. */
  detail: string;
}

export interface DocxExtractArgs {
  segments: DocxSegment[];
  /**
   * Per-CV LLM system prompt override (the reused `extractionPrompt`
   * column, §6). When provided (non-empty), replaces the cv-docx-extract
   * YAML's system prompt entirely. The user message (segments + retry
   * block) is always server-controlled.
   */
  extractionPrompt?: string;
  /**
   * Retry context. When present, the LLM is asked to correct its previous
   * selection rather than restart — the prior fields plus the failure
   * detail are appended to the user message.
   */
  previousAttempt?: DocxExtractPreviousAttempt;
}

export interface DocxExtractResult {
  fields: DocxExtractField[];
  personalBrief: string;
}

const PREV_BLOCK_TRUNCATE_FIELDS = 8000;
const PREV_BLOCK_TRUNCATE_DETAIL = 2000;

function truncate(value: string | undefined, max: number): string {
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…(truncated)`;
}

const FAILURE_KIND_SENTENCES: Record<
  DocxExtractPreviousAttempt["failureKind"],
  string
> = {
  splice:
    "a selected span could not be located verbatim and unambiguously in its segment",
  "content-diff":
    "substituting the fields' own values back into the document did not reproduce the original text exactly",
  convert: "the substituted document failed to convert to PDF",
};

export function buildDocxPreviousAttemptBlock(
  prev: DocxExtractPreviousAttempt | undefined,
): string {
  if (!prev) return "";
  const sections: string[] = [];
  sections.push(
    "\n----- PREVIOUS ATTEMPT (failed; correct it, do not restart) -----",
  );
  sections.push(`\nFailure kind: ${FAILURE_KIND_SENTENCES[prev.failureKind]}`);
  sections.push("\nPrevious fields you selected:");
  sections.push("```");
  sections.push(
    truncate(JSON.stringify(prev.fields, null, 2), PREV_BLOCK_TRUNCATE_FIELDS),
  );
  sections.push("```");
  if (prev.detail) {
    sections.push("\nFailure detail:");
    sections.push("```");
    sections.push(truncate(prev.detail, PREV_BLOCK_TRUNCATE_DETAIL));
    sections.push("```");
  }
  sections.push(
    "\nProduce a corrected `fieldsJson` + `personalBrief`. Every value must be a verbatim, contiguous, uniquely-locatable substring of its segment's text.",
  );
  return sections.join("\n");
}

/**
 * Returns the YAML system prompt as a plain string — the docx analog of
 * getExtractionPromptDefault, for `GET /api/cv/extraction-prompt-default`
 * once the route dispatches on cvSourceFormat (W4b).
 */
export async function getDocxExtractionPromptDefault(): Promise<string> {
  const prompt = await loadPrompt("cv-docx-extract", {
    segmentsList: "",
    previousAttemptBlock: "",
  });
  return prompt.system;
}

function formatSegmentsList(segments: DocxSegment[]): string {
  return segments
    .map((s) => `[${s.segmentId}] (${s.partName}) ${s.text}`)
    .join("\n");
}

export async function llmDocxExtract(
  args: DocxExtractArgs,
): Promise<DocxExtractResult> {
  const model = await resolveLlmModel("tailoring");
  const prompt = await loadPrompt("cv-docx-extract", {
    segmentsList: formatSegmentsList(args.segments),
    previousAttemptBlock: buildDocxPreviousAttemptBlock(args.previousAttempt),
  });

  const systemContent =
    args.extractionPrompt && args.extractionPrompt.trim().length > 0
      ? args.extractionPrompt
      : prompt.system;

  const llm = new LlmService();
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (systemContent) messages.push({ role: "system", content: systemContent });
  messages.push({ role: "user", content: prompt.user });

  const result = await llm.callJson<{
    fieldsJson: unknown;
    personalBrief: unknown;
  }>({
    model,
    messages,
    jsonSchema: DOCX_EXTRACT_SCHEMA,
    maxRetries: 1,
    label: "extract CV docx spans",
  });

  if (!result.success) {
    throw new DocxExtractError(
      `LLM extraction failed: ${result.error}`,
      "LLM_FAILED",
    );
  }

  const { fieldsJson, personalBrief } = result.data;

  if (typeof fieldsJson !== "string" || fieldsJson.trim().length === 0) {
    throw new DocxExtractError(
      "LLM returned empty or non-string fieldsJson.",
      "INVALID_FIELDS",
    );
  }
  if (typeof personalBrief !== "string") {
    throw new DocxExtractError(
      "LLM returned non-string personalBrief.",
      "INVALID_BRIEF",
    );
  }

  let fieldsRaw: unknown;
  try {
    fieldsRaw = JSON.parse(fieldsJson);
  } catch (error) {
    throw new DocxExtractError(
      `LLM returned fieldsJson that is not parseable JSON: ${error instanceof Error ? error.message : String(error)}`,
      "INVALID_FIELDS_JSON",
    );
  }
  if (!Array.isArray(fieldsRaw) || fieldsRaw.length === 0) {
    throw new DocxExtractError(
      "LLM returned no fields. Tailoring needs at least one field.",
      "EMPTY_FIELDS",
    );
  }

  const fields: DocxExtractField[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < fieldsRaw.length; i++) {
    const entry = fieldsRaw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new DocxExtractError(
        `Field at index ${i} is not an object.`,
        "INVALID_FIELD_SHAPE",
      );
    }
    const { id, role, value, segmentId } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id.length === 0) {
      throw new DocxExtractError(
        `Field at index ${i} has missing or empty id.`,
        "INVALID_FIELD_ID",
      );
    }
    if (seen.has(id)) {
      throw new DocxExtractError(
        `Duplicate field id "${id}" at index ${i}.`,
        "DUPLICATE_FIELD_ID",
      );
    }
    seen.add(id);
    if (typeof role !== "string" || !ROLE_SET.has(role)) {
      throw new DocxExtractError(
        `Field "${id}" has unknown role "${String(role)}".`,
        "INVALID_FIELD_ROLE",
      );
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new DocxExtractError(
        `Field "${id}" has missing or empty value.`,
        "INVALID_FIELD_VALUE",
      );
    }
    if (
      typeof segmentId !== "number" ||
      !Number.isInteger(segmentId) ||
      segmentId < 0 ||
      segmentId >= args.segments.length
    ) {
      throw new DocxExtractError(
        `Field "${id}" has segmentId ${String(segmentId)} outside [0, ${args.segments.length}).`,
        "INVALID_SEGMENT_ID",
      );
    }
    fields.push({ id, role: role as CvFieldRole, value, segmentId });
  }

  return { fields, personalBrief };
}
