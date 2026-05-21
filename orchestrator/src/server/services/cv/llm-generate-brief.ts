import { LlmService } from "@server/services/llm/service";
import type { JsonSchemaDefinition } from "@server/services/llm/types";
import { resolveLlmModel } from "@server/services/modelSelection";
import { loadPrompt } from "@server/services/prompts";

/**
 * Stand-alone brief regeneration. Re-extract (template + fields) is
 * decoupled from brief regeneration — re-extract preserves the user's
 * existing brief, and this service is the explicit opt-in path for
 * rewriting it from the CV's prose.
 */
const BRIEF_SCHEMA: JsonSchemaDefinition = {
  name: "cv_generate_brief_result",
  schema: {
    type: "object",
    properties: {
      personalBrief: {
        type: "string",
        description:
          "First-person 100–400 word candidate summary drawn from the LaTeX prose.",
      },
    },
    required: ["personalBrief"],
    additionalProperties: false,
  },
};

export class GenerateBriefError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "GenerateBriefError";
    this.code = code;
  }
}

export async function generateBrief(args: {
  flattenedTex: string;
}): Promise<string> {
  const model = await resolveLlmModel("tailoring");
  const prompt = await loadPrompt("cv-generate-brief", {
    flattenedTex: args.flattenedTex,
  });

  const llm = new LlmService();
  const result = await llm.callJson<{ personalBrief: unknown }>({
    model,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    jsonSchema: BRIEF_SCHEMA,
    maxRetries: 1,
    label: "generate CV personal brief",
  });

  if (!result.success) {
    throw new GenerateBriefError(
      `LLM brief generation failed: ${result.error}`,
      "LLM_FAILED",
    );
  }

  const { personalBrief } = result.data;
  if (typeof personalBrief !== "string" || personalBrief.trim().length === 0) {
    throw new GenerateBriefError(
      "LLM returned empty or non-string personalBrief.",
      "EMPTY_BRIEF",
    );
  }

  return personalBrief;
}
