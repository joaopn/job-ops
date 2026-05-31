import type {
  CapturedRunJob,
  CreateJobInput,
  RunJobBucket,
} from "@shared/types";

/**
 * In-memory capture of the actual jobs behind each per-source funnel count for
 * the current run. The banner's clickable counts read from here. Reset at the
 * start of every run (alongside progress state); a server restart loses it,
 * which matches the banner only ever showing the latest run.
 */
type SourceBuckets = Record<RunJobBucket, CapturedRunJob[]>;

const captureBySource = new Map<string, SourceBuckets>();

function emptyBuckets(): SourceBuckets {
  return { scraped: [], imported: [], duplicated: [], rejected: [] };
}

export function toCapturedRunJob(
  input: CreateJobInput,
  reason?: string,
): CapturedRunJob {
  return {
    title: input.title,
    employer: input.employer,
    jobUrl: input.jobUrl,
    applicationLink: input.applicationLink,
    employerUrl: input.employerUrl,
    location: input.location,
    datePosted: input.datePosted,
    deadline: input.deadline,
    salary: input.salary,
    jobType: input.jobType,
    jobLevel: input.jobLevel,
    jobFunction: input.jobFunction,
    isRemote: input.isRemote,
    reason,
  };
}

export function resetRunJobCapture(): void {
  captureBySource.clear();
}

/**
 * Clear one source's captured buckets. Used by a per-source re-run so that
 * re-running a source drops its stale captures (instead of stacking onto
 * them) while leaving every other source's captures intact.
 */
export function resetRunJobCaptureForSource(source: string): void {
  captureBySource.delete(source);
}

/** Append captured jobs to a source's bucket (called as the run progresses). */
export function captureRunJobs(
  source: string,
  bucket: RunJobBucket,
  jobs: CapturedRunJob[],
): void {
  if (jobs.length === 0) return;
  let buckets = captureBySource.get(source);
  if (!buckets) {
    buckets = emptyBuckets();
    captureBySource.set(source, buckets);
  }
  buckets[bucket].push(...jobs);
}

export function getRunJobs(
  source: string,
  bucket: RunJobBucket,
): CapturedRunJob[] {
  return captureBySource.get(source)?.[bucket] ?? [];
}
