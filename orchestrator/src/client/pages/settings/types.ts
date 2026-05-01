import type {
  ChatStyleLanguageMode,
  ChatStyleManualLanguage,
} from "@shared/types.js";

export type EffectiveDefault<T> = {
  effective: T;
  default: T;
};

export type ModelValues = EffectiveDefault<string> & {
  scorer: string;
  tailoring: string;
  llmProvider: string;
  llmBaseUrl: string;
  llmApiKeyHint: string | null;
};

export type DisplayValues = {
  showSponsorInfo: EffectiveDefault<boolean>;
  renderMarkdownInJobDescriptions: EffectiveDefault<boolean>;
};
export type ChatValues = {
  tone: EffectiveDefault<string>;
  formality: EffectiveDefault<string>;
  constraints: EffectiveDefault<string>;
  doNotUse: EffectiveDefault<string>;
  languageMode: EffectiveDefault<ChatStyleLanguageMode>;
  manualLanguage: EffectiveDefault<ChatStyleManualLanguage>;
  summaryMaxWords: EffectiveDefault<number | null>;
  maxKeywordsPerSkill: EffectiveDefault<number | null>;
};

export type EnvSettingsValues = {
  readable: {
    basicAuthUser: string;
    basicAuthPassword: string;
  };
  private: {
    basicAuthPasswordHint: string | null;
  };
  basicAuthActive: boolean;
};

export type ScoringValues = {
  penalizeMissingSalary: EffectiveDefault<boolean>;
  missingSalaryPenalty: EffectiveDefault<number>;
  autoSkipScoreThreshold: EffectiveDefault<number | null>;
  blockedCompanyKeywords: EffectiveDefault<string[]>;
  scoringInstructions: EffectiveDefault<string>;
};

export type PipelineSettingsValues = {
  autoTailoringEnabled: EffectiveDefault<boolean>;
  inboxStaleThresholdDays: EffectiveDefault<number>;
  inboxAgeoutThresholdDays: EffectiveDefault<number>;
};
