import type { JobStatus } from "@shared/types";

export const queryKeys = {
  settings: {
    all: ["settings"] as const,
    current: () => [...queryKeys.settings.all, "current"] as const,
  },
  cvDocuments: {
    all: ["cv-documents"] as const,
    list: () => [...queryKeys.cvDocuments.all, "list"] as const,
    detail: (id: string) =>
      [...queryKeys.cvDocuments.all, "detail", id] as const,
    extractionPromptDefault: () =>
      [...queryKeys.cvDocuments.all, "extraction-prompt-default"] as const,
  },
  jobs: {
    all: ["jobs"] as const,
    list: (options?: { statuses?: JobStatus[]; view?: "list" | "full" }) =>
      [...queryKeys.jobs.all, "list", options ?? {}] as const,
    revision: (options?: { statuses?: JobStatus[] }) =>
      [...queryKeys.jobs.all, "revision", options ?? {}] as const,
    detail: (id: string) => [...queryKeys.jobs.all, "detail", id] as const,
    tasks: (id: string) => [...queryKeys.jobs.all, "tasks", id] as const,
    notes: (id: string) => [...queryKeys.jobs.all, "notes", id] as const,
  },
  pipeline: {
    all: ["pipeline"] as const,
    status: () => [...queryKeys.pipeline.all, "status"] as const,
    runs: () => [...queryKeys.pipeline.all, "runs"] as const,
    runInsights: (id: string) =>
      [...queryKeys.pipeline.all, "run-insights", id] as const,
  },
  prompts: {
    all: ["prompts"] as const,
    list: () => [...queryKeys.prompts.all, "list"] as const,
  },
} as const;
