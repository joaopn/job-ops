import type { JobActionResponse, JobListItem } from "@shared/types";

const SKIPPABLE_STATUSES = new Set([
  "discovered",
  "selected",
  "ready",
  "backlog",
]);
const MOVE_TO_READY_STATUSES = new Set(["discovered", "selected"]);
const MOVE_TO_SELECTED_STATUSES = new Set(["discovered", "backlog", "ready"]);
const MOVE_TO_BACKLOG_STATUSES = new Set(["discovered", "selected"]);
const CLOSABLE_STATUSES = new Set(["applied", "in_progress"]);
const REOPENABLE_STATUSES = new Set(["skipped", "closed"]);

export function canSkip(jobs: JobListItem[]): boolean {
  return (
    jobs.length > 0 && jobs.every((job) => SKIPPABLE_STATUSES.has(job.status))
  );
}

export function canMoveToReady(jobs: JobListItem[]): boolean {
  return (
    jobs.length > 0 &&
    jobs.every((job) => MOVE_TO_READY_STATUSES.has(job.status))
  );
}

export function canRescore(jobs: JobListItem[]): boolean {
  return jobs.length > 0 && jobs.every((job) => job.status !== "processing");
}

export function canMoveToSelected(jobs: JobListItem[]): boolean {
  return (
    jobs.length > 0 &&
    jobs.every((job) => MOVE_TO_SELECTED_STATUSES.has(job.status))
  );
}

export function canMoveToBacklog(jobs: JobListItem[]): boolean {
  return (
    jobs.length > 0 &&
    jobs.every((job) => MOVE_TO_BACKLOG_STATUSES.has(job.status))
  );
}

export function canUnselect(jobs: JobListItem[]): boolean {
  return jobs.length > 0 && jobs.every((job) => job.status === "selected");
}

export function canMarkClosed(jobs: JobListItem[]): boolean {
  return (
    jobs.length > 0 && jobs.every((job) => CLOSABLE_STATUSES.has(job.status))
  );
}

export function canReopen(jobs: JobListItem[]): boolean {
  return (
    jobs.length > 0 && jobs.every((job) => REOPENABLE_STATUSES.has(job.status))
  );
}

export function getFailedJobIds(response: JobActionResponse): Set<string> {
  const failedIds = response.results
    .filter((result) => !result.ok)
    .map((result) => result.jobId);
  return new Set(failedIds);
}
