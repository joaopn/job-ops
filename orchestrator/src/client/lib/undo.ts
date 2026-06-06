/**
 * Shared undo helpers. In-scope triage operations only mutate
 * `status` / `outcome` / `closedAt`, and `PATCH /api/jobs/:id` writes those
 * directly with no transition guards — so undo is "snapshot those fields
 * before the op, PATCH them back after".
 */

import * as api from "@client/api";
import type { Job, JobListItem, JobOutcome, JobStatus } from "@shared/types.js";

export interface JobStateSnapshot {
  jobId: string;
  status: JobStatus;
  outcome: JobOutcome | null;
  closedAt: number | null;
}

/** Capture the reversible triage fields off a job (full or list item). */
export const snapshotJob = (job: Job | JobListItem): JobStateSnapshot => ({
  jobId: job.id,
  status: job.status,
  outcome: job.outcome,
  closedAt: job.closedAt,
});

export interface RestoreResult {
  restored: number;
  failed: number;
}

/** Restore each snapshot via PATCH; best-effort (never rejects). */
export const restoreJobStates = async (
  snapshots: JobStateSnapshot[],
): Promise<RestoreResult> => {
  const outcomes = await Promise.allSettled(
    snapshots.map((snap) =>
      api.updateJob(snap.jobId, {
        status: snap.status,
        outcome: snap.outcome,
        closedAt: snap.closedAt,
      }),
    ),
  );
  const failed = outcomes.filter((o) => o.status === "rejected").length;
  return { restored: outcomes.length - failed, failed };
};
