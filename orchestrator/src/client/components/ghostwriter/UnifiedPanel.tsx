import * as api from "@client/api";
import { useActiveCv } from "@client/hooks/useActiveCv";
import type { Job } from "@shared/types";
import type React from "react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { AtsCoverageBadge } from "./AtsCoverageBadge";
import { BriefDrawer } from "./BriefDrawer";
import { CoverLetterPane } from "./CoverLetterPane";
import { CvPdfPane } from "./CvPdfPane";
import { GhostwriterPanel } from "./GhostwriterPanel";

type UnifiedPanelProps = {
  job: Job;
  onJobUpdated: () => void | Promise<void>;
};

/**
 * Per-application feedback panel: compiled CV (PDF iframe) + cover-letter
 * editor up top, ATS badge + brief drawer in the middle, chat thread with
 * accept/reject diff cards below.
 *
 * The layout is shape-agnostic — the PDF iframe sidesteps the question of
 * how to render the source LaTeX inline, matches the recruiter view, and
 * refreshes via cache-bust whenever the server overwrites the artifact
 * (after an accepted CV edit or a re-tailor).
 */
export const UnifiedPanel: React.FC<UnifiedPanelProps> = ({
  job,
  onJobUpdated,
}) => {
  const { cv } = useActiveCv();
  const [pendingCoverLetter, setPendingCoverLetter] = useState<string | null>(
    null,
  );

  const handleUseAsCoverLetter = useCallback(
    async (content: string) => {
      // Optimistically reflect the pasted content; the cover-letter pane
      // re-syncs from the server-confirmed job once `onJobUpdated` resolves.
      setPendingCoverLetter(content);
      try {
        await api.updateJob(job.id, { coverLetterDraft: content });
        toast.success("Saved as cover-letter draft");
        await onJobUpdated();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to save cover letter";
        toast.error(message);
      } finally {
        setPendingCoverLetter(null);
      }
    },
    [job.id, onJobUpdated],
  );

  const coverLetterJob: Job =
    pendingCoverLetter !== null
      ? { ...job, coverLetterDraft: pendingCoverLetter }
      : job;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="grid min-h-[420px] flex-1 grid-cols-1 gap-3 lg:grid-cols-2">
        <CvPdfPane job={job} />
        <CoverLetterPane job={coverLetterJob} onJobUpdated={onJobUpdated} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <AtsCoverageBadge job={job} />
      </div>

      <BriefDrawer
        jobId={job.id}
        cvId={cv?.id ?? null}
        brief={cv?.personalBrief ?? ""}
        onJobUpdated={onJobUpdated}
      />

      <div className="flex min-h-[280px] flex-col rounded-md border border-border/60 bg-background p-3">
        <GhostwriterPanel
          job={job}
          onJobUpdated={onJobUpdated}
          onUseAsCoverLetter={handleUseAsCoverLetter}
        />
      </div>
    </div>
  );
};
