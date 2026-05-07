import { logger } from "@infra/logger";
import { LlmService } from "@server/services/llm/service";
import type { JsonSchemaDefinition } from "@server/services/llm/types";
import { resolveLlmModel } from "@server/services/modelSelection";
import { loadPrompt } from "@server/services/prompts";
import { getEffectiveSettings } from "@server/services/settings";
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
  /** Optional — used as the LLM-queue subject line and for diagnostic logging. */
  jobId?: string;
  jobTitle?: string;
  jobEmployer?: string;
}

export type AdjustContentResult =
  | {
      success: true;
      patches: AdjustFieldPatch[];
      matched: string[];
      skipped: string[];
    }
  | {
      success: false;
      error: string;
      /** Set when the failure is the configured tailored-content cap. */
      cap?: { field: string; observed: number; max: number };
    };

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

  const subject =
    args.jobTitle && args.jobEmployer
      ? `${args.jobTitle} @ ${args.jobEmployer}`
      : args.jobTitle || args.jobEmployer || undefined;

  const result = await llm.callJson<{
    patchesJson: unknown;
    matched: unknown;
    skipped: unknown;
  }>({
    model,
    messages,
    jsonSchema: ADJUST_SCHEMA,
    maxRetries: 1,
    label: "tailor CV",
    subject,
    jobId: args.jobId,
  });

  if (!result.success) {
    return { success: false, error: `LLM call failed: ${result.error}` };
  }

  const { patchesJson, matched, skipped } = result.data;
  if (typeof patchesJson !== "string" || patchesJson.trim().length === 0) {
    return {
      success: false,
      error: "The model returned an empty list of changes.",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(patchesJson);
  } catch (error) {
    return {
      success: false,
      error: `The model returned a malformed list of changes: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      success: false,
      error: "The model returned the list of changes in an unexpected shape.",
    };
  }

  const fieldIds = new Set(args.currentFields.map((field) => field.id));
  const patches: AdjustFieldPatch[] = [];
  const droppedUnknownFieldIds: string[] = [];
  let droppedMalformed = 0;
  let droppedForbidden = 0;
  let droppedNoChange = 0;
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      droppedMalformed += 1;
      continue;
    }
    const record = entry as Record<string, unknown>;
    const fieldId = record.fieldId;
    const newValue = record.newValue;
    if (typeof fieldId !== "string") {
      droppedMalformed += 1;
      continue;
    }
    if (!fieldIds.has(fieldId)) {
      droppedUnknownFieldIds.push(fieldId);
      continue;
    }
    if (typeof newValue !== "string") {
      droppedMalformed += 1;
      continue;
    }
    if (FORBIDDEN_PATTERNS.some((guard) => guard.pattern.test(newValue))) {
      droppedForbidden += 1;
      continue;
    }
    const original = args.currentFields.find((f) => f.id === fieldId)?.value;
    if (original !== undefined && newValue === original) {
      droppedNoChange += 1;
      continue;
    }
    patches.push({ fieldId, newValue });
  }

  logger.info("Tailoring patches resolved", {
    jobId: args.jobId ?? null,
    rawCount: parsed.length,
    appliedCount: patches.length,
    droppedUnknownFieldIds: droppedUnknownFieldIds.slice(0, 10),
    droppedUnknownCount: droppedUnknownFieldIds.length,
    droppedMalformed,
    droppedForbidden,
    droppedNoChange,
    knownFieldIdSample: Array.from(fieldIds).slice(0, 5),
    matchedCount: Array.isArray(matched) ? matched.length : 0,
    skippedCount: Array.isArray(skipped) ? skipped.length : 0,
  });

  // Hard-fail any path where the LLM produced no usable changes. A
  // tailoring run that ships zero changes means the rendered PDF would be
  // byte-identical to the baseline CV — silently dropping that as a
  // success is forbidden.
  if (patches.length === 0) {
    const reasons: string[] = [];
    if (parsed.length === 0) reasons.push("the model proposed no changes");
    if (droppedUnknownFieldIds.length > 0) {
      reasons.push(
        `${droppedUnknownFieldIds.length} change(s) targeted unknown CV fields (e.g. ${droppedUnknownFieldIds
          .slice(0, 3)
          .map((id) => `"${id}"`)
          .join(", ")})`,
      );
    }
    if (droppedMalformed > 0) {
      reasons.push(`${droppedMalformed} change(s) were malformed`);
    }
    if (droppedForbidden > 0) {
      reasons.push(
        `${droppedForbidden} change(s) contained forbidden LaTeX patterns`,
      );
    }
    if (droppedNoChange > 0) {
      reasons.push(
        `${droppedNoChange} change(s) re-emitted the original value`,
      );
    }
    if (reasons.length === 0) {
      reasons.push("no changes survived validation (cause unknown)");
    }
    return {
      success: false,
      error: `Tailoring produced no usable changes — ${reasons.join("; ")}.`,
    };
  }

  // Post-LLM size check. Snapshot what tailoredFields would look like AFTER
  // applying the patches and reject if the serialized size exceeds the
  // user's configured cap. The user can lift the cap or trim their CV.
  const settings = await getEffectiveSettings();
  const maxTailoredContentChars = settings.maxTailoredContentChars.value;
  const overridesPreview: CvFieldOverrides = { ...args.currentOverrides };
  for (const patch of patches) {
    overridesPreview[patch.fieldId] = patch.newValue;
  }
  const serialized = JSON.stringify(overridesPreview);
  if (serialized.length > maxTailoredContentChars) {
    return {
      success: false,
      error: `Tailored content exceeds the configured limit (${serialized.length} > ${maxTailoredContentChars} chars). Lift maxTailoredContentChars in Settings or trim your CV.`,
      cap: {
        field: "tailoredFields",
        observed: serialized.length,
        max: maxTailoredContentChars,
      },
    };
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
