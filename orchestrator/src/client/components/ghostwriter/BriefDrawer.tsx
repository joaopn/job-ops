import * as api from "@client/api";
import { queryKeys } from "@client/lib/queryKeys";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2, RefreshCcw, Save } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type BriefDrawerProps = {
  jobId: string;
  cvId: string | null;
  brief: string;
  onJobUpdated?: () => void | Promise<void>;
};

export const BriefDrawer: React.FC<BriefDrawerProps> = ({
  jobId,
  cvId,
  brief,
  onJobUpdated,
}) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(brief);
  const [isReTailoring, setIsReTailoring] = useState(false);
  const queryClient = useQueryClient();

  // Re-sync the textarea when the upstream brief changes (e.g. an accepted
  // brief-edit applied via the chat panel). Drop in-flight local edits — the
  // user's typed text is unsaved scratch.
  useEffect(() => {
    setDraft(brief);
  }, [brief]);

  const saveMutation = useMutation({
    mutationFn: async (next: string) => {
      if (!cvId) throw new Error("No active CV to save brief on");
      return api.updateCvDocument(cvId, { personalBrief: next });
    },
    onSuccess: (cv) => {
      if (cv?.id) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.cvDocuments.detail(cv.id),
        });
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.cvDocuments.list(),
      });
      toast.success("Brief saved");
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : "Failed to save brief";
      toast.error(message);
    },
  });

  const reTailor = useCallback(async () => {
    setIsReTailoring(true);
    try {
      await api.reTailorJob(jobId);
      toast.success("Re-tailored against current brief");
      await onJobUpdated?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Re-tailor failed";
      toast.error(message);
    } finally {
      setIsReTailoring(false);
    }
  }, [jobId, onJobUpdated]);

  const isDirty = draft !== brief;
  const canSave = isDirty && !saveMutation.isPending && Boolean(cvId);

  return (
    <div className="rounded-md border border-border/60 bg-background">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">Personal brief</span>
          <span className="text-[11px] text-muted-foreground">
            ({brief.length} chars)
          </span>
        </div>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="border-t border-border/60 px-3 pb-3 pt-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Paste a free-form summary of your background — projects, side gigs, soft skills, anything the CV doesn't capture verbatim."
            className="min-h-[160px] resize-y text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={reTailor}
              disabled={isReTailoring || !cvId}
            >
              {isReTailoring ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="h-3.5 w-3.5" />
              )}
              Re-tailor with brief
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1 text-xs"
              disabled={!canSave}
              onClick={() => saveMutation.mutate(draft)}
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save brief
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
