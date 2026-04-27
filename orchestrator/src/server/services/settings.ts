import * as settingsRepo from "@server/repositories/settings";
import {
  getDefaultModelForProvider,
  settingsRegistry,
} from "@shared/settings-registry";
import type { AppSettings } from "@shared/types";
import { getEnvSettingsData } from "./envSettings";
import { resolveResumeProjectsSettings } from "./resumeProjects";

function resolveDefaultLlmBaseUrl(provider: string): string {
  const normalized = provider.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "ollama") return "http://localhost:11434";
  if (normalized === "lmstudio") return "http://localhost:1234";
  if (normalized === "openai") {
    return "https://api.openai.com";
  }
  if (normalized === "openai_compatible") {
    return "https://api.openai.com";
  }
  if (normalized === "gemini") {
    return "https://generativelanguage.googleapis.com";
  }
  if (normalized === "codex") {
    return "";
  }
  return "https://openrouter.ai";
}

function normalizeModelForProviderCompatibility(
  provider: string | null | undefined,
  model: string | null | undefined,
): string | null {
  const trimmedModel = model?.trim();
  if (!trimmedModel) return null;

  const normalizedProvider = provider?.trim().toLowerCase().replace(/-/g, "_");
  const normalizedModel = trimmedModel.toLowerCase();

  if (normalizedProvider === "openai") {
    if (
      normalizedModel.startsWith("google/") ||
      normalizedModel.startsWith("models/") ||
      normalizedModel.startsWith("gemini")
    ) {
      return null;
    }
  }

  if (normalizedProvider === "gemini") {
    const isGeminiModel =
      normalizedModel.startsWith("google/") ||
      normalizedModel.startsWith("models/") ||
      normalizedModel.startsWith("gemini");
    if (!isGeminiModel) {
      return null;
    }
  }

  return trimmedModel;
}

/**
 * Get the effective app settings, combining environment variables and database overrides.
 */
export async function getEffectiveSettings(): Promise<AppSettings> {
  const getAllSettings =
    "getAllSettings" in settingsRepo ? settingsRepo.getAllSettings : null;
  const overrides =
    (typeof getAllSettings === "function" ? await getAllSettings() : null) ??
    {};
  const providerOverride = settingsRegistry.llmProvider.parse(
    overrides.llmProvider,
  );
  const effectiveLlmProvider =
    providerOverride ?? settingsRegistry.llmProvider.default();
  const resolvedModelDefault =
    normalizeModelForProviderCompatibility(
      effectiveLlmProvider,
      getDefaultModelForProvider(effectiveLlmProvider, process.env.MODEL),
    ) ?? getDefaultModelForProvider(effectiveLlmProvider);

  const envSettings = await getEnvSettingsData(overrides);

  const result: Partial<AppSettings> = {
    ...envSettings,
  };

  const rawModel = overrides.model;
  const modelDef = settingsRegistry.model;
  const overrideModel = normalizeModelForProviderCompatibility(
    effectiveLlmProvider,
    modelDef.parse(rawModel),
  );
  const modelValue = overrideModel ?? resolvedModelDefault;

  for (const [key, def] of Object.entries(settingsRegistry)) {
    if (def.kind === "typed") {
      let rawOverride = overrides[key as settingsRepo.SettingKey];
      if (key === "searchCities" && !rawOverride) {
        rawOverride = overrides.jobspyLocation; // legacy fallback
      }

      let override = def.parse(rawOverride);
      let defaultValue = def.default();

      if (key === "model") {
        defaultValue = resolvedModelDefault;
        override = overrideModel;
      }

      if (key === "llmBaseUrl") {
        const provider =
          effectiveLlmProvider ?? settingsRegistry.llmProvider.default();
        defaultValue =
          process.env.LLM_BASE_URL || resolveDefaultLlmBaseUrl(provider);
      }

      if (key === "resumeProjects") {
        const resolved = resolveResumeProjectsSettings({
          catalog: [],
          overrideRaw: rawOverride ?? null,
        });
        result.profileProjects = resolved.profileProjects;
        // biome-ignore lint/suspicious/noExplicitAny: dynamic assignment for settings building
        (result as any).resumeProjects = {
          value: resolved.resumeProjects,
          default: resolved.defaultResumeProjects,
          override: resolved.overrideResumeProjects,
        };
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // biome-ignore lint/suspicious/noExplicitAny: dynamic assignment for settings building
      (result as any)[key] = {
        value: override ?? defaultValue,
        default: defaultValue,
        override,
      };
    } else if (def.kind === "model") {
      const override =
        normalizeModelForProviderCompatibility(
          effectiveLlmProvider,
          overrides[key as settingsRepo.SettingKey] ?? null,
        ) ?? null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // biome-ignore lint/suspicious/noExplicitAny: dynamic assignment for settings building
      (result as any)[key] = { value: override || modelValue, override };
    } else if (def.kind === "string") {
      if (!("envKey" in def) || !def.envKey) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // biome-ignore lint/suspicious/noExplicitAny: dynamic assignment for settings building
        (result as any)[key] =
          overrides[key as settingsRepo.SettingKey] ?? null;
      }
    }
  }

  return result as AppSettings;
}
