import { logger } from "@infra/logger";
import { LlmService } from "@server/services/llm/service";
import type { JsonSchemaDefinition } from "@server/services/llm/types";
import { resolveLlmModel } from "@server/services/modelSelection";
import { loadPrompt } from "@server/services/prompts";
import { CV_FIELD_ROLES, type CvField } from "@shared/types";
import { findUnreachableField } from "./render";

/**
 * `fieldsJson` is a JSON-encoded string instead of an inline array. Strict
 * structured-output mode (OpenAI) requires `additionalProperties: false` on
 * every object schema, which is incompatible with the open-shape per-field
 * `value` content. Encoding as a string sidesteps the constraint; the
 * server parses it after the LLM call.
 */
const EXTRACT_SCHEMA: JsonSchemaDefinition = {
  name: "cv_extract_result",
  schema: {
    type: "object",
    properties: {
      fieldsJson: {
        type: "string",
        description:
          "Stringified JSON array of CvField entries in document order. Each entry is { id, role, value } where `value` is a verbatim substring of the source LaTeX (may contain LaTeX commands and escapes).",
      },
      personalBrief: {
        type: "string",
        description:
          "First-person 100–400 word summary of the candidate drawn from the LaTeX prose.",
      },
    },
    required: ["fieldsJson", "personalBrief"],
    additionalProperties: false,
  },
};

export interface ExtractCvArgs {
  flattenedTex: string;
  assetReferences: string[];
}

export interface ExtractCvResult {
  fields: CvField[];
  personalBrief: string;
}

export class CvExtractError extends Error {
  readonly code: string;
  readonly detail?: unknown;
  constructor(message: string, code: string, detail?: unknown) {
    super(message);
    this.name = "CvExtractError";
    this.code = code;
    this.detail = detail;
  }
}

const ROLE_SET = new Set<string>(CV_FIELD_ROLES);

export async function extractCv(args: ExtractCvArgs): Promise<ExtractCvResult> {
  const model = await resolveLlmModel("tailoring");
  const prompt = await loadPrompt("cv-extract", {
    flattenedTex: args.flattenedTex,
    assetReferencesList:
      args.assetReferences.length > 0
        ? args.assetReferences.join("\n")
        : "(none)",
  });

  const llm = new LlmService();
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (prompt.system) messages.push({ role: "system", content: prompt.system });
  messages.push({ role: "user", content: prompt.user });

  const result = await llm.callJson<{
    fieldsJson: unknown;
    personalBrief: unknown;
  }>({
    model,
    messages,
    jsonSchema: EXTRACT_SCHEMA,
    maxRetries: 1,
  });

  if (!result.success) {
    throw new CvExtractError(
      `LLM extraction failed: ${result.error}`,
      "LLM_FAILED",
    );
  }

  const { fieldsJson, personalBrief } = result.data;

  if (typeof fieldsJson !== "string" || fieldsJson.trim().length === 0) {
    throw new CvExtractError(
      "LLM returned empty or non-string fieldsJson.",
      "INVALID_FIELDS",
    );
  }

  let fieldsRaw: unknown;
  try {
    fieldsRaw = JSON.parse(fieldsJson);
  } catch (error) {
    throw new CvExtractError(
      `LLM returned fieldsJson that is not parseable JSON: ${error instanceof Error ? error.message : String(error)}`,
      "INVALID_FIELDS_JSON",
    );
  }

  if (!Array.isArray(fieldsRaw) || fieldsRaw.length === 0) {
    throw new CvExtractError(
      "LLM returned no fields. Re-run extraction; the renderer needs at least one field to apply tailoring.",
      "EMPTY_FIELDS",
    );
  }

  const fields: CvField[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < fieldsRaw.length; i++) {
    const entry = fieldsRaw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new CvExtractError(
        `Field at index ${i} is not an object.`,
        "INVALID_FIELD_SHAPE",
      );
    }
    const { id, role, value } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id.length === 0) {
      throw new CvExtractError(
        `Field at index ${i} has missing or empty id.`,
        "INVALID_FIELD_ID",
      );
    }
    if (seenIds.has(id)) {
      throw new CvExtractError(
        `Duplicate field id "${id}" at index ${i}.`,
        "DUPLICATE_FIELD_ID",
      );
    }
    seenIds.add(id);
    if (typeof role !== "string" || !ROLE_SET.has(role)) {
      throw new CvExtractError(
        `Field "${id}" has unknown role "${String(role)}".`,
        "INVALID_FIELD_ROLE",
      );
    }
    if (typeof value !== "string" || value.length === 0) {
      throw new CvExtractError(
        `Field "${id}" has missing or empty value.`,
        "INVALID_FIELD_VALUE",
      );
    }
    fields.push({ id, role: role as CvField["role"], value });
  }

  const unreachableIdx = findUnreachableField(args.flattenedTex, fields);
  if (unreachableIdx !== null) {
    const offending = fields[unreachableIdx];
    throw new CvExtractError(
      `Field "${offending.id}" (role: ${offending.role}) cannot be located in the source LaTeX at-or-after the running cursor. Either it is missing from the source, or fields are out of document order. Fix: re-run extraction.`,
      "FIELD_NOT_FOUND",
      { fieldId: offending.id, valuePreview: offending.value.slice(0, 80) },
    );
  }

  if (typeof personalBrief !== "string") {
    throw new CvExtractError(
      "LLM returned a non-string personalBrief.",
      "INVALID_BRIEF",
    );
  }

  logger.info("CV extraction returned", {
    fieldCount: fields.length,
    fieldIds: fields.slice(0, 20).map((f) => f.id),
    personalBriefChars: personalBrief.length,
  });

  return {
    fields,
    personalBrief,
  };
}
