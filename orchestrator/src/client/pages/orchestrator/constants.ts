import {
  EXTRACTOR_SOURCE_IDS,
  EXTRACTOR_SOURCE_METADATA,
  PIPELINE_EXTRACTOR_SOURCE_IDS,
} from "@shared/extractors";
import type { JobSource, JobStatus } from "@shared/types";

export const DEFAULT_PIPELINE_SOURCES: JobSource[] = ["indeed", "linkedin"];
export const PIPELINE_SOURCES_STORAGE_KEY = "jobops.pipeline.sources";

export const orderedSources: JobSource[] = [
  ...PIPELINE_EXTRACTOR_SOURCE_IDS,
].sort(
  (left, right) =>
    EXTRACTOR_SOURCE_METADATA[left].order -
    EXTRACTOR_SOURCE_METADATA[right].order,
);
export const orderedFilterSources: JobSource[] = [...EXTRACTOR_SOURCE_IDS].sort(
  (left, right) =>
    EXTRACTOR_SOURCE_METADATA[left].order -
    EXTRACTOR_SOURCE_METADATA[right].order,
);

export const statusTokens: Record<
  JobStatus,
  { label: string; badge: string; dot: string }
> = {
  discovered: {
    label: "Discovered",
    badge: "border-sky-500/30 bg-sky-500/10 text-sky-200",
    dot: "bg-sky-400",
  },
  selected: {
    label: "Selected",
    badge: "border-violet-500/30 bg-violet-500/10 text-violet-200",
    dot: "bg-violet-400",
  },
  processing: {
    label: "Processing",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    dot: "bg-amber-400",
  },
  ready: {
    label: "Ready",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    dot: "bg-emerald-400",
  },
  applied: {
    label: "Applied",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
    dot: "bg-emerald-400",
  },
  in_progress: {
    label: "In Progress",
    badge: "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
    dot: "bg-cyan-400",
  },
  backlog: {
    label: "Backlog",
    badge: "border-muted-foreground/20 bg-muted/30 text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  skipped: {
    label: "Skipped",
    badge: "border-rose-500/30 bg-rose-500/10 text-rose-200",
    dot: "bg-rose-400",
  },
  closed: {
    label: "Closed",
    badge: "border-muted-foreground/20 bg-muted/30 text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

export const defaultStatusToken = {
  label: "Unknown",
  badge: "border-muted-foreground/20 bg-muted/30 text-muted-foreground",
  dot: "bg-muted-foreground",
};

export const appliedDuplicateIndicator = {
  label: "Previously Applied",
  dot: "bg-yellow-400",
};

export type FilterTab =
  | "inbox"
  | "selected"
  | "ready"
  | "live"
  | "backlog"
  | "closed"
  | "all";
export type DateFilterPreset = "7" | "14" | "30" | "90" | "custom";
export type DateFilterDimension = "ready" | "applied" | "closed" | "discovered";

export type SortKey =
  | "date"
  | "discoveredAt"
  | "posted"
  | "score"
  | "salary"
  | "title"
  | "employer";
export type SortDirection = "asc" | "desc";
export type SponsorFilter =
  | "all"
  | "confirmed"
  | "potential"
  | "not_found"
  | "unknown";
export type SalaryFilterMode = "at_least" | "at_most" | "between";

export interface SalaryFilter {
  mode: SalaryFilterMode;
  min: number | null;
  max: number | null;
}

export interface JobSort {
  key: SortKey;
  direction: SortDirection;
  datePriority?: DateFilterDimension[];
}

export interface JobDateFilter {
  dimensions: DateFilterDimension[];
  startDate: string | null;
  endDate: string | null;
  preset: DateFilterPreset | null;
}

export const DEFAULT_SORT: JobSort = { key: "score", direction: "desc" };
export const DEFAULT_DATE_FILTER: JobDateFilter = {
  dimensions: [],
  startDate: null,
  endDate: null,
  preset: null,
};

export const sortLabels: Record<JobSort["key"], string> = {
  date: "Date",
  discoveredAt: "Discovered",
  posted: "Posted",
  score: "Score",
  salary: "Salary",
  title: "Title",
  employer: "Company",
};

export const defaultSortDirection: Record<JobSort["key"], SortDirection> = {
  date: "desc",
  discoveredAt: "desc",
  posted: "desc",
  score: "desc",
  salary: "desc",
  title: "asc",
  employer: "asc",
};

export type ClosedSubFilter =
  | "all"
  | "skipped"
  | "rejected"
  | "withdrawn"
  | "ghosted"
  | "other";

export const ALLOWED_CLOSED_SUB_FILTERS: ClosedSubFilter[] = [
  "all",
  "skipped",
  "rejected",
  "withdrawn",
  "ghosted",
  "other",
];

export const tabs: Array<{
  id: FilterTab;
  label: string;
  statuses: JobStatus[];
}> = [
  { id: "inbox", label: "Inbox", statuses: ["discovered"] },
  { id: "selected", label: "Selected", statuses: ["selected", "processing"] },
  { id: "ready", label: "Ready", statuses: ["ready"] },
  { id: "live", label: "Live", statuses: ["applied", "in_progress"] },
  { id: "backlog", label: "Backlog", statuses: ["backlog"] },
  { id: "closed", label: "Closed", statuses: ["skipped", "closed"] },
  { id: "all", label: "All Jobs", statuses: [] },
];

export const emptyStateCopy: Record<FilterTab, string> = {
  inbox: "Run the pipeline to discover new jobs.",
  selected: "No jobs queued for tailoring. Move rows from Inbox to Selected.",
  ready: "Tailor selected jobs to generate PDFs.",
  live: "Applied jobs land here. Mark a Ready row as Applied to start tracking.",
  backlog: "Empty. Inbox rows that age past the threshold land here automatically; reposted listings get re-promoted.",
  closed: "Empty. Skipped jobs and Live rows you Mark Closed land here with an outcome chip.",
  all: "No jobs in the system yet. Run the pipeline to get started.",
};

export const dateFilterDimensionLabels: Record<DateFilterDimension, string> = {
  ready: "Ready",
  applied: "Applied",
  closed: "Closed",
  discovered: "Discovered",
};

export const dateFilterDimensionOrder: DateFilterDimension[] = [
  "ready",
  "applied",
  "closed",
  "discovered",
];
