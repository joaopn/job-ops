import type { CreateJobInput } from "./jobs";
import type { LocationIntent, SourceLocationPlan } from "./location";
import type { SourceConfigSchema } from "./source-config";

export interface ExtractorProgressEvent {
  phase?: "list" | "job";
  currentUrl?: string;
  termsProcessed?: number;
  termsTotal?: number;
  listPagesProcessed?: number;
  listPagesTotal?: number;
  jobCardsFound?: number;
  jobPagesEnqueued?: number;
  jobPagesSkipped?: number;
  jobPagesProcessed?: number;
  detail?: string;
}

export interface ExtractorCapabilities {
  locationEvidence?: boolean;
  /**
   * When true, the extractor's run() composes all searchTerms[] into a
   * single boolean-OR query per location and fires one request per
   * (joined-query, location) pair. When false (default) the runner loops
   * per term. Switching to true changes max_jobs_per_term from
   * "per term × location" to "per query × location" — the cap now
   * applies to the joined result set.
   */
  joinedTerms?: boolean;
}

export interface ExtractorRuntimeContext {
  source: string;
  selectedSources: string[];
  settings: Record<string, string | undefined>;
  searchTerms: string[];
  selectedCountry: string;
  locationIntent?: LocationIntent;
  sourceLocationPlan?: SourceLocationPlan;
  getExistingJobUrls?: () => Promise<string[]>;
  shouldCancel?: () => boolean;
  onProgress?: (event: ExtractorProgressEvent) => void;
}

export interface ExtractorRunResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

export interface ExtractorManifest {
  id: string;
  displayName: string;
  providesSources: readonly string[];
  requiredEnvVars?: readonly string[];
  capabilities?: ExtractorCapabilities;
  configSchema?: SourceConfigSchema;
  run: (context: ExtractorRuntimeContext) => Promise<ExtractorRunResult>;
}
