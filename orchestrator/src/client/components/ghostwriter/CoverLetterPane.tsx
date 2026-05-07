import * as api from "@client/api";
import { useActiveCoverLetter } from "@client/hooks/useActiveCoverLetter";
import type { Job } from "@shared/types";
import { useMutation } from "@tanstack/react-query";
import {
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  Save,
  Sparkles,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { copyTextToClipboard } from "@/lib/utils";
import { cn } from "@/lib/utils";

type CoverLetterPaneProps = {
  job: Job;
  onJobUpdated?: () => void | Promise<void>;
};

type Tab = "edit" | "pdf";

/**
 * Per-job cover-letter editor with Edit/PDF tab toggle.
 *
 * Edit tab — textarea bound to `coverLetterFieldOverrides[bodyFieldId]`,
 * falling back to the doc's default body when no override exists yet,
 * then to the legacy `coverLetterDraft` text column for users without a
 * cover-letter doc.
 *
 * PDF tab — iframe of `/pdfs/cover_letter_<jobId>.pdf` cache-busted on
 * `job.updatedAt`. Empty-state until the user runs Render.
 *
 * Render PDF — autosaves any dirty textarea content, then calls
 * `/api/jobs/:id/render-cover-letter`, then auto-switches to the PDF
 * tab so the user sees the compiled output.
 */
export const CoverLetterPane: React.FC<CoverLetterPaneProps> = ({
  job,
  onJobUpdated,
}) => {
  const { coverLetter, bodyFieldId, bodyDefault } = useActiveCoverLetter();
  const [tab, setTab] = useState<Tab>("edit");
  const renderedOnceRef = useRef(false);

  const persistedBody = useMemo(() => {
    if (bodyFieldId) {
      const override = job.coverLetterFieldOverrides?.[bodyFieldId];
      if (override) return override;
      if (job.coverLetterDraft) return job.coverLetterDraft;
      return bodyDefault;
    }
    return job.coverLetterDraft ?? "";
  }, [bodyFieldId, bodyDefault, job.coverLetterFieldOverrides, job.coverLetterDraft]);

  const [draft, setDraft] = useState(persistedBody);

  useEffect(() => {
    setDraft(persistedBody);
  }, [persistedBody]);

  const isDirty = draft !== persistedBody;
  const hasPdf = Boolean(job.coverLetterPdfPath);

  const saveOverride = useMutation({
    mutationFn: async (next: string) => {
      if (bodyFieldId) {
        const overrides = {
          ...(job.coverLetterFieldOverrides ?? {}),
          [bodyFieldId]: next,
        };
        return api.updateJob(job.id, {
          coverLetterFieldOverrides: overrides,
        });
      }
      return api.updateJob(job.id, { coverLetterDraft: next });
    },
    onSuccess: async () => {
      await onJobUpdated?.();
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : "Failed to save cover letter";
      toast.error(message);
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => api.generateCoverLetter(job.id),
    onSuccess: async () => {
      toast.success("Cover letter drafted");
      await onJobUpdated?.();
    },
    onError: (error) => {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to generate cover letter";
      toast.error(message);
    },
  });

  const renderMutation = useMutation({
    mutationFn: async () => {
      if (isDirty) {
        await saveOverride.mutateAsync(draft);
      }
      return api.renderCoverLetterPdf(job.id);
    },
    onSuccess: async () => {
      toast.success("Cover letter PDF rendered");
      await onJobUpdated?.();
      setTab("pdf");
      renderedOnceRef.current = true;
    },
    onError: (error) => {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to render cover-letter PDF";
      toast.error(message);
    },
  });

  const canSave = isDirty && !saveOverride.isPending;
  const canGenerate =
    !!coverLetter && !!bodyFieldId && !generateMutation.isPending;
  const canRender =
    !!coverLetter && !renderMutation.isPending && !saveOverride.isPending;

  const handleSave = () => {
    saveOverride.mutate(draft, {
      onSuccess: () => {
        toast.success("Cover letter saved");
      },
    });
  };

  const copy = async () => {
    if (!draft.trim()) return;
    try {
      await copyTextToClipboard(draft);
      toast.success("Copied cover letter");
    } catch {
      toast.error("Could not copy");
    }
  };

  const pdfHref = `/pdfs/cover_letter_${job.id}.pdf?v=${encodeURIComponent(job.updatedAt)}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <TabButton
            active={tab === "edit"}
            onClick={() => setTab("edit")}
          >
            Edit
          </TabButton>
          <TabButton
            active={tab === "pdf"}
            onClick={() => setTab("pdf")}
            disabled={!hasPdf && !renderedOnceRef.current}
          >
            PDF
          </TabButton>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => generateMutation.mutate()}
            disabled={!canGenerate}
            title={
              !coverLetter
                ? "Upload a cover-letter template on the Cover Letter page first"
                : undefined
            }
          >
            {generateMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" />
            )}
            Generate
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => renderMutation.mutate()}
            disabled={!canRender}
            title={
              !coverLetter
                ? "Upload a cover-letter template on the Cover Letter page first"
                : undefined
            }
          >
            {renderMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <FileText className="h-3 w-3" />
            )}
            Render PDF
          </Button>
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
            onClick={handleSave}
          >
            {saveOverride.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            Save
          </Button>
        </div>
      </div>

      {!coverLetter ? (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
          <Mail className="h-3.5 w-3.5" />
          No cover-letter template uploaded — Generate / Render PDF are
          disabled. Upload one from the Cover Letter page.
        </div>
      ) : null}

      {tab === "edit" ? (
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            coverLetter
              ? "Click Generate to draft a cover letter for this job — or write directly here."
              : "Ask the chat to draft a cover letter, then click 'Use as draft' on the reply — or paste/edit directly here."
          }
          className="h-full min-h-[320px] flex-1 resize-none font-mono text-xs leading-relaxed"
        />
      ) : hasPdf ? (
        <div className="flex h-full min-h-0 flex-col">
          <div className="mb-2 flex items-center justify-end">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
            >
              <a href={pdfHref} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3" />
                Open in new tab
              </a>
            </Button>
          </div>
          <iframe
            title="Compiled cover-letter preview"
            src={pdfHref}
            className="h-full min-h-[320px] w-full flex-1 rounded-md border border-border/60 bg-background"
          />
        </div>
      ) : (
        <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/60 bg-muted/10 text-center">
          <FileText className="h-6 w-6 text-muted-foreground" />
          <div className="text-sm font-medium text-muted-foreground">
            No cover-letter PDF rendered yet
          </div>
          <p className="max-w-[260px] text-xs text-muted-foreground/80">
            Click "Render PDF" to compile the current draft into a PDF.
          </p>
        </div>
      )}
    </div>
  );
};

const TabButton: React.FC<{
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, disabled, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
      active
        ? "bg-muted text-foreground"
        : "text-muted-foreground hover:bg-muted/40",
    )}
  >
    {children}
  </button>
);
