import type { SettingKey } from "@server/repositories/settings";
import * as settingsRepo from "@server/repositories/settings";
import { applyEnvValue, normalizeEnvInput } from "@server/services/envSettings";
import { normalizeResumeProjectsSettings } from "@server/services/resumeProjects";
import { settingsRegistry } from "@shared/settings-registry";
import type { UpdateSettingsInput } from "@shared/settings-schema";

export type DeferredSideEffect = never;

export type SettingsUpdateAction = {
  settingKey: SettingKey;
  persist: () => Promise<void>;
  sideEffect?: () => void | Promise<void>;
};

export type SettingsUpdateResult = {
  actions: SettingsUpdateAction[];
  deferredSideEffects: Set<DeferredSideEffect>;
};

export type SettingsUpdateContext = {
  input: UpdateSettingsInput;
};

export type SettingUpdateHandler<K extends keyof UpdateSettingsInput> = (args: {
  key: K;
  value: UpdateSettingsInput[K];
  context: SettingsUpdateContext;
}) => Promise<SettingsUpdateResult> | SettingsUpdateResult;

export type SettingsUpdatePlan = Record<string, never>;

const LEGACY_SETTINGS_TO_CLEAR_ON_UPDATE: Partial<
  Record<SettingKey, SettingKey[]>
> = {
  searchCities: ["jobspyLocation"],
};

function result(
  args: {
    actions?: SettingsUpdateAction[];
    deferred?: DeferredSideEffect[];
  } = {},
): SettingsUpdateResult {
  return {
    actions: args.actions ?? [],
    deferredSideEffects: new Set(args.deferred ?? []),
  };
}

function persistAction(
  settingKey: SettingKey,
  value: string | null,
  sideEffect?: () => void | Promise<void>,
): SettingsUpdateAction {
  return {
    settingKey,
    persist: () => settingsRepo.setSetting(settingKey, value),
    sideEffect,
  };
}

export const settingsUpdateRegistry: Partial<{
  [K in keyof UpdateSettingsInput]: SettingUpdateHandler<K>;
}> = {};

for (const [key, def] of Object.entries(settingsRegistry)) {
  if (def.kind === "virtual") continue;

  const targetKey =
    def.kind === "alias" ? (def.target as SettingKey) : (key as SettingKey);
  const hasEnvKey = "envKey" in def && !!def.envKey;

  if (key === "resumeProjects") {
    settingsUpdateRegistry.resumeProjects = async ({ value }) => {
      const resumeProjects = value ?? null;
      if (resumeProjects === null) {
        return result({ actions: [persistAction(targetKey, null)] });
      }

      const normalized = normalizeResumeProjectsSettings(
        resumeProjects as Parameters<typeof normalizeResumeProjectsSettings>[0],
        new Set(),
      );

      return result({
        actions: [persistAction(targetKey, JSON.stringify(normalized))],
      });
    };
    continue;
  }

  settingsUpdateRegistry[key as keyof UpdateSettingsInput] = ({ value }) => {
    let serialized: string | null;

    if ("serialize" in def) {
      serialized = def.serialize(value as never);
    } else {
      serialized = normalizeEnvInput(value as string);
    }

    const sideEffect = hasEnvKey
      ? () => {
          // biome-ignore lint/suspicious/noExplicitAny: def is constrained by kind
          applyEnvValue((def as any).envKey, serialized);
        }
      : undefined;

    const legacyKeysToClear =
      LEGACY_SETTINGS_TO_CLEAR_ON_UPDATE[targetKey]?.filter(
        (legacyKey) => legacyKey !== targetKey,
      ) ?? [];

    return result({
      actions: [
        persistAction(targetKey, serialized, sideEffect),
        ...legacyKeysToClear.map((legacyKey) => persistAction(legacyKey, null)),
      ],
    });
  };
}
