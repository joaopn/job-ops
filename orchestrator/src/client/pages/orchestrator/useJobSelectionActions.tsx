import * as api from "@client/api";
import type {
  JobAction,
  JobActionResponse,
  JobListItem,
} from "@shared/types.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { FilterTab } from "./constants";
import { JobActionProgressToast } from "./JobActionProgressToast";
import {
  canMoveToReady,
  canRescore,
  canSkip,
  getFailedJobIds,
} from "./jobActions";
import { clampNumber } from "./utils";

const MAX_JOB_ACTION_JOB_IDS = 100;

const jobActionLabel: Record<JobAction, string> = {
  move_to_ready: "Tailoring selected jobs...",
  skip: "Skipping selected jobs...",
  rescore: "Calculating match scores...",
  move_to_selected: "Moving to Selected...",
  unselect: "Unselecting...",
  move_to_backlog: "Moving to Backlog...",
  mark_closed: "Closing applications...",
  reopen: "Reopening...",
};

const jobActionSuccessLabel: Record<JobAction, string> = {
  move_to_ready: "jobs tailored",
  skip: "jobs skipped",
  rescore: "matches recalculated",
  move_to_selected: "jobs moved to Selected",
  unselect: "jobs unselected",
  move_to_backlog: "jobs moved to Backlog",
  mark_closed: "applications closed",
  reopen: "jobs reopened",
};

interface UseJobSelectionActionsArgs {
  activeJobs: JobListItem[];
  activeTab: FilterTab;
  loadJobs: () => Promise<void>;
}

export function useJobSelectionActions({
  activeJobs,
  activeTab,
  loadJobs,
}: UseJobSelectionActionsArgs) {
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [jobActionInFlight, setJobActionInFlight] = useState<null | JobAction>(
    null,
  );
  const previousActiveTabRef = useRef<FilterTab>(activeTab);

  const selectedJobs = useMemo(
    () => activeJobs.filter((job) => selectedJobIds.has(job.id)),
    [activeJobs, selectedJobIds],
  );

  const canSkipSelected = useMemo(() => canSkip(selectedJobs), [selectedJobs]);
  const canMoveSelected = useMemo(
    () => canMoveToReady(selectedJobs),
    [selectedJobs],
  );
  const canRescoreSelected = useMemo(
    () => canRescore(selectedJobs),
    [selectedJobs],
  );

  useEffect(() => {
    if (previousActiveTabRef.current === activeTab) return;
    previousActiveTabRef.current = activeTab;
    setSelectedJobIds(new Set());
  }, [activeTab]);

  useEffect(() => {
    const activeJobIdSet = new Set(activeJobs.map((job) => job.id));
    setSelectedJobIds((previous) => {
      if (previous.size === 0) return previous;
      const next = new Set(
        Array.from(previous).filter((jobId) => activeJobIdSet.has(jobId)),
      );
      return next.size === previous.size ? previous : next;
    });
  }, [activeJobs]);

  const toggleSelectJob = useCallback((jobId: string) => {
    setSelectedJobIds((previous) => {
      const next = new Set(previous);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(
    (checked: boolean) => {
      setSelectedJobIds(() => {
        if (!checked) return new Set();
        const allIds = activeJobs.map((job) => job.id);
        if (allIds.length <= MAX_JOB_ACTION_JOB_IDS) {
          return new Set(allIds);
        }
        toast.error(
          `Select all is limited to ${MAX_JOB_ACTION_JOB_IDS} jobs per action.`,
        );
        return new Set(allIds.slice(0, MAX_JOB_ACTION_JOB_IDS));
      });
    },
    [activeJobs],
  );

  const selectAllAboveScore = useCallback(
    (threshold: number) => {
      const matchingIds = activeJobs
        .filter((job) => (job.suitabilityScore ?? -1) >= threshold)
        .map((job) => job.id);
      if (matchingIds.length === 0) {
        toast.message(`No jobs scored ≥ ${threshold} in this view.`);
        return;
      }
      if (matchingIds.length > MAX_JOB_ACTION_JOB_IDS) {
        toast.error(
          `Select all is limited to ${MAX_JOB_ACTION_JOB_IDS} jobs per action.`,
        );
        setSelectedJobIds(
          new Set(matchingIds.slice(0, MAX_JOB_ACTION_JOB_IDS)),
        );
        return;
      }
      setSelectedJobIds(new Set(matchingIds));
    },
    [activeJobs],
  );

  const clearSelection = useCallback(() => {
    setSelectedJobIds(new Set());
  }, []);

  const runJobAction = useCallback(
    // mark_closed needs an outcome; 5g.3b adds a dedicated path through
    // MarkClosedPopover. The bulk progress-toast hook only handles
    // option-less variants.
    async (action: Exclude<JobAction, "mark_closed">) => {
      const selectedAtStart = Array.from(selectedJobIds);
      if (selectedAtStart.length === 0) return;
      if (selectedAtStart.length > MAX_JOB_ACTION_JOB_IDS) {
        toast.error(
          `You can run job actions on up to ${MAX_JOB_ACTION_JOB_IDS} jobs at a time.`,
        );
        return;
      }

      const selectedAtStartSet = new Set(selectedAtStart);
      let progressToastId: string | number | undefined;
      let finalResult: JobActionResponse | null = null;
      let streamError: string | null = null;
      let latestProgress = {
        requested: selectedAtStart.length,
        completed: 0,
        succeeded: 0,
        failed: 0,
      };

      const getProgressTitle = () => {
        const safeRequested = Math.max(latestProgress.requested, 1);
        const safeCompleted = clampNumber(
          latestProgress.completed,
          0,
          safeRequested,
        );
        return `${safeCompleted}/${safeRequested} ${jobActionLabel[action]}`;
      };

      const upsertProgressToast = () => {
        progressToastId = toast.loading(getProgressTitle(), {
          description: (
            <JobActionProgressToast
              requested={latestProgress.requested}
              completed={latestProgress.completed}
              succeeded={latestProgress.succeeded}
              failed={latestProgress.failed}
            />
          ),
          ...(progressToastId !== undefined ? { id: progressToastId } : {}),
          duration: Number.POSITIVE_INFINITY,
        });
      };

      try {
        setJobActionInFlight(action);
        upsertProgressToast();
        await api.streamJobAction(
          {
            action,
            jobIds: selectedAtStart,
          },
          {
            onEvent: (event) => {
              if (event.type === "error") {
                streamError = event.message || "Failed to run job action";
                return;
              }

              if (event.type === "started") {
                latestProgress = {
                  requested: event.requested,
                  completed: event.completed,
                  succeeded: event.succeeded,
                  failed: event.failed,
                };
                upsertProgressToast();
                return;
              }

              if (event.type === "progress") {
                latestProgress = {
                  requested: event.requested,
                  completed: event.completed,
                  succeeded: event.succeeded,
                  failed: event.failed,
                };
                upsertProgressToast();
                return;
              }

              latestProgress = {
                requested: event.requested,
                completed: event.completed,
                succeeded: event.succeeded,
                failed: event.failed,
              };
              finalResult = {
                action: event.action,
                requested: event.requested,
                succeeded: event.succeeded,
                failed: event.failed,
                results: event.results,
              };
              upsertProgressToast();
            },
          },
        );

        if (streamError) {
          throw new Error(streamError);
        }

        if (!finalResult) {
          throw new Error("Job action stream ended before completion");
        }

        const result = finalResult as JobActionResponse;
        const failedIds = getFailedJobIds(result);
        const successLabel = jobActionSuccessLabel[action];

        if (result.failed === 0) {
          toast.success(`${result.succeeded} ${successLabel}`);
        } else {
          toast.error(
            `${result.succeeded} succeeded, ${result.failed} failed.`,
          );
        }

        await loadJobs();
        setSelectedJobIds((current) => {
          const addedDuringRequest = Array.from(current).filter(
            (jobId) => !selectedAtStartSet.has(jobId),
          );
          const removedDuringRequest = Array.from(selectedAtStartSet).filter(
            (jobId) => !current.has(jobId),
          );
          const next = new Set([
            ...Array.from(failedIds),
            ...addedDuringRequest,
          ]);
          for (const jobId of removedDuringRequest) next.delete(jobId);
          return next;
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to run job action";
        toast.error(message);
      } finally {
        if (progressToastId !== undefined) {
          toast.dismiss(progressToastId);
        }
        setJobActionInFlight(null);
      }
    },
    [selectedJobIds, loadJobs],
  );

  return {
    selectedJobIds,
    canSkipSelected,
    canMoveSelected,
    canRescoreSelected,
    jobActionInFlight,
    toggleSelectJob,
    toggleSelectAll,
    selectAllAboveScore,
    clearSelection,
    runJobAction,
  };
}
