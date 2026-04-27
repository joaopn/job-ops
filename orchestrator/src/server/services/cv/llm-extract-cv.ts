import { logger } from "@infra/logger";
import { LlmService } from "@server/services/llm/service";
import type { JsonSchemaDefinition } from "@server/services/llm/types";
import { resolveLlmModel } from "@server/services/modelSelection";
import { loadPrompt } from "@server/services/prompts";
import { type CvContent, cvContentSchema } from "@shared/types";

const EXTRACT_SCHEMA: JsonSchemaDefinition = {
  name: "cv_extract_result",
  schema: {
    type: "object",
    properties: {
      template: {
        type: "string",
        description:
          "Eta-flavored LaTeX template generalized from the source CV. Uses <%= e(...) %> and <% for/if %> blocks.",
      },
      content: {
        type: "object",
        description:
          "CvContent JSON describing the source CV. Shape documented in the system prompt.",
      },
    },
    required: ["template", "content"],
    additionalProperties: false,
  },
};

export interface ExtractCvArgs {
  flattenedTex: string;
  assetReferences: string[];
}

export interface ExtractCvResult {
  template: string;
  content: CvContent;
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

  const result = await llm.callJson<{ template: unknown; content: unknown }>({
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

  const { template, content } = result.data;
  if (typeof template !== "string" || template.trim().length === 0) {
    throw new CvExtractError(
      "LLM returned empty or non-string template.",
      "EMPTY_TEMPLATE",
    );
  }

  const parsed = cvContentSchema.safeParse(content);
  if (!parsed.success) {
    logger.warn("CvContent validation failed", {
      issues: parsed.error.issues.slice(0, 5),
    });
    throw new CvExtractError(
      "LLM returned content that did not match CvContent schema.",
      "INVALID_CONTENT",
      parsed.error.flatten(),
    );
  }

  return { template, content: parsed.data };
}
