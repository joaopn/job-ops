import type { SourceConfigGlobalField } from "./source-config";

export interface ProviderInstanceRow {
  id: string;
  providerId: string;
  actorRef: string;
  label: string;
  templateId: string | null;
  enabled: boolean;
  inputTemplateJson: string;
  outputMappingJson: string;
  mappings: Partial<Record<SourceConfigGlobalField, boolean>>;
  updatedAt: string;
}

export interface CreateProviderInstanceInput {
  providerId: string;
  actorRef: string;
  label: string;
  templateId?: string | null;
  enabled?: boolean;
  inputTemplateJson: string;
  outputMappingJson?: string;
  mappings?: Partial<Record<SourceConfigGlobalField, boolean>>;
}

export interface UpdateProviderInstanceInput {
  actorRef?: string;
  label?: string;
  templateId?: string | null;
  enabled?: boolean;
  inputTemplateJson?: string;
  outputMappingJson?: string;
  mappings?: Partial<Record<SourceConfigGlobalField, boolean>>;
}

export interface ProviderActorTemplateSummary {
  id: string;
  providerId: string;
  actorRef: string;
  displayName: string;
  description: string;
  defaultInputTemplate: string;
  defaultMappings: Partial<Record<SourceConfigGlobalField, boolean>>;
}
