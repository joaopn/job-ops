import { conflict } from "@infra/errors";
import { logger } from "@infra/logger";
import { resolveLlmModel } from "@server/services/modelSelection";
import type { CvField, SearchTermsSuggestionResponse } from "@shared/types";
import {
  MAX_SEARCH_TERM_LENGTH,
  MAX_SEARCH_TERMS,
  normalizeSearchTerms,
} from "@shared/utils/search-terms";
import { getActiveCvDocument } from "./cv-active";
import { LlmService } from "./llm/service";
import type { JsonSchemaDefinition } from "./llm/types";
import { loadPrompt } from "./prompts";

type SearchTermSuggestionModelResponse = {
  terms: string[];
};

const MAX_BRIEF_CHARS = 6000;

const SEARCH_TERMS_SCHEMA: JsonSchemaDefinition = {
  name: "onboarding_search_terms",
  schema: {
    type: "object",
    properties: {
      terms: {
        type: "array",
        description: "Concise job-title search terms derived from the resume",
        items: {
          type: "string",
        },
        minItems: 1,
        maxItems: MAX_SEARCH_TERMS,
      },
    },
    required: ["terms"],
    additionalProperties: false,
  },
};

function dedupe(values: Array<string | undefined>, maxItems = MAX_SEARCH_TERMS): string[] {
  return normalizeSearchTerms(
    values.filter((value): value is string => Boolean(value)),
    {
      maxTerms: maxItems,
      maxLength: MAX_SEARCH_TERM_LENGTH,
    },
  );
}

/**
 * Pull a few flat hints out of the extracted CvField list by role: titles
 * (positions), publications (project-name-like), skills, and a headline
 * derived from the first summary-role field. Roles the LLM never tagged
 * are simply absent from the result.
 */
function collectCvHints(fields: CvField[]): {
  headline: string | undefined;
  positions: string[];
  projectNames: string[];
  skillNames: string[];
} {
  const headline = fields.find((field) => field.role === "summary")?.value;
  const positions = fields
    .filter((field) => field.role === "title")
    .map((field) => field.value);
  const projectNames = fields
    .filter((field) => field.role === "publication")
    .map((field) => field.value);
  const skillNames = fields
    .filter((field) => field.role === "skill")
    .map((field) => field.value);

  return { headline, positions, projectNames, skillNames };
}

function truncateBrief(brief: string): string {
  const trimmed = brief.trim();
  if (trimmed.length <= MAX_BRIEF_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_BRIEF_CHARS)}\n[brief truncated]`;
}

export type OnboardingSearchTermContext = {
  brief: string;
  headline: string | undefined;
  positions: string[];
  projectNames: string[];
  skillNames: string[];
};

export function buildFallbackSearchTerms(
  context: OnboardingSearchTermContext,
): SearchTermsSuggestionResponse {
  return {
    terms: dedupe([
      context.headline,
      ...context.positions,
      ...context.projectNames,
      ...context.skillNames,
    ]),
    source: "fallback",
  };
}

function hasUsableContext(context: OnboardingSearchTermContext): boolean {
  return Boolean(
    context.brief ||
      context.headline ||
      context.positions.length > 0 ||
      context.projectNames.length > 0 ||
      context.skillNames.length > 0,
  );
}

async function buildPrompt(
  context: OnboardingSearchTermContext,
): Promise<{ system: string; user: string }> {
  const loaded = await loadPrompt("onboarding-search-terms", {
    briefText: context.brief
      ? truncateBrief(context.brief)
      : "No personal brief provided.",
    contextJson: JSON.stringify(
      {
        headline: context.headline,
        positions: context.positions,
        projectNames: context.projectNames,
        skillNames: context.skillNames,
      },
      null,
      2,
    ),
  });
  return { system: loaded.system, user: loaded.user };
}

export async function suggestOnboardingSearchTerms(): Promise<SearchTermsSuggestionResponse> {
  const cv = await getActiveCvDocument();
  if (!cv) {
    logger.warn(
      "Onboarding search-term suggestion skipped because no CV has been uploaded",
      {
        route: "POST /api/onboarding/search-terms/suggest",
      },
    );
    throw conflict("Resume must be configured before suggesting search terms.");
  }

  const hints = collectCvHints(cv.fields);
  const context: OnboardingSearchTermContext = {
    brief: cv.personalBrief ?? "",
    headline: hints.headline,
    positions: dedupe(hints.positions, 12),
    projectNames: dedupe(hints.projectNames, 12),
    skillNames: dedupe(hints.skillNames, 20),
  };

  if (!hasUsableContext(context)) {
    logger.warn(
      "Onboarding search-term suggestion skipped because resume context was empty",
      {
        route: "POST /api/onboarding/search-terms/suggest",
      },
    );
    throw conflict("Resume must be configured before suggesting search terms.");
  }

  const fallback = buildFallbackSearchTerms(context);

  try {
    const model = await resolveLlmModel("tailoring");
    const llm = new LlmService();
    const prompt = await buildPrompt(context);
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (prompt.system) {
      messages.push({ role: "system", content: prompt.system });
    }
    messages.push({ role: "user", content: prompt.user });

    const result = await llm.callJson<SearchTermSuggestionModelResponse>({
      model,
      messages,
      jsonSchema: SEARCH_TERMS_SCHEMA,
    });

    if (!result.success) {
      logger.warn(
        "Onboarding search-term suggestion fell back after AI generation failed",
        {
          route: "POST /api/onboarding/search-terms/suggest",
          error: result.error,
          fallbackTermsCount: fallback.terms.length,
        },
      );
      if (fallback.terms.length > 0) return fallback;
      throw conflict(
        "Resume must be configured before suggesting search terms.",
      );
    }

    const terms = dedupe(result.data?.terms ?? []);
    if (terms.length === 0) {
      logger.warn(
        "Onboarding search-term suggestion produced no usable AI terms",
        {
          route: "POST /api/onboarding/search-terms/suggest",
          fallbackTermsCount: fallback.terms.length,
        },
      );
      if (fallback.terms.length > 0) return fallback;
      throw conflict(
        "Resume must be configured before suggesting search terms.",
      );
    }

    return {
      terms,
      source: "ai",
    };
  } catch (error) {
    logger.warn(
      "Onboarding search-term suggestion fell back after unexpected generation error",
      {
        route: "POST /api/onboarding/search-terms/suggest",
        error,
        fallbackTermsCount: fallback.terms.length,
      },
    );
    if (fallback.terms.length > 0) return fallback;
    throw conflict("Resume must be configured before suggesting search terms.");
  }
}
