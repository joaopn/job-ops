import * as api from "@client/api";
import type { CvDocument, CvField, Job } from "@shared/types";
import { useMutation } from "@tanstack/react-query";
import {
  FileText,
  Loader2,
  Lock,
  LockOpen,
  RotateCcw,
  Save,
  Undo2,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  job: Job;
  cv: CvDocument;
  onJobUpdated: () => void | Promise<void>;
  onRendered?: () => void;
};

type FieldGroup = {
  key: string;
  label: string;
  fields: CvField[];
};

const COLLAPSE_AFTER = 3;

/**
 * Cluster sibling fields by stripping the leaf segment of a dot-structured
 * id. Per the plan:
 *   `experience.0.bullet.0` → `experience.0`  (drop the `.bullet.0` role+index leaf)
 *   `experience.0.title`    → `experience.0`  (drop the `.title` leaf)
 *   `basics.name`           → `basics`        (drop the `.name` leaf)
 *   `skills.0`              → `skills`        (drop the `.0` leaf)
 *   `summary`               → `summary`       (no dots — flat)
 */
function groupKey(fieldId: string): string {
  const parts = fieldId.split(".");
  if (parts.length <= 1) return fieldId;
  const last = parts[parts.length - 1];
  if (/^\d+$/.test(last)) {
    if (
      parts.length >= 3 &&
      !/^\d+$/.test(parts[parts.length - 2])
    ) {
      return parts.slice(0, -2).join(".");
    }
    return parts.slice(0, -1).join(".");
  }
  return parts.slice(0, -1).join(".");
}

function buildGroups(fields: CvField[]): FieldGroup[] {
  const groups = new Map<string, CvField[]>();
  for (const field of fields) {
    const key = groupKey(field.id);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(field);
    } else {
      groups.set(key, [field]);
    }
  }
  return Array.from(groups.entries()).map(([key, fields]) => ({
    key,
    label: deriveGroupLabel(key, fields),
    fields,
  }));
}

function deriveGroupLabel(key: string, fields: CvField[]): string {
  const titleField = fields.find(
    (f) => f.role === "title" || f.role === "name" || f.role === "company",
  );
  if (titleField?.value) {
    const trimmed = titleField.value.trim();
    if (trimmed.length > 0 && trimmed.length < 80) return `${key} — ${trimmed}`;
  }
  return key;
}

function diffOverrides(
  local: Record<string, string>,
  fields: CvField[],
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

export const CvFieldsEditor: React.FC<Props> = ({
  job,
  cv,
  onJobUpdated,
  onRendered,
}) => {
  const groups = useMemo(() => buildGroups(cv.fields), [cv.fields]);
  const defaults = cv.defaultFieldValues ?? {};

  const initialOverrides = useMemo(
    () => ({ ...(job.tailoredFields ?? {}) }),
    [job.tailoredFields],
  );
  const initialLocks = useMemo(
    () => new Set(job.cvFieldLocks ?? []),
    [job.cvFieldLocks],
  );

  const [overrides, setOverrides] =
    useState<Record<string, string>>(initialOverrides);
  const [locks, setLocks] = useState<Set<string>>(initialLocks);

  useEffect(() => {
    setOverrides({ ...(job.tailoredFields ?? {}) });
  }, [job.tailoredFields]);
  useEffect(() => {
    setLocks(new Set(job.cvFieldLocks ?? []));
  }, [job.cvFieldLocks]);

  const dirtyOverrides = useMemo(() => {
    const next = diffOverrides(overrides, cv.fields, defaults);
    const persisted = job.tailoredFields ?? {};
    const persistedKeys = Object.keys(persisted);
    const nextKeys = Object.keys(next);
    if (persistedKeys.length !== nextKeys.length) return next;
    for (const k of nextKeys) {
      if (persisted[k] !== next[k]) return next;
    }
    return null;
  }, [overrides, cv.fields, defaults, job.tailoredFields]);

  const dirtyLocks = useMemo(() => {
    const persisted = job.cvFieldLocks ?? [];
    if (locks.size !== persisted.length) return Array.from(locks);
    for (const id of persisted) {
      if (!locks.has(id)) return Array.from(locks);
    }
    return null;
  }, [locks, job.cvFieldLocks]);

  const isDirty = dirtyOverrides !== null || dirtyLocks !== null;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const patch: Partial<Job> = {};
      if (dirtyOverrides !== null) patch.tailoredFields = dirtyOverrides;
      if (dirtyLocks !== null) patch.cvFieldLocks = dirtyLocks;
      return api.updateJob(job.id, patch);
    },
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
    mutationFn: async () => {
      if (isDirty) {
        await saveMutation.mutateAsync();
      }
      return api.renderCvPdf(job.id);
    },
    onSuccess: async () => {
      toast.success("CV PDF rendered");
      await onJobUpdated();
      onRendered?.();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to render CV PDF",
      );
    },
  });

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

  const canSave = isDirty && !saveMutation.isPending;
  const canRender = !renderMutation.isPending && !saveMutation.isPending;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-end gap-1">
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
          onClick={() => renderMutation.mutate()}
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
          onClick={() => saveMutation.mutate()}
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

      <div className="flex-1 overflow-y-auto pr-1">
        {groups.map((group, idx) => (
          <FieldGroupSection
            key={group.key}
            group={group}
            defaultOpen={idx < COLLAPSE_AFTER}
            overrides={overrides}
            locks={locks}
            defaults={defaults}
            onChange={handleFieldChange}
            onReset={handleReset}
            onToggleLock={handleToggleLock}
          />
        ))}
      </div>
    </div>
  );
};

type SectionProps = {
  group: FieldGroup;
  defaultOpen: boolean;
  overrides: Record<string, string>;
  locks: Set<string>;
  defaults: Record<string, string>;
  onChange: (id: string, value: string) => void;
  onReset: (id: string) => void;
  onToggleLock: (id: string) => void;
};

const FieldGroupSection: React.FC<SectionProps> = ({
  group,
  defaultOpen,
  overrides,
  locks,
  defaults,
  onChange,
  onReset,
  onToggleLock,
}) => {
  const editedCount = group.fields.reduce((acc, field) => {
    if (!(field.id in overrides)) return acc;
    const baseline = defaults[field.id] ?? field.value;
    return overrides[field.id] === baseline ? acc : acc + 1;
  }, 0);
  const lockedCount = group.fields.filter((f) => locks.has(f.id)).length;

  return (
    <details
      open={defaultOpen}
      className="mb-3 rounded-md border border-border/60 bg-background"
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
        <span>{group.label}</span>
        <span className="ml-2 text-xs text-muted-foreground">
          {group.fields.length} fields
          {editedCount > 0 ? ` · ${editedCount} edited` : ""}
          {lockedCount > 0 ? ` · ${lockedCount} locked` : ""}
        </span>
      </summary>
      <div className="flex flex-col gap-2 border-t border-border/60 p-3">
        {group.fields.map((field) => (
          <FieldRow
            key={field.id}
            field={field}
            value={
              overrides[field.id] ?? defaults[field.id] ?? field.value
            }
            isEdited={isFieldEdited(field, overrides, defaults)}
            isLocked={locks.has(field.id)}
            onChange={(v) => onChange(field.id, v)}
            onReset={() => onReset(field.id)}
            onToggleLock={() => onToggleLock(field.id)}
          />
        ))}
      </div>
    </details>
  );
};

function isFieldEdited(
  field: CvField,
  overrides: Record<string, string>,
  defaults: Record<string, string>,
): boolean {
  if (!(field.id in overrides)) return false;
  const baseline = defaults[field.id] ?? field.value;
  return overrides[field.id] !== baseline;
}

type FieldRowProps = {
  field: CvField;
  value: string;
  isEdited: boolean;
  isLocked: boolean;
  onChange: (next: string) => void;
  onReset: () => void;
  onToggleLock: () => void;
};

const FieldRow: React.FC<FieldRowProps> = ({
  field,
  value,
  isEdited,
  isLocked,
  onChange,
  onReset,
  onToggleLock,
}) => {
  const rows = Math.max(1, Math.min(8, value.split("\n").length));
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border/40 bg-muted/10 p-2">
      <div className="flex items-center gap-2">
        <code className="truncate text-[10px] text-muted-foreground">
          {field.id}
        </code>
        <Badge variant="outline" className="text-[10px]">
          {field.role}
        </Badge>
        {isEdited ? (
          <Badge variant="secondary" className="text-[10px]">
            edited
          </Badge>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {isEdited ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[10px]"
              onClick={onReset}
              title="Reset to default"
            >
              <Undo2 className="h-3 w-3" />
              Reset
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={onToggleLock}
            title={
              isLocked
                ? "Unlock — re-tailoring and chat may modify"
                : "Lock — block re-tailoring and chat edits"
            }
          >
            {isLocked ? (
              <Lock className="h-3 w-3 text-amber-600" />
            ) : (
              <LockOpen className="h-3 w-3 text-muted-foreground" />
            )}
          </Button>
        </div>
      </div>
      <Textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="resize-y font-mono text-xs leading-relaxed"
      />
    </div>
  );
};
