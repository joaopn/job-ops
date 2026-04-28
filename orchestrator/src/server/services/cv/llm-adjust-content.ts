import { LlmService } from "@server/services/llm/service";
import type { JsonSchemaDefinition } from "@server/services/llm/types";
import { resolveLlmModel } from "@server/services/modelSelection";
import { loadPrompt } from "@server/services/prompts";
import {
  getWritingStyle,
  stripLanguageDirectivesFromConstraints,
  type WritingStyle,
} from "@server/services/writing-style";
import {
  CHAT_STYLE_MANUAL_LANGUAGE_LABELS,
  type ChatStyleManualLanguage,
  type CvField,
  type CvFieldOverrides,
} from "@shared/types";

/**
 * `patchesJson` is a JSON-encoded string instead of an array of objects —
 * strict structured-output mode (OpenAI) requires `additionalProperties:
 * false` on every object schema, which interacts poorly when patches share
 * the same flat shape. Encoding as a JSON string sidesteps the constraint;
 * the server validates each entry after parsing.
 */
const ADJUST_SCHEMA: JsonSchemaDefinition = {
  name: "cv_adjust_result",
  schema: {
    type: "object",
    properties: {
      patchesJson: {
        type: "string",
        description:
          "Stringified JSON array of patches: [{ fieldId, newValue }]. Each fieldId must reference a CvField in the input list. The server JSON.parses this and validates each entry.",
      },
      matched: {
        type: "array",
        items: { type: "string" },
        description:
          "JD keywords actually surfaced via the proposed patches with backing evidence in the brief.",
      },
      skipped: {
        type: "array",
        items: { type: "string" },
        description:
          "JD keywords considered but dropped because the brief lacks evidence.",
      },
    },
    required: ["patchesJson", "matched", "skipped"],
    additionalProperties: false,
  },
};

export interface AdjustFieldPatch {
  fieldId: string;
  newValue: string;
}

export interface AdjustContentArgs {
  personalBrief: string;
  jobDescription: string;
  currentFields: CvField[];
  currentOverrides: CvFieldOverrides;
}

export type AdjustContentResult =
  | {
      success: true;
      patches: AdjustFieldPatch[];
      matched: string[];
      skipped: string[];
    }
  | { success: false; error: string };

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /\\(?:immediate\s*)?write18\b/,
    description: "\\write18 (shell-escape)",
  },
  { pattern: /\\openout\b/, description: "\\openout (file write)" },
  { pattern: /\\input\s*\{\s*\//, description: "\\input{} with absolute path" },
  {
    pattern: /\\input\s*\{\s*\.\.\//,
    description: "\\input{} with parent-traversal path",
  },
];

function buildFieldsView(
  fields: CvField[],
  overrides: CvFieldOverrides,
): Array<{ id: string; role: string; value: string }> {
  return fields.map((field) => ({
    id: field.id,
    role: field.role,
    value: overrides[field.id] ?? field.value,
  }));
}

export async function llmAdjustContent(
  args: AdjustContentArgs,
): Promise<AdjustContentResult> {
  const [model, writingStyle] = await Promise.all([
    resolveLlmModel("tailoring"),
    getWritingStyle(),
  ]);

  const fieldsView = buildFieldsView(args.currentFields, args.currentOverrides);

  const prompt = await loadPrompt("cv-adjust", {
    personalBrief: args.personalBrief || "(empty — no candidate brief on file)",
    jobDescription: args.jobDescription || "(empty)",
    fieldsJson: JSON.stringify(fieldsView, null, 2),
    ...buildWritingStyleVars(writingStyle),
  });

  const llm = new LlmService();
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (prompt.system) messages.push({ role: "system", content: prompt.system });
  messages.push({ role: "user", content: prompt.user });

  const result = await llm.callJson<{
    patchesJson: unknown;
    matched: unknown;
    skipped: unknown;
  }>({
    model,
    messages,
    jsonSchema: ADJUST_SCHEMA,
    maxRetries: 1,
  });

  if (!result.success) {
    return { success: false, error: `LLM call failed: ${result.error}` };
  }

  const { patchesJson, matched, skipped } = result.data;
  if (typeof patchesJson !== "string" || patchesJson.trim().length === 0) {
    return {
      success: false,
      error: "LLM returned empty or non-string patchesJson.",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(patchesJson);
  } catch (error) {
    return {
      success: false,
      error: `LLM returned patchesJson that is not parseable JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      success: false,
      error: "LLM returned patchesJson that is not a JSON array.",
    };
  }

  const fieldIds = new Set(args.currentFields.map((field) => field.id));
  const patches: AdjustFieldPatch[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const fieldId = record.fieldId;
    const newValue = record.newValue;
    if (typeof fieldId !== "string" || !fieldIds.has(fieldId)) continue;
    if (typeof newValue !== "string") continue;
    if (FORBIDDEN_PATTERNS.some((guard) => guard.pattern.test(newValue))) {
      continue;
    }
    patches.push({ fieldId, newValue });
  }

  return {
    success: true,
    patches,
    matched: stringArray(matched),
    skipped: stringArray(skipped),
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function buildWritingStyleVars(style: WritingStyle): Record<string, string> {
  const language: ChatStyleManualLanguage =
    style.languageMode === "manual" ? style.manualLanguage : "english";
  const effectiveConstraints = stripLanguageDirectivesFromConstraints(
    style.constraints,
  );
  return {
    outputLanguage: CHAT_STYLE_MANUAL_LANGUAGE_LABELS[language],
    tone: style.tone,
    formality: style.formality,
    constraintsSentence: effectiveConstraints
      ? `Writing constraints: ${effectiveConstraints}`
      : "",
    avoidTermsSentence: style.doNotUse
      ? `Avoid these terms: ${style.doNotUse}`
      : "",
  };
}
