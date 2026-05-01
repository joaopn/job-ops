import * as api from "@client/api";
import {
  useMarkAsAppliedMutation,
  useSkipJobMutation,
} from "@client/hooks/queries/useJobMutations";
import { useHotkeys } from "@client/hooks/useHotkeys";
import { useActiveCv } from "@client/hooks/useActiveCv";
import { SHORTCUTS, isShortcutInScope } from "@client/lib/shortcut-map";
import type { JobAction, JobListItem } from "@shared/types.js";
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { safeFilenamePart } from "@/lib/utils";
import type { FilterTab } from "./constants";
import { tabs } from "./constants";

type UseKeyboardShortcutsArgs = {
  isAnyModalOpen: boolean;
  isAnyModalOpenExcludingCommandBar: boolean;
  isAnyModalOpenExcludingHelp: boolean;
  activeTab: FilterTab;
  activeJobs: JobListItem[];
  selectedJobId: string | null;
  selectedJob: JobListItem | null;
  selectedJobIds: Set<string>;
  isDesktop: boolean;
  handleSelectJobId: (id: string | null) => void;
  requestScrollToJob: (id: string, opts?: { ensureSelected?: boolean }) => void;
  setActiveTab: (tab: FilterTab) => void;
  setIsCommandBarOpen: (open: boolean) => void;
  setIsHelpDialogOpen: (updater: (prev: boolean) => boolean) => void;
  clearSelection: () => void;
  toggleSelectJob: (id: string) => void;
  runJobAction: (action: Exclude<JobAction, "mark_closed">) => Promise<void>;
  loadJobs: () => Promise<void>;
};

export function useKeyboardShortcuts(args: UseKeyboardShortcutsArgs): void {
  const {
    isAnyModalOpen,
    isAnyModalOpenExcludingCommandBar,
    isAnyModalOpenExcludingHelp,
    activeTab,
    activeJobs,
    selectedJobId,
    selectedJob,
    selectedJobIds,
    isDesktop: _isDesktop,
    handleSelectJobId,
    requestScrollToJob,
    setActiveTab,
    setIsCommandBarOpen,
    setIsHelpDialogOpen,
    clearSelection,
    toggleSelectJob,
    runJobAction,
    loadJobs,
  } = args;

  const shortcutActionInFlight = useRef(false);
  const markAsAppliedMutation = useMarkAsAppliedMutation();
  const skipJobMutation = useSkipJobMutation();
  const { personName } = useActiveCv();

  const navigateJobList = useCallback(
    (direction: 1 | -1) => {
      if (activeJobs.length === 0) return;
      const currentIndex = selectedJobId
        ? activeJobs.findIndex((j) => j.id === selectedJobId)
        : -1;
      const nextIndex = Math.max(
        0,
        Math.min(activeJobs.length - 1, currentIndex + direction),
      );
      const nextJob = activeJobs[nextIndex];
      if (nextJob && nextJob.id !== selectedJobId) {
        handleSelectJobId(nextJob.id);
        requestScrollToJob(nextJob.id);
      }
    },
    [activeJobs, selectedJobId, handleSelectJobId, requestScrollToJob],
  );

  const navigateTab = useCallback(
    (direction: 1 | -1) => {
      const currentIndex = tabs.findIndex((t) => t.id === activeTab);
      const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
      setActiveTab(tabs[nextIndex].id);
    },
    [activeTab, setActiveTab],
  );

  const selectNextAfterAction = useCallback(
    (movedJobId: string) => {
      const idx = activeJobs.findIndex((j) => j.id === movedJobId);
      const next = activeJobs[idx + 1] || activeJobs[idx - 1];
      handleSelectJobId(next?.id ?? null);
    },
    [activeJobs, handleSelectJobId],
  );

  useHotkeys(
    {
      // ── Navigation ──────────────────────────────────────────────────────
      [SHORTCUTS.nextJob.key]: (e) => {
        e.preventDefault();
        navigateJobList(1);
      },
      [SHORTCUTS.nextJobArrow.key]: (e) => {
        e.preventDefault();
        navigateJobList(1);
      },
      [SHORTCUTS.prevJob.key]: (e) => {
        e.preventDefault();
        navigateJobList(-1);
      },
      [SHORTCUTS.prevJobArrow.key]: (e) => {
        e.preventDefault();
        navigateJobList(-1);
      },

      // ── Tab switching ───────────────────────────────────────────────────
      [SHORTCUTS.tabInbox.key]: () => setActiveTab("inbox"),
      [SHORTCUTS.tabSelected.key]: () => setActiveTab("selected"),
      [SHORTCUTS.tabReady.key]: () => setActiveTab("ready"),
      [SHORTCUTS.tabLive.key]: () => setActiveTab("live"),
      [SHORTCUTS.tabBacklog.key]: () => setActiveTab("backlog"),
      [SHORTCUTS.tabClosed.key]: () => setActiveTab("closed"),
      [SHORTCUTS.tabAll.key]: () => setActiveTab("all"),
      [SHORTCUTS.prevTabArrow.key]: (e) => {
        e.preventDefault();
        navigateTab(-1);
      },
      [SHORTCUTS.nextTabArrow.key]: (e) => {
        e.preventDefault();
        navigateTab(1);
      },

      // ── Context actions ─────────────────────────────────────────────────
      [SHORTCUTS.skip.key]: () => {
        if (!isShortcutInScope(SHORTCUTS.skip, activeTab)) return;
        if (shortcutActionInFlight.current) return;

        if (selectedJobIds.size > 0) {
          void runJobAction("skip");
          return;
        }

        if (!selectedJob) return;
        shortcutActionInFlight.current = true;
        const jobId = selectedJob.id;
        skipJobMutation
          .mutateAsync(jobId)
          .then(async () => {
            toast.message("Job skipped");
            selectNextAfterAction(jobId);
            await loadJobs();
          })
          .catch((err: unknown) => {
            const msg =
              err instanceof Error ? err.message : "Failed to skip job";
            toast.error(msg);
          })
          .finally(() => {
            shortcutActionInFlight.current = false;
          });
      },

      [SHORTCUTS.markApplied.key]: () => {
        if (!selectedJob) return;
        if (activeTab !== "ready") return;
        if (shortcutActionInFlight.current) return;
        shortcutActionInFlight.current = true;
        const jobId = selectedJob.id;
        markAsAppliedMutation
          .mutateAsync(jobId)
          .then(async () => {
            toast.success("Marked as applied", {
              description: `${selectedJob.title} at ${selectedJob.employer}`,
            });
            selectNextAfterAction(jobId);
            await loadJobs();
          })
          .catch((err: unknown) => {
            const msg =
              err instanceof Error ? err.message : "Failed to mark as applied";
            toast.error(msg);
          })
          .finally(() => {
            shortcutActionInFlight.current = false;
          });
      },

      [SHORTCUTS.moveToReady.key]: () => {
        if (!isShortcutInScope(SHORTCUTS.moveToReady, activeTab)) return;
        if (shortcutActionInFlight.current) return;

        if (selectedJobIds.size > 0) {
          void runJobAction("move_to_ready");
          return;
        }

        if (!selectedJob) return;

        shortcutActionInFlight.current = true;
        const jobId = selectedJob.id;
        toast.message("Tailoring job...");

        api
          .processJob(jobId)
          .then(async () => {
            toast.success("Job tailored", {
              description: "Your tailored PDF has been generated.",
            });
            selectNextAfterAction(jobId);
            await loadJobs();
          })
          .catch((err: unknown) => {
            const msg =
              err instanceof Error ? err.message : "Failed to tailor job";
            toast.error(msg);
          })
          .finally(() => {
            shortcutActionInFlight.current = false;
          });
      },

      [SHORTCUTS.moveToSelected.key]: () => {
        if (!isShortcutInScope(SHORTCUTS.moveToSelected, activeTab)) return;
        if (shortcutActionInFlight.current) return;
        if (selectedJobIds.size > 0) {
          void runJobAction("move_to_selected");
        }
      },

      [SHORTCUTS.moveToBacklog.key]: () => {
        if (!isShortcutInScope(SHORTCUTS.moveToBacklog, activeTab)) return;
        if (shortcutActionInFlight.current) return;
        if (selectedJobIds.size > 0) {
          void runJobAction("move_to_backlog");
        }
      },

      [SHORTCUTS.reopenJob.key]: () => {
        if (!isShortcutInScope(SHORTCUTS.reopenJob, activeTab)) return;
        if (shortcutActionInFlight.current) return;
        if (selectedJobIds.size > 0) {
          void runJobAction("reopen");
        }
      },

      [SHORTCUTS.viewPdf.key]: () => {
        if (!selectedJob) return;
        if (activeTab !== "ready") return;
        const href = `/pdfs/resume_${selectedJob.id}.pdf?v=${encodeURIComponent(selectedJob.updatedAt)}`;
        window.open(href, "_blank", "noopener,noreferrer");
      },

      [SHORTCUTS.downloadPdf.key]: () => {
        if (!selectedJob) return;
        if (activeTab !== "ready") return;
        const href = `/pdfs/resume_${selectedJob.id}.pdf?v=${encodeURIComponent(selectedJob.updatedAt)}`;
        const a = document.createElement("a");
        a.href = href;
        a.download = `${safeFilenamePart(personName || "Unknown")}_${safeFilenamePart(selectedJob.employer)}.pdf`;
        a.click();
      },

      [SHORTCUTS.openListing.key]: () => {
        if (!selectedJob) return;
        const link = selectedJob.applicationLink || selectedJob.jobUrl;
        if (link) window.open(link, "_blank", "noopener,noreferrer");
      },

      [SHORTCUTS.toggleSelect.key]: () => {
        if (!selectedJobId) return;
        toggleSelectJob(selectedJobId);
      },

      [SHORTCUTS.clearSelection.key]: () => {
        if (selectedJobIds.size > 0) clearSelection();
      },
    },
    { enabled: !isAnyModalOpen },
  );

  useHotkeys(
    {
      // ── Search ──────────────────────────────────────────────────────────
      [SHORTCUTS.searchSlash.key]: (e) => {
        e.preventDefault();
        setIsCommandBarOpen(true);
      },
    },
    { enabled: !isAnyModalOpenExcludingCommandBar },
  );

  useHotkeys(
    {
      // ── Help ────────────────────────────────────────────────────────────
      [SHORTCUTS.help.key]: (e) => {
        e.preventDefault();
        setIsHelpDialogOpen((prev) => !prev);
      },
    },
    { enabled: !isAnyModalOpenExcludingHelp },
  );
}
