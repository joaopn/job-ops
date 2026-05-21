import * as api from "@client/api";
import type { CvDocument, Job } from "@shared/types";
import { useMutation } from "@tanstack/react-query";
import {
  FileText,
  Loader2,
  LockOpen,
  RotateCcw,
  Save,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CvFieldsEditor } from "./CvFieldsEditor";
import { CvRawEditor, type CvRawEditorHandle } from "./CvRawEditor";

type Props = {
  job: Job;
  cv: CvDocument;
  onJobUpdated: () => void | Promise<void>;
  onRendered: () => void;
};

type SubTab = "fields" | "raw";

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
 * Edit tab for `CvPane`: owns the per-job `tailoredFields` + `cvFieldLocks`
 * local state, the Save / Render PDF / Reset / Clear-locks toolbar, and the
 * Fields/Raw sub-tab toggle. Sub-tab editors are props-driven views over
 * the same state — switching tabs preserves unsaved edits unless the Raw
 * tab is dirty AND malformed (in which case the switch is blocked).
 */
export const CvEditTab: React.FC<Props> = ({
  job,
  cv,
  onJobUpdated,
  onRendered,
}) => {
  const defaults = cv.defaultFieldValues ?? {};

  const [overrides, setOverrides] = useState<Record<string, string>>(
    () => ({ ...(job.tailoredFields ?? {}) }),
  );
  const [locks, setLocks] = useState<Set<string>>(
    () => new Set(job.cvFieldLocks ?? []),
  );
  const [subTab, setSubTab] = useState<SubTab>("raw");
  const rawHandleRef = useRef<CvRawEditorHandle | null>(null);

  useEffect(() => {
    setOverrides({ ...(job.tailoredFields ?? {}) });
  }, [job.tailoredFields]);
  useEffect(() => {
    setLocks(new Set(job.cvFieldLocks ?? []));
  }, [job.cvFieldLocks]);

  const buildPatch = (
    effectiveOverrides: Record<string, string>,
    effectiveLocks: Set<string>,
  ): Partial<Job> | null => {
    const diffed = diffOverrides(effectiveOverrides, cv.fields, defaults);
    const persistedOv = job.tailoredFields ?? {};
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

    const persistedLocks = job.cvFieldLocks ?? [];
    let locksDirty = effectiveLocks.size !== persistedLocks.length;
    if (!locksDirty) {
      for (const id of persistedLocks) {
        if (!effectiveLocks.has(id)) {
          locksDirty = true;
          break;
        }
      }
    }

    if (!ovDirty && !locksDirty) return null;
    const patch: Partial<Job> = {};
    if (ovDirty) patch.tailoredFields = diffed;
    if (locksDirty) patch.cvFieldLocks = Array.from(effectiveLocks);
    return patch;
  };

  const isDirty = buildPatch(overrides, locks) !== null;

  const saveMutation = useMutation({
    mutationFn: async (patch: Partial<Job>) => api.updateJob(job.id, patch),
    onSuccess: async () => {
      await onJobUpdated();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to save CV edits",
      );
    },
  });

  const renderMutation = useMutation({
    mutationFn: async (patch: Partial<Job> | null) => {
      if (patch) {
        await saveMutation.mutateAsync(patch);
      }
      return api.renderCvPdf(job.id);
    },
    onSuccess: async () => {
      toast.success("CV PDF rendered");
      await onJobUpdated();
      onRendered();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to render CV PDF",
      );
    },
  });

  /**
   * Parse + commit the Raw textarea (when active) and return the effective
   * overrides for the caller to use *now* — setOverrides is async so the
   * raw-edited values aren't yet in the `overrides` closure variable.
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

  const handleToggleLock = (id: string) => {
    setLocks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleResetAll = () => {
    if (
      !window.confirm(
        "Reset all field overrides to the original CV defaults? Lock state is preserved.",
      )
    ) {
      return;
    }
    setOverrides({});
  };

  const handleClearLocks = () => {
    if (
      !window.confirm("Clear all field locks? Override values are preserved.")
    ) {
      return;
    }
    setLocks(new Set());
  };

  const handleSwitchSubTab = (next: SubTab) => {
    if (next === subTab) return;
    if (subTab === "raw") {
      // Leaving Raw: parse + commit so unsaved text isn't dropped.
      if (resolveEffectiveOverrides() === null) return;
    }
    setSubTab(next);
  };

  const handleSave = () => {
    const effective = resolveEffectiveOverrides();
    if (effective === null) return;
    const patch = buildPatch(effective, locks);
    if (!patch) return;
    saveMutation.mutate(patch);
  };

  const handleRender = () => {
    const effective = resolveEffectiveOverrides();
    if (effective === null) return;
    const patch = buildPatch(effective, locks);
    renderMutation.mutate(patch);
  };

  // Raw owns its own `draft` state until commit; the parent's `overrides`
  // doesn't reflect typed-but-uncommitted text. Enabling Save while Raw is
  // active routes the click through commit() — handler no-ops on parse
  // failure (errors shown inline) or nothing-to-save (buildPatch=null).
  const canSave =
    (isDirty || subTab === "raw") && !saveMutation.isPending;
  const canRender = !renderMutation.isPending && !saveMutation.isPending;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-2">
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
            onClick={handleClearLocks}
            disabled={locks.size === 0}
          >
            <LockOpen className="h-3 w-3" />
            Clear locks
          </Button>
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
          fields={cv.fields}
          defaults={defaults}
          overrides={overrides}
          locks={locks}
          onChange={handleFieldChange}
          onReset={handleReset}
          onToggleLock={handleToggleLock}
        />
      ) : (
        <CvRawEditor
          fields={cv.fields}
          defaults={defaults}
          overrides={overrides}
          locks={locks}
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
