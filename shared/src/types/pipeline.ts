import type { ExtractorSourceId } from "../extractors";
import type {
  LocationMatchStrictness,
  LocationSearchScope,
} from "../location-preferences";
import type { Job, JobOutcome, JobStatus } from "./jobs";
import type { LocationIntent } from "./location";

export interface PipelineConfig {
  topN: number; // Number of top jobs to process
  minSuitabilityScore: number; // Minimum score to auto-process
  sources: ExtractorSourceId[]; // Job sources to crawl
  outputDir: string; // Directory for generated PDFs
  locationIntent?: LocationIntent;
  enableCrawling?: boolean;
  enableScoring?: boolean;
  enableImporting?: boolean;
  enableAutoTailoring?: boolean;
}

export interface PipelineRunConfigSnapshot {
  topN: number;
  minSuitabilityScore: number;
  sources: ExtractorSourceId[];
  locationIntent: LocationIntent;
}

export interface PipelineRun {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "failed" | "cancelled";
  jobsDiscovered: number;
  jobsProcessed: number;
  errorMessage: string | null;
  configSnapshot?: PipelineRunConfigSnapshot | null;
}

export type PipelineRunExecutionStage =
  | "started"
  | "profile_loaded"
  | "discovery"
  | "import"
  | "scoring"
  | "selection"
  | "processing"
  | "completed";

export interface PipelineRunRequestedConfig {
  topN: number;
  minSuitabilityScore: number;
  sources: ExtractorSourceId[];
  enableCrawling: boolean;
  enableScoring: boolean;
  enableImporting: boolean;
  enableAutoTailoring: boolean;
}

export interface PipelineRunSourceLimitSnapshot {
  startupjobsMaxJobsPerTerm: number;
  jobspyResultsWanted: number;
}

export interface PipelineRunModelSnapshot {
  scorer: string;
  tailoring: string;
}

export interface PipelineRunSkippedSource {
  source: ExtractorSourceId;
  reason: string;
}

export interface PipelineRunEffectiveConfig {
  country: string | null;
  countryLabel: string | null;
  searchCities: string[];
  searchTermsCount: number;
  workplaceTypes: Array<"remote" | "hybrid" | "onsite">;
  locationSearchScope: LocationSearchScope;
  locationMatchStrictness: LocationMatchStrictness;
  compatibleSources: ExtractorSourceId[];
  skippedSources: PipelineRunSkippedSource[];
  blockedCompanyKeywordsCount: number;
  sourceLimits: PipelineRunSourceLimitSnapshot;
  autoSkipScoreThreshold: number | null;
  models: PipelineRunModelSnapshot;
}

export interface PipelineRunResultSummary {
  stage: PipelineRunExecutionStage;
  jobsScored: number | null;
  jobsSelected: number | null;
  sourceErrors: string[];
}

export interface PipelineRunSavedDetails {
  requestedConfig: PipelineRunRequestedConfig;
  effectiveConfig: PipelineRunEffectiveConfig;
  resultSummary: PipelineRunResultSummary;
}

export interface PipelineStatusResponse {
  isRunning: boolean;
  lastRun: PipelineRun | null;
  nextScheduledRun: string | null;
}

export type PipelineMetricQuality =
  | "exact"
  | "inferred_from_timestamps"
  | "unavailable";

export interface PipelineRunMetric<T = number | null> {
  value: T;
  quality: PipelineMetricQuality;
}

export interface PipelineRunInsights {
  run: PipelineRun;
  exactMetrics: {
    durationMs: number | null;
  };
  savedDetails: PipelineRunSavedDetails | null;
  inferredMetrics: {
    jobsCreated: PipelineRunMetric<number | null>;
    jobsUpdated: PipelineRunMetric<number | null>;
    jobsProcessed: PipelineRunMetric<number | null>;
  };
}

export interface JobsListResponse<TJob = Job> {
  jobs: TJob[];
  total: number;
  byStatus: Record<JobStatus, number>;
  revision: string;
}

export interface JobsRevisionResponse {
  revision: string;
  latestUpdatedAt: string | null;
  total: number;
  statusFilter: string | null;
}

export type JobAction =
  | "skip"
  | "move_to_ready"
  | "rescore"
  | "move_to_selected"
  | "unselect"
  | "move_to_backlog"
  | "mark_closed"
  | "reopen";

export type JobActionRequest =
  | {
      action:
        | "skip"
        | "rescore"
        | "move_to_selected"
        | "unselect"
        | "move_to_backlog"
        | "reopen";
      jobIds: string[];
    }
  | {
      action: "move_to_ready";
      jobIds: string[];
      options?: {
        force?: boolean;
      };
    }
  | {
      action: "mark_closed";
      jobIds: string[];
      options: {
        outcome: JobOutcome;
      };
    };

export type JobActionResult =
  | {
      jobId: string;
      ok: true;
      job: Job;
    }
  | {
      jobId: string;
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

export interface JobActionResponse {
  action: JobAction;
  requested: number;
  succeeded: number;
  failed: number;
  results: JobActionResult[];
}

export type LlmCallStatus = "running" | "succeeded" | "failed";

export interface LlmCallRecord {
  id: string;
  label: string;
  /** Optional secondary line — typically "Job Title @ Employer". */
  subject: string | null;
  model: string;
  status: LlmCallStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  jobId: string | null;
  errorMessage: string | null;
}

export type LlmCallStreamEvent =
  | { type: "snapshot"; calls: LlmCallRecord[]; requestId: string }
  | { type: "update"; call: LlmCallRecord; requestId: string };

export type BatchUrlImportItemResult =
  | {
      ok: true;
      status: "created" | "duplicate";
      url: string;
      jobId: string;
      title: string;
      employer: string;
    }
  | {
      ok: false;
      status: "failed";
      url: string;
      code: string;
      message: string;
    };

export type BatchUrlImportStreamEvent =
  | {
      type: "started";
      requested: number;
      requestId: string;
    }
  | {
      type: "progress";
      result: BatchUrlImportItemResult;
      completed: number;
      succeeded: number;
      duplicates: number;
      failed: number;
      requestId: string;
    }
  | {
      type: "completed";
      results: BatchUrlImportItemResult[];
      succeeded: number;
      duplicates: number;
      failed: number;
      requestId: string;
    }
  | {
      type: "error";
      code: string;
      message: string;
      requestId: string;
    };

export type JobActionStreamEvent =
  | {
      type: "started";
      action: JobAction;
      requested: number;
      completed: number;
      succeeded: number;
      failed: number;
      requestId: string;
    }
  | {
      type: "progress";
      action: JobAction;
      requested: number;
      completed: number;
      succeeded: number;
      failed: number;
      result: JobActionResult;
      requestId: string;
    }
  | {
      type: "completed";
      action: JobAction;
      requested: number;
      completed: number;
      succeeded: number;
      failed: number;
      results: JobActionResult[];
      requestId: string;
    }
  | {
      type: "error";
      code: string;
      message: string;
      requestId: string;
    };

