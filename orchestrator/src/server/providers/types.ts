import type {
  CreateJobInput,
  ProviderInstanceRow,
  SourceConfigGlobalField,
  SourceConfigRunGlobals,
} from "@shared/types";
import type { ExtractorProgressEvent, ExtractorRunResult } from "@shared/types";

export interface ProviderRunContext {
  instance: ProviderInstanceRow;
  runGlobals: SourceConfigRunGlobals;
  apiToken: string | null;
  searchTerms: string[];
  shouldCancel?: () => boolean;
  onProgress?: (event: ExtractorProgressEvent) => void;
}

export interface ProviderActorTemplate {
  id: string;
  providerId: string;
  actorRef: string;
  displayName: string;
  description: string;
  defaultInputTemplate: string;
  defaultMappings: Partial<Record<SourceConfigGlobalField, boolean>>;
  /**
   * Lower bounds for numeric placeholders this actor enforces server-side
   * (e.g. curious_coder/linkedin-jobs-scraper rejects count < 10). Clamped
   * during input substitution so a small maxJobsPerTerm never 400s the run.
   */
  placeholderMinimums?: Partial<Record<string, number>>;
  mapItem(
    item: unknown,
    context: { sourceId: string },
  ): CreateJobInput | null;
}

export interface ProviderRunner {
  id: string;
  displayName: string;
  templates: readonly ProviderActorTemplate[];
  run(context: ProviderRunContext): Promise<ExtractorRunResult>;
}

export type ProviderRegistry = Map<string, ProviderRunner>;
