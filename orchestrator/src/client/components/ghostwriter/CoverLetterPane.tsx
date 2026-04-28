import * as api from "@client/api";
import type { Job } from "@shared/types";
import { useMutation } from "@tanstack/react-query";
import { Copy, Loader2, Save } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { copyTextToClipboard } from "@/lib/utils";

type CoverLetterPaneProps = {
  job: Job;
  onJobUpdated?: () => void | Promise<void>;
};

/**
 * Editable cover-letter draft persisted on `jobs.coverLetterDraft`. The chat
 * thread can prefill this via the "Use as draft" affordance on assistant text
 * replies; the user is always free to edit directly.
 */
export const CoverLetterPane: React.FC<CoverLetterPaneProps> = ({
  job,
  onJobUpdated,
}) => {
  const [draft, setDraft] = useState(job.coverLetterDraft ?? "");

  // Re-sync when the upstream job changes (re-tailor, accept-edit, etc.).
  // Dropping in-flight local edits is acceptable — a save would have
  // committed them already.
  useEffect(() => {
    setDraft(job.coverLetterDraft ?? "");
  }, [job.coverLetterDraft]);

  const saveMutation = useMutation({
    mutationFn: (next: string) =>
      api.updateJob(job.id, { coverLetterDraft: next }),
    onSuccess: async () => {
      toast.success("Cover letter saved");
      await onJobUpdated?.();
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : "Failed to save cover letter";
      toast.error(message);
    },
  });

  const isDirty = draft !== (job.coverLetterDraft ?? "");
  const canSave = isDirty && !saveMutation.isPending;

  const copy = async () => {
    if (!draft.trim()) return;
    try {
      await copyTextToClipboard(draft);
      toast.success("Copied cover letter");
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Cover letter draft
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={copy}
            disabled={!draft.trim()}
          >
            <Copy className="h-3 w-3" />
            Copy
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={!canSave}
            onClick={() => saveMutation.mutate(draft)}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            Save
          </Button>
        </div>
      </div>
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Ask the chat to draft a cover letter, then click 'Use as draft' on the reply — or paste/edit directly here."
        className="h-full min-h-[320px] flex-1 resize-none font-mono text-xs leading-relaxed"
      />
    </div>
  );
};
