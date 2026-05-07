import { LlmService } from "@server/services/llm/service";
import type { JsonSchemaDefinition } from "@server/services/llm/types";
import { resolveLlmModel } from "@server/services/modelSelection";
import { loadPrompt } from "@server/services/prompts";
import {
  buildPreviousAttemptBlock,
  type TemplateExtractPreviousAttempt,
} from "@server/services/cv/llm-template-extract";
import { extractMarkerIds } from "@server/services/cv/render-template";
import { CV_FIELD_ROLES, type CvField } from "@shared/types";

/**
 * 5h cover-letter substrate. Mirrors the CV template-extract flow but
 * returns only `templatedTex` + `fieldsJson` — there is no
 * `personalBrief` (that lives on the CV doc). Validates that exactly one
 * extracted field carries `role: "body"`; the upload pipeline rejects
 * the attempt as `failureKind: "llm"` when the count is off.
 */
const COVER_LETTER_TEMPLATE_EXTRACT_SCHEMA: JsonSchemaDefinition = {
  name: "cover_letter_template_extract_result",
  schema: {
    type: "object",
    properties: {
      templatedTex: {
        type: "string",
        description:
          "The user's source LaTeX with every tailorable span replaced by a `«field-id»` marker (Unicode guillemets). Structural text stays verbatim.",
      },
      fieldsJson: {
        type: "string",
        description:
          "Stringified JSON array of CvField entries: [{ id, role, value }]. Each id appears once as a `«id»` marker in templatedTex; each marker has a corresponding entry. Exactly one entry must have role=\"body\". The server JSON.parses this.",
      },
    },
    required: ["templatedTex", "fieldsJson"],
    additionalProperties: false,
  },
};

const ROLE_SET = new Set<string>(CV_FIELD_ROLES);

export class CoverLetterTemplateExtractError extends Error {
  readonly code: string;
  readonly detail?: unknown;
  constructor(message: string, code: string, detail?: unknown) {
    super(message);
    this.name = "CoverLetterTemplateExtractError";
    this.code = code;
    this.detail = detail;
  }
}

export interface CoverLetterTemplateExtractArgs {
  flattenedTex: string;
  assetReferences: string[];
  /**
   * Per-doc LLM system prompt override. When provided (non-empty),
   * replaces the YAML system prompt entirely. Empty / undefined → use
   * the YAML default.
   */
  extractionPrompt?: string;
  /**
   * Retry context. When present, the LLM is asked to correct its
   * previous output rather than restart from scratch.
   */
  previousAttempt?: TemplateExtractPreviousAttempt;
}

export interface CoverLetterTemplateExtractResult {
  templatedTex: string;
  fields: CvField[];
  /** Convenience: the id of the single `role: "body"` field. */
  bodyFieldId: string;
}

/**
 * Returns the YAML system prompt as a plain string. Used by the
 * `GET /api/coverletter/extraction-prompt-default` endpoint so the client
 * can pre-fill the per-document prompt textarea.
 */
export async function getCoverLetterExtractionPromptDefault(): Promise<string> {
  const prompt = await loadPrompt("coverletter-template-extract", {
    flattenedTex: "",
    assetReferencesList: "",
    previousAttemptBlock: "",
  });
  return prompt.system;
}

export async function llmCoverLetterTemplateExtract(
  args: CoverLetterTemplateExtractArgs,
): Promise<CoverLetterTemplateExtractResult> {
  const model = await resolveLlmModel("tailoring");
  const prompt = await loadPrompt("coverletter-template-extract", {
    flattenedTex: args.flattenedTex,
    assetReferencesList:
      args.assetReferences.length > 0
        ? args.assetReferences.join("\n")
        : "(none)",
    previousAttemptBlock: buildPreviousAttemptBlock(args.previousAttempt),
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
    templatedTex: unknown;
    fieldsJson: unknown;
  }>({
    model,
    messages,
    jsonSchema: COVER_LETTER_TEMPLATE_EXTRACT_SCHEMA,
    maxRetries: 1,
    label: "extract cover-letter template",
  });

  if (!result.success) {
    throw new CoverLetterTemplateExtractError(
      `LLM extraction failed: ${result.error}`,
      "LLM_FAILED",
    );
  }

  const { templatedTex, fieldsJson } = result.data;

  if (typeof templatedTex !== "string" || templatedTex.trim().length === 0) {
    throw new CoverLetterTemplateExtractError(
      "LLM returned empty or non-string templatedTex.",
      "EMPTY_TEMPLATE",
    );
  }
  if (typeof fieldsJson !== "string" || fieldsJson.trim().length === 0) {
    throw new CoverLetterTemplateExtractError(
      "LLM returned empty or non-string fieldsJson.",
      "INVALID_FIELDS",
    );
  }

  let fieldsRaw: unknown;
  try {
    fieldsRaw = JSON.parse(fieldsJson);
  } catch (error) {
    throw new CoverLetterTemplateExtractError(
      `LLM returned fieldsJson that is not parseable JSON: ${error instanceof Error ? error.message : String(error)}`,
      "INVALID_FIELDS_JSON",
    );
  }
  if (!Array.isArray(fieldsRaw) || fieldsRaw.length === 0) {
    throw new CoverLetterTemplateExtractError(
      "LLM returned no fields. The cover letter must have at least one body field.",
      "EMPTY_FIELDS",
    );
  }

  const fields: CvField[] = [];
  const seen = new Set<string>();
  let bodyFieldId: string | null = null;
  for (let i = 0; i < fieldsRaw.length; i++) {
    const entry = fieldsRaw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new CoverLetterTemplateExtractError(
        `Field at index ${i} is not an object.`,
        "INVALID_FIELD_SHAPE",
      );
    }
    const { id, role, value } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id.length === 0) {
      throw new CoverLetterTemplateExtractError(
        `Field at index ${i} has missing or empty id.`,
        "INVALID_FIELD_ID",
      );
    }
    if (seen.has(id)) {
      throw new CoverLetterTemplateExtractError(
        `Duplicate field id "${id}" at index ${i}.`,
        "DUPLICATE_FIELD_ID",
      );
    }
    seen.add(id);
    if (typeof role !== "string" || !ROLE_SET.has(role)) {
      throw new CoverLetterTemplateExtractError(
        `Field "${id}" has unknown role "${String(role)}".`,
        "INVALID_FIELD_ROLE",
      );
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new CoverLetterTemplateExtractError(
        `Field "${id}" has missing or empty value.`,
        "INVALID_FIELD_VALUE",
      );
    }
    if (role === "body") {
      if (bodyFieldId !== null) {
        throw new CoverLetterTemplateExtractError(
          `Multiple fields claim role="body" ("${bodyFieldId}" and "${id}"). Exactly one body field is required.`,
          "MULTIPLE_BODY_FIELDS",
          { firstBodyId: bodyFieldId, secondBodyId: id },
        );
      }
      bodyFieldId = id;
    }
    fields.push({ id, role: role as CvField["role"], value });
  }

  if (bodyFieldId === null) {
    throw new CoverLetterTemplateExtractError(
      "No field claims role=\"body\". Exactly one body field is required for the Generate step to fill.",
      "NO_BODY_FIELD",
    );
  }

  // Marker / field consistency.
  const markerIds = extractMarkerIds(templatedTex);
  const fieldIds = new Set(fields.map((field) => field.id));
  for (const id of markerIds) {
    if (!fieldIds.has(id)) {
      throw new CoverLetterTemplateExtractError(
        `Template marker "«${id}»" has no corresponding field.`,
        "ORPHAN_MARKER",
        { fieldId: id },
      );
    }
  }
  for (const id of fieldIds) {
    if (!markerIds.has(id)) {
      throw new CoverLetterTemplateExtractError(
        `Field "${id}" has no corresponding marker in templatedTex.`,
        "ORPHAN_FIELD",
        { fieldId: id },
      );
    }
  }

  return { templatedTex, fields, bodyFieldId };
}
