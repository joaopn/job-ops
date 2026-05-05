import type {
  CreateJobInput,
  Job,
  PipelineConfig,
  SuitabilityCategory,
} from "@shared/types";

export type ScoredJob = Job & {
  suitabilityCategory: SuitabilityCategory;
  suitabilityReason: string;
};

export type RunPipelineContext = {
  mergedConfig: PipelineConfig;
  brief: string;
  discoveredJobs: CreateJobInput[];
  sourceErrors: string[];
  created: number;
  skipped: number;
  unprocessedJobs: Job[];
  scoredJobs: ScoredJob[];
  jobsToProcess: ScoredJob[];
  processedCount: number;
};
