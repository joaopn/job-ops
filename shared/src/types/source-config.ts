import type { ExtractorSourceId } from "../extractors";

export const SOURCE_CONFIG_GLOBAL_FIELDS = [
  "searchTerms",
  "city",
  "workplaceTypes",
  "country",
  "maxJobsPerTerm",
] as const;

export type SourceConfigGlobalField =
  (typeof SOURCE_CONFIG_GLOBAL_FIELDS)[number];

export const SOURCE_CONFIG_FIELD_TYPES = [
  "number",
  "text",
  "select",
  "secret",
  "textarea",
] as const;

export type SourceConfigFieldType = (typeof SOURCE_CONFIG_FIELD_TYPES)[number];

export interface SourceConfigField {
  key: string;
  label: string;
  type: SourceConfigFieldType;
  default?: string;
  options?: ReadonlyArray<{ label: string; value: string }>;
  description?: string;
}

export interface SourceConfigGlobalMapping {
  globalField: SourceConfigGlobalField;
  sourceField: string;
  enabledByDefault: boolean;
  description?: string;
}

export interface SourceConfigSchema {
  fields: ReadonlyArray<SourceConfigField>;
  globalMappings: ReadonlyArray<SourceConfigGlobalMapping>;
}

export interface SourceConfigRow {
  sourceId: ExtractorSourceId;
  enabled: boolean;
  config: Record<string, string>;
  mappings: Partial<Record<SourceConfigGlobalField, boolean>>;
  updatedAt: string;
}

export interface UpsertSourceConfigInput {
  enabled?: boolean;
  config?: Record<string, string>;
  mappings?: Partial<Record<SourceConfigGlobalField, boolean>>;
}

export type SourceConfigRunGlobals = Partial<
  Record<SourceConfigGlobalField, string>
>;
