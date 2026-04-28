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
  type CvContent,
} from "@shared/types";

/**
 * `tailoredContentJson` is a JSON-encoded string instead of a nested
 * object — strict structured-output mode (OpenAI) requires
 * `additionalProperties: false` on every object schema, which is
 * incompatible with the open-shape, source-CV-mirroring tailoredContent.
 * Encoding it as a string lets the LLM emit arbitrary keys; the server
 * parses it after the call.
 */
const ADJUST_SCHEMA: JsonSchemaDefinition = {
  name: "cv_adjust_result",
  schema: {
    type: "object",
    properties: {
      tailoredContentJson: {
        type: "string",
        description:
          "Stringified JSON object with the same shape as the input content. The wording is adjusted for the JD; keys must mirror the input. The server JSON.parses this.",
      },
      matched: {
        type: "array",
        items: { type: "string" },
        description:
          "JD keywords actually surfaced in tailoredContent with backing evidence in the brief.",
      },
      skipped: {
        type: "array",
        items: { type: "string" },
        description:
          "JD keywords considered but dropped because the brief lacks evidence.",
      },
    },
    required: ["tailoredContentJson", "matched", "skipped"],
    additionalProperties: false,
  },
};

export interface AdjustContentArgs {
  personalBrief: string;
  jobDescription: string;
  currentContent: CvContent;
}

export type AdjustContentResult =
  | {
      success: true;
      tailoredContent: CvContent;
      matched: string[];
      skipped: string[];
    }
  | { success: false; error: string };

export async function llmAdjustContent(
  args: AdjustContentArgs,
): Promise<AdjustContentResult> {
  const [model, writingStyle] = await Promise.all([
    resolveLlmModel("tailoring"),
    getWritingStyle(),
  ]);

  const prompt = await loadPrompt("cv-adjust", {
    personalBrief: args.personalBrief || "(empty — no candidate brief on file)",
    jobDescription: args.jobDescription || "(empty)",
    contentJson: JSON.stringify(args.currentContent, null, 2),
    ...buildWritingStyleVars(writingStyle),
  });

  const llm = new LlmService();
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (prompt.system) messages.push({ role: "system", content: prompt.system });
  messages.push({ role: "user", content: prompt.user });

  const result = await llm.callJson<{
    tailoredContentJson: unknown;
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

  const { tailoredContentJson, matched, skipped } = result.data;
  if (
    typeof tailoredContentJson !== "string" ||
    tailoredContentJson.trim().length === 0
  ) {
    return {
      success: false,
      error: "LLM returned empty or non-string tailoredContentJson.",
    };
  }

  let tailoredContent: unknown;
  try {
    tailoredContent = JSON.parse(tailoredContentJson);
  } catch (error) {
    return {
      success: false,
      error: `LLM returned tailoredContentJson that is not parseable JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (
    tailoredContent === null ||
    typeof tailoredContent !== "object" ||
    Array.isArray(tailoredContent)
  ) {
    return {
      success: false,
      error: "LLM returned tailoredContent that was not a JSON object.",
    };
  }

  return {
    success: true,
    tailoredContent: tailoredContent as CvContent,
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
