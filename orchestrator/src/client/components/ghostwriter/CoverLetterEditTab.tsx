import * as api from "@client/api";
import type { CoverLetterDocument, Job } from "@shared/types";
import { useMutation } from "@tanstack/react-query";
import {
  Copy,
  FileText,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "@client/lib/toast";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn, copyTextToClipboard } from "@/lib/utils";
import { CvFieldsEditor } from "./CvFieldsEditor";
import { CvRawEditor, type CvRawEditorHandle } from "./CvRawEditor";

const NO_LOCKS: ReadonlySet<string> = new Set();

type Props = {
  job: Job;
  coverLetter: CoverLetterDocument;
  bodyFieldId: string | null;
  onJobUpdated: () => void | Promise<void>;
  onRendered: () => void;
  /** Edit|PDF parent-tab strip hoisted from `CoverLetterPane`. */
  tabSwitch?: React.ReactNode;
};

type SubTab = "fields" | "raw";

/**
 * Surface a legacy free-text `coverLetterDraft` as the body field's value so
 * it stays visible/editable after the move to the per-field override model.
 * Equal-to-default entries drop back out at diff time, so this is safe even
 * when the draft matches the template body.
 */
function seedOverrides(
  job: Job,
  bodyFieldId: string | null,
): Record<string, string> {
  const next: Record<string, string> = {
    ...(job.coverLetterFieldOverrides ?? {}),
  };
  if (bodyFieldId && job.coverLetterDraft && next[bodyFieldId] === undefined) {
    next[bodyFieldId] = job.coverLetterDraft;
  }
  return next;
}

function diffOverrides(
  local: Record<string, string>,
  fields: { id: string; value: string }[],
  defaults: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const fieldIds = new Set(fields.map((f) => f.id));
  for (const [id, value] of Object.entries(local)) {
    if (!fieldIds.has(id)) continue;
    const baseline = defaults[id] ?? fields.find((f) => f.id === id)?.value;
    if (baseline !== undefined && value === baseline) continue;
    out[id] = value;
  }
  return out;
}

/**
 * Edit tab for `CoverLetterPane`: a per-field editor over the active
 * cover-letter document, mirroring `CvEditTab` but bound to
 * `coverLetterFieldOverrides` and without the lock model. All extracted
 * fields are editable (not just the body) via Fields/Raw sub-tabs, then
 * Generate (LLM re-draft), Render PDF, Copy (body), and Save.
 */
export const CoverLetterEditTab: React.FC<Props> = ({
  job,
  coverLetter,
  bodyFieldId,
  onJobUpdated,
  onRendered,
  tabSwitch,
}) => {
  const defaults = coverLetter.defaultFieldValues ?? {};

  const [overrides, setOverrides] = useState<Record<string, string>>(() =>
    seedOverrides(job, bodyFieldId),
  );
  const [subTab, setSubTab] = useState<SubTab>("fields");
  const rawHandleRef = useRef<CvRawEditorHandle | null>(null);

  useEffect(() => {
    setOverrides(seedOverrides(job, bodyFieldId));
  }, [job.coverLetterFieldOverrides, job.coverLetterDraft, bodyFieldId]);

  const buildPatch = (
    effectiveOverrides: Record<string, string>,
  ): Partial<Job> | null => {
    const diffed = diffOverrides(effectiveOverrides, coverLetter.fields, defaults);
    const persistedOv = job.coverLetterFieldOverrides ?? {};
    const ovKeys = Object.keys(diffed);
    let ovDirty = ovKeys.length !== Object.keys(persistedOv).length;
    if (!ovDirty) {
      for (const k of ovKeys) {
        if (persistedOv[k] !== diffed[k]) {
          ovDirty = true;
          break;
        }
      }
    }
    if (!ovDirty) return null;
    return { coverLetterFieldOverrides: diffed };
  };

  const isDirty = buildPatch(overrides) !== null;

  const saveMutation = useMutation({
    mutationFn: async (patch: Partial<Job>) => api.updateJob(job.id, patch),
    onSuccess: async () => {
      await onJobUpdated();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save cover-letter edits",
      );
    },
  });

  const renderMutation = useMutation({
    mutationFn: async (patch: Partial<Job> | null) => {
      if (patch) {
        await saveMutation.mutateAsync(patch);
      }
      return api.renderCoverLetterPdf(job.id);
    },
    onSuccess: async () => {
      toast.success("Cover letter PDF rendered");
      await onJobUpdated();
      onRendered();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to render cover-letter PDF",
      );
    },
  });

  const generateMutation = useMutation({
    mutationFn: () => api.generateCoverLetter(job.id),
    onSuccess: async () => {
      toast.success("Cover letter drafted");
      await onJobUpdated();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to generate cover letter",
      );
    },
  });

  /**
   * Parse + commit the Raw textarea (when active) and return the effective
   * overrides for the caller to use now — setOverrides is async, so raw-edited
   * values aren't yet in the `overrides` closure variable.
   */
  const resolveEffectiveOverrides = (): Record<string, string> | null => {
    if (subTab !== "raw") return overrides;
    const handle = rawHandleRef.current;
    if (!handle) return overrides;
    const result = handle.commit();
    if (!result.ok) {
      toast.error("Fix the parse errors before saving.");
      return null;
    }
    return result.overrides;
  };

  const handleFieldChange = (id: string, value: string) => {
    setOverrides((prev) => ({ ...prev, [id]: value }));
  };

  const handleReset = (id: string) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const handleResetAll = () => {
    if (
      !window.confirm(
        "Reset all cover-letter field overrides to the original defaults?",
      )
    ) {
      return;
    }
    setOverrides({});
  };

  const handleSwitchSubTab = (next: SubTab) => {
    if (next === subTab) return;
    if (subTab === "raw") {
      if (resolveEffectiveOverrides() === null) return;
    }
    setSubTab(next);
  };

  const handleSave = () => {
    const effective = resolveEffectiveOverrides();
    if (effective === null) return;
    const patch = buildPatch(effective);
    if (!patch) return;
    saveMutation.mutate(patch);
  };

  const handleRender = () => {
    const effective = resolveEffectiveOverrides();
    if (effective === null) return;
    const patch = buildPatch(effective);
    renderMutation.mutate(patch);
  };

  const bodyValue = bodyFieldId
    ? (overrides[bodyFieldId] ??
      defaults[bodyFieldId] ??
      coverLetter.fields.find((f) => f.id === bodyFieldId)?.value ??
      "")
    : "";

  const copyBody = async () => {
    if (!bodyValue.trim()) return;
    try {
      await copyTextToClipboard(bodyValue);
      toast.success("Copied cover letter");
    } catch {
      toast.error("Could not copy");
    }
  };

  const busy =
    saveMutation.isPending ||
    renderMutation.isPending ||
    generateMutation.isPending;
  const canSave = (isDirty || subTab === "raw") && !busy;
  const canRender = !busy;
  const canGenerate = !!bodyFieldId && !busy;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {tabSwitch ? (
          <>
            {tabSwitch}
            <Separator orientation="vertical" className="h-6" />
          </>
        ) : null}
        <div className="flex items-center gap-1">
          <SubTabButton
            active={subTab === "fields"}
            onClick={() => handleSwitchSubTab("fields")}
          >
            Fields
          </SubTabButton>
          <SubTabButton
            active={subTab === "raw"}
            onClick={() => handleSwitchSubTab("raw")}
          >
            Raw
          </SubTabButton>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handleResetAll}
            disabled={Object.keys(overrides).length === 0}
          >
            <RotateCcw className="h-3 w-3" />
            Reset all
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => generateMutation.mutate()}
            disabled={!canGenerate}
            title="Draft this cover letter against the job with the LLM"
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
            onClick={handleRender}
            disabled={!canRender}
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
            onClick={copyBody}
            disabled={!bodyValue.trim()}
          >
            <Copy className="h-3 w-3" />
            Copy
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={handleSave}
            disabled={!canSave}
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

      {subTab === "fields" ? (
        <CvFieldsEditor
          fields={coverLetter.fields}
          defaults={defaults}
          overrides={overrides}
          locks={NO_LOCKS}
          onChange={handleFieldChange}
          onReset={handleReset}
        />
      ) : (
        <CvRawEditor
          fields={coverLetter.fields}
          defaults={defaults}
          overrides={overrides}
          locks={NO_LOCKS}
          onCommit={setOverrides}
          registerHandle={(h) => {
            rawHandleRef.current = h;
          }}
        />
      )}
    </div>
  );
};

const SubTabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
      active
        ? "bg-muted text-foreground"
        : "text-muted-foreground hover:bg-muted/40",
    )}
  >
    {children}
  </button>
);
