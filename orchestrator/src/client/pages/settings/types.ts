import type {
  ChatStyleLanguageMode,
  ChatStyleManualLanguage,
  SuitabilityCategory,
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
  autoSkipCategory: EffectiveDefault<SuitabilityCategory | null>;
  blockedCompanyKeywords: EffectiveDefault<string[]>;
  scoringInstructions: EffectiveDefault<string>;
};

export type PipelineSettingsValues = {
  autoTailoringEnabled: EffectiveDefault<boolean>;
  enableJobScoring: EffectiveDefault<boolean>;
  inboxStaleThresholdDays: EffectiveDefault<number>;
  inboxAgeoutThresholdDays: EffectiveDefault<number>;
  maxCvUploadBytes: EffectiveDefault<number>;
  maxCoverLetterUploadBytes: EffectiveDefault<number>;
  maxExpandedLatexBytes: EffectiveDefault<number>;
};

export type ContextLimitsValues = {
  maxBriefChars: EffectiveDefault<number>;
  maxJobDescriptionChars: EffectiveDefault<number>;
  maxTailoredContentChars: EffectiveDefault<number>;
  maxCoverLetterChars: EffectiveDefault<number>;
  maxFetchedJobHtmlChars: EffectiveDefault<number>;
  maxExtractionPromptChars: EffectiveDefault<number>;
};
