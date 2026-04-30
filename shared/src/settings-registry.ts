import { z } from "zod";
import {
  LOCATION_MATCH_STRICTNESS_VALUES,
  LOCATION_SEARCH_SCOPE_VALUES,
} from "./location-preferences";
import {
  CHAT_STYLE_LANGUAGE_MODE_VALUES,
  CHAT_STYLE_MANUAL_LANGUAGE_VALUES,
  type ChatStyleLanguageMode,
  type ChatStyleManualLanguage,
} from "./types/settings";

function parseNonEmptyStringOrNull(raw: string | undefined): string | null {
  return raw === undefined || raw === "" ? null : raw;
}

function parseIntOrNull(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseJsonArrayOrNull(raw: string | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

function parseBitBoolOrNull(raw: string | undefined): boolean | null {
  if (!raw) return null;
  return raw === "true" || raw === "1";
}

function normalizeLlmProviderOrNull(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const normalized = raw.trim().toLowerCase().replace(/-/g, "_");
  return normalized ? normalized : null;
}

export const DEFAULT_GEMINI_MODEL = "google/gemini-3-flash-preview";
export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
export const DEFAULT_CODEX_MODEL = "";

export function getDefaultModelForProvider(
  provider: string | null | undefined,
  fallbackModel?: string | null,
): string {
  const trimmedFallback = fallbackModel?.trim();
  if (trimmedFallback) {
    return trimmedFallback;
  }

  const normalizedProvider = normalizeLlmProviderOrNull(provider ?? undefined);

  if (normalizedProvider === "openai") {
    return DEFAULT_OPENAI_MODEL;
  }

  if (normalizedProvider === "gemini") {
    return DEFAULT_GEMINI_MODEL;
  }

  if (normalizedProvider === "codex") {
    return DEFAULT_CODEX_MODEL;
  }
  return DEFAULT_GEMINI_MODEL;
}

function serializeNullableNumber(
  value: number | null | undefined,
): string | null {
  return value !== null && value !== undefined ? String(value) : null;
}

function serializeNullableJsonArray(
  value: string[] | null | undefined,
): string | null {
  return value !== null && value !== undefined ? JSON.stringify(value) : null;
}

function serializeBitBool(value: boolean | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value ? "1" : "0";
}

function createEnumParser<const TValues extends readonly [string, ...string[]]>(
  values: TValues,
): (raw: string | undefined) => TValues[number] | null {
  const allowedValues = new Set<string>(values);

  return (raw: string | undefined): TValues[number] | null => {
    if (!raw) return null;
    return allowedValues.has(raw) ? (raw as TValues[number]) : null;
  };
}

function createEnumArrayParser<
  const TValues extends readonly [string, ...string[]],
>(values: TValues): (raw: string | undefined) => TValues[number][] | null {
  const allowedValues = new Set<string>(values);

  return (raw: string | undefined): TValues[number][] | null => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return null;

      const out: TValues[number][] = [];
      const seen = new Set<string>();
      for (const value of parsed) {
        if (typeof value !== "string" || !allowedValues.has(value)) {
          return null;
        }
        if (seen.has(value)) continue;
        seen.add(value);
        out.push(value as TValues[number]);
      }
      if (out.length === 0) return null;
      return out;
    } catch {
      return null;
    }
  };
}

const parseChatStyleLanguageModeOrNull = createEnumParser(
  CHAT_STYLE_LANGUAGE_MODE_VALUES,
);

const parseChatStyleManualLanguageOrNull = createEnumParser(
  CHAT_STYLE_MANUAL_LANGUAGE_VALUES,
);

const WORKPLACE_TYPE_VALUES = ["remote", "hybrid", "onsite"] as const;
const parseWorkplaceTypesOrNull = createEnumArrayParser(WORKPLACE_TYPE_VALUES);
const parseLocationSearchScopeOrNull = createEnumParser(
  LOCATION_SEARCH_SCOPE_VALUES,
);
const parseLocationMatchStrictnessOrNull = createEnumParser(
  LOCATION_MATCH_STRICTNESS_VALUES,
);

export const settingsRegistry = {
  // --- Typed Settings ---
  model: {
    kind: "typed" as const,
    schema: z.string().trim().max(200),
    default: (): string =>
      typeof process !== "undefined"
        ? getDefaultModelForProvider(
            process.env.LLM_PROVIDER,
            process.env.MODEL,
          )
        : DEFAULT_GEMINI_MODEL,
    parse: parseNonEmptyStringOrNull,
    serialize: (value: string | null | undefined): string | null =>
      value ?? null,
  },
  llmProvider: {
    kind: "typed" as const,
    envKey: "LLM_PROVIDER",
    schema: z.preprocess(
      (v) => (typeof v === "string" ? normalizeLlmProviderOrNull(v) : v),
      z
        .enum([
          "openrouter",
          "lmstudio",
          "ollama",
          "openai",
          "openai_compatible",
          "gemini",
          "codex",
        ])
        .nullable(),
    ),
    default: (): string =>
      typeof process !== "undefined"
        ? normalizeLlmProviderOrNull(process.env.LLM_PROVIDER) || "openrouter"
        : "openrouter",
    parse: normalizeLlmProviderOrNull,
    serialize: (value: string | null | undefined): string | null =>
      value ?? null,
  },
  llmBaseUrl: {
    kind: "typed" as const,
    envKey: "LLM_BASE_URL",
    schema: z.preprocess(
      (v) => (v === "" ? null : v),
      z.string().trim().url().max(2000).nullable(),
    ),
    default: (): string =>
      typeof process !== "undefined" ? process.env.LLM_BASE_URL || "" : "",
    parse: parseNonEmptyStringOrNull,
    serialize: (value: string | null | undefined): string | null =>
      value ?? null,
  },
  startupjobsMaxJobsPerTerm: {
    kind: "typed" as const,
    schema: z.number().int().min(1).max(1000),
    default: (): number =>
      parseInt(
        typeof process !== "undefined"
          ? process.env.STARTUPJOBS_MAX_RESULTS || "50"
          : "50",
        10,
      ),
    parse: parseIntOrNull,
    serialize: serializeNullableNumber,
  },
  searchTerms: {
    kind: "typed" as const,
    schema: z.array(z.string().trim().min(1).max(200)).max(100),
    default: (): string[] =>
      (typeof process !== "undefined"
        ? process.env.JOBSPY_SEARCH_TERMS || "web developer"
        : "web developer"
      )
        .split("|")
        .map((v) => v.trim())
        .filter(Boolean),
    parse: parseJsonArrayOrNull,
    serialize: serializeNullableJsonArray,
  },
  workplaceTypes: {
    kind: "typed" as const,
    schema: z.array(z.enum(WORKPLACE_TYPE_VALUES)).min(1).max(3),
    default: (): Array<(typeof WORKPLACE_TYPE_VALUES)[number]> => [
      "remote",
      "hybrid",
      "onsite",
    ],
    parse: parseWorkplaceTypesOrNull,
    serialize: serializeNullableJsonArray,
  },
  blockedCompanyKeywords: {
    kind: "typed" as const,
    schema: z.array(z.string().trim().min(1).max(200)).max(200),
    default: (): string[] => [],
    parse: parseJsonArrayOrNull,
    serialize: serializeNullableJsonArray,
  },
  scoringInstructions: {
    kind: "typed" as const,
    schema: z.string().trim().max(4000),
    default: (): string => "",
    parse: parseNonEmptyStringOrNull,
    serialize: (value: string | null | undefined): string | null =>
      value ?? null,
  },
  // ghostwriterSystemPromptTemplate, tailoringPromptTemplate, scoringPromptTemplate
  // were removed — all LLM prompts now live in user-editable YAML under prompts/.
  searchCities: {
    kind: "typed" as const,
    schema: z.string().trim().max(100),
    default: (): string =>
      typeof process !== "undefined"
        ? process.env.SEARCH_CITIES || process.env.JOBSPY_LOCATION || ""
        : "",
    parse: parseNonEmptyStringOrNull,
    serialize: (value: string | null | undefined): string | null =>
      value ?? null,
  },
  locationSearchScope: {
    kind: "typed" as const,
    schema: z.enum(LOCATION_SEARCH_SCOPE_VALUES),
    default: () => "selected_only" as const,
    parse: parseLocationSearchScopeOrNull,
    serialize: (value: string | null | undefined): string | null =>
      value ?? null,
  },
  locationMatchStrictness: {
    kind: "typed" as const,
    schema: z.enum(LOCATION_MATCH_STRICTNESS_VALUES),
    default: () => "exact_only" as const,
    parse: parseLocationMatchStrictnessOrNull,
    serialize: (value: string | null | undefined): string | null =>
      value ?? null,
  },
  jobspyResultsWanted: {
    kind: "typed" as const,
    schema: z.number().int().min(1).max(1000),
    default: (): number =>
      parseInt(
        typeof process !== "undefined"
          ? process.env.JOBSPY_RESULTS_WANTED || "200"
          : "200",
        10,
      ),
    parse: parseIntOrNull,
    serialize: serializeNullableNumber,
  },
  jobspyCountryIndeed: {
    kind: "typed" as const,
    schema: z.string().trim().max(100),
    default: (): string =>
      typeof process !== "undefined"
        ? process.env.JOBSPY_COUNTRY_INDEED || ""
        : "",
    parse: parseNonEmptyStringOrNull,
    serialize: (value: string | null | undefined): string | null =>
      value ?? null,
  },
  showSponsorInfo: {
    kind: "typed" as const,
    schema: z.boolean(),
    default: (): boolean => true,
    parse: parseBitBoolOrNull,
    serialize: serializeBitBool,
  },
  renderMarkdownInJobDescriptions: {
    kind: "typed" as const,
    schema: z.boolean(),
    default: (): boolean => true,
    parse: parseBitBoolOrNull,
    serialize: serializeBitBool,
  },
  chatStyleTone: {
    kind: "typed" as const,
    schema: z.string().trim().max(100),
    default: (): string =>
      typeof process !== "undefined"
        ? process.env.CHAT_STYLE_TONE || "professional"
        : "professional",
    parse: parseNonEmptyStringOrNull,
    serialize: (value: string | null | undefined): string | null =>
      value ?? null,
  },
  chatStyleFormality: {
    kind: "typed" as const,
    schema: z.string().trim().max(100),
    default: (): string =>
      typeof process !== "undefined"
        ? process.env.CHAT_STYLE_FORMALITY || "medium"
        : "medium",
    parse: parseNonEmptyStringOrNull,
    serialize: (value: string | null | undefined): string | null =>
      value ?? null,
  },
  chatStyleConstraints: {
    kind: "typed" as const,
    schema: z.string().trim().max(4000),
    default: (): string =>
      typeof process !== "undefined"
        ? process.env.CHAT_STYLE_CONSTRAINTS || ""
        : "",
    parse: parseNonEmptyStringOrNull,
    serialize: (value: string | null | undefined): string | null =>
      value ?? null,
  },
  chatStyleDoNotUse: {
    kind: "typed" as const,
    schema: z.string().trim().max(1000),
    default: (): string =>
      typeof process !== "undefined"
        ? process.env.CHAT_STYLE_DO_NOT_USE || ""
        : "",
    parse: parseNonEmptyStringOrNull,
    serialize: (value: string | null | undefined): string | null =>
      value ?? null,
  },
  chatStyleSummaryMaxWords: {
    kind: "typed" as const,
    schema: z.number().int().min(1).max(500).nullable(),
    default: (): number | null => null,
    parse: parseIntOrNull,
    serialize: serializeNullableNumber,
  },
  chatStyleMaxKeywordsPerSkill: {
    kind: "typed" as const,
    schema: z.number().int().min(1).max(50).nullable(),
    default: (): number | null => null,
    parse: parseIntOrNull,
    serialize: serializeNullableNumber,
  },
  chatStyleLanguageMode: {
    kind: "typed" as const,
    schema: z.enum(CHAT_STYLE_LANGUAGE_MODE_VALUES),
    default: (): ChatStyleLanguageMode =>
      parseChatStyleLanguageModeOrNull(
        typeof process !== "undefined"
          ? process.env.CHAT_STYLE_LANGUAGE_MODE
          : undefined,
      ) ?? "manual",
    parse: parseChatStyleLanguageModeOrNull,
    serialize: (
      value: ChatStyleLanguageMode | null | undefined,
    ): string | null => value ?? null,
  },
  chatStyleManualLanguage: {
    kind: "typed" as const,
    schema: z.enum(CHAT_STYLE_MANUAL_LANGUAGE_VALUES),
    default: (): ChatStyleManualLanguage =>
      parseChatStyleManualLanguageOrNull(
        typeof process !== "undefined"
          ? process.env.CHAT_STYLE_MANUAL_LANGUAGE
          : undefined,
      ) ?? "english",
    parse: parseChatStyleManualLanguageOrNull,
    serialize: (
      value: ChatStyleManualLanguage | null | undefined,
    ): string | null => value ?? null,
  },
  penalizeMissingSalary: {
    kind: "typed" as const,
    schema: z.boolean(),
    default: (): boolean => {
      if (typeof process === "undefined") return false;
      const v = process.env.PENALIZE_MISSING_SALARY || "0";
      return v === "1" || v.toLowerCase() === "true";
    },
    parse: parseBitBoolOrNull,
    serialize: serializeBitBool,
  },
  missingSalaryPenalty: {
    kind: "typed" as const,
    schema: z.number().int().min(0).max(100),
    default: (): number => {
      if (typeof process === "undefined") return 10;
      const raw = process.env.MISSING_SALARY_PENALTY;
      if (!raw) return 10;
      const parsed = parseInt(raw, 10);
      return Number.isNaN(parsed) ? 10 : Math.min(100, Math.max(0, parsed));
    },
    parse: (raw: string | undefined): number | null => {
      const parsed = raw ? parseInt(raw, 10) : NaN;
      return Number.isNaN(parsed) ? null : Math.min(100, Math.max(0, parsed));
    },
    serialize: serializeNullableNumber,
  },
  autoSkipScoreThreshold: {
    kind: "typed" as const,
    schema: z.number().int().min(0).max(100),
    default: (): number | null => null,
    parse: (raw: string | undefined): number | null => {
      if (!raw || raw === "null" || raw === "") return null;
      const parsed = parseInt(raw, 10);
      return Number.isNaN(parsed) ? null : Math.min(100, Math.max(0, parsed));
    },
    serialize: (value: number | null | undefined): string | null => {
      return value === null || value === undefined ? null : String(value);
    },
  },
  autoTailoringEnabled: {
    kind: "typed" as const,
    schema: z.boolean(),
    default: (): boolean => false,
    parse: parseBitBoolOrNull,
    serialize: serializeBitBool,
  },

  // --- Model Variants ---
  modelScorer: {
    kind: "model" as const,
    schema: z.string().trim().max(200),
  },
  modelTailoring: {
    kind: "model" as const,
    schema: z.string().trim().max(200),
  },

  // --- Simple Strings ---
  onboardingBasicAuthDecision: {
    kind: "string" as const,
    schema: z.enum(["enabled", "skipped"]),
  },
  basicAuthUser: {
    kind: "string" as const,
    envKey: "BASIC_AUTH_USER",
    schema: z.string().trim().max(200),
  },

  // --- Secrets ---
  llmApiKey: {
    kind: "secret" as const,
    envKey: "LLM_API_KEY",
    schema: z.string().trim().max(2000),
  },
  basicAuthPassword: {
    kind: "secret" as const,
    envKey: "BASIC_AUTH_PASSWORD",
    schema: z.string().trim().max(2000),
  },

  // --- Aliases ---
  jobspyLocation: {
    kind: "alias" as const,
    schema: z.string().trim().max(100),
    target: "searchCities" as const,
  },

  // --- Virtual ---
  enableBasicAuth: {
    kind: "virtual" as const,
    schema: z.boolean(),
  },
} as const;

export type SettingsRegistry = typeof settingsRegistry;
export type SettingsRegistryKey = keyof SettingsRegistry;
