import * as api from "@client/api";
import { restoreJobStates, snapshotJob } from "@client/lib/undo";
import { toast } from "@client/lib/toast";
import type { Job, JobStatus } from "@shared/types.js";
import { Check, ChevronDown } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useUndo } from "./useUndoController";

/**
 * The three interchangeable pipeline stages. A job in any of these can be
 * freely moved to another — they carry no `outcome`/`closedAt`, aren't touched
 * by boot reconciliation, and (by provenance) already have a rendered PDF, so a
 * bare status PATCH is coherent in every direction. `processing` is
 * deliberately excluded: it reverts to `discovered` on boot and launches no
 * tailor when set directly.
 */
const STAGES: ReadonlyArray<{ status: JobStatus; label: string }> = [
  { status: "ready", label: "Tailoring" },
  { status: "applied", label: "Live" },
  { status: "in_progress", label: "Interviewing" },
];

const STAGE_STATUSES: ReadonlySet<JobStatus> = new Set(
  STAGES.map((stage) => stage.status),
);

interface JobStageSwitcherProps {
  job: Job;
  onJobUpdated: () => void | Promise<void>;
  onJobMoved?: (jobId: string) => void;
  className?: string;
}

export const JobStageSwitcher: React.FC<JobStageSwitcherProps> = ({
  job,
  onJobUpdated,
  onJobMoved,
  className,
}) => {
  const [isMoving, setIsMoving] = useState(false);
  const { pushUndo, undo } = useUndo();

  const handleMove = useCallback(
    async (target: JobStatus, label: string) => {
      if (target === job.status) return;
      try {
        setIsMoving(true);
        const snap = snapshotJob(job);
        await api.updateJob(job.id, { status: target });
        pushUndo({
          label: `Move to ${label}`,
          restore: async () => {
            await restoreJobStates([snap]);
          },
        });
        onJobMoved?.(job.id);
        await onJobUpdated();
        toast.success(`Moved to ${label}`, {
          action: { label: "Undo", onClick: () => undo() },
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to move job";
        toast.error(message);
      } finally {
        setIsMoving(false);
      }
    },
    [job, onJobMoved, onJobUpdated, pushUndo, undo],
  );

  if (!STAGE_STATUSES.has(job.status)) return null;

  const current = STAGES.find((stage) => stage.status === job.status);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={cn("h-8 gap-1.5 text-xs", className)}
          disabled={isMoving}
        >
          Stage: {current?.label ?? job.status}
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Move to stage</DropdownMenuLabel>
        {STAGES.map((stage) => {
          const isCurrent = stage.status === job.status;
          // Moving into Tailoring re-enters the ReadyPanel, which needs the
          // rendered CV PDF. Live/Interviewing jobs have one by provenance,
          // but guard anyway so a PDF-less row can't reach a broken state.
          const disabled =
            isCurrent || (stage.status === "ready" && !job.pdfPath);
          return (
            <DropdownMenuItem
              key={stage.status}
              disabled={disabled}
              onSelect={() => void handleMove(stage.status, stage.label)}
            >
              {isCurrent ? (
                <Check className="mr-2 h-4 w-4" />
              ) : (
                <span className="mr-2 inline-block h-4 w-4" />
              )}
              {stage.label}
              {stage.status === "ready" && !job.pdfPath && !isCurrent ? (
                <span className="ml-auto pl-2 text-[10px] text-muted-foreground">
                  no PDF
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
