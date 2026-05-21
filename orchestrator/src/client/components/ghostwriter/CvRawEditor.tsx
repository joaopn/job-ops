import type { CvField } from "@shared/types";
import { AlertCircle } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import {
  type ParseError,
  parseTaggedText,
  serializeTaggedText,
} from "@shared/cv-tagged-text";
import { Textarea } from "@/components/ui/textarea";

export type CvRawCommitResult =
  | { ok: true; overrides: Record<string, string> }
  | { ok: false };

export type CvRawEditorHandle = {
  /**
   * Parse the current textarea content and commit it as an overrides map
   * via `onCommit` (for state propagation). Returns the parsed overrides
   * synchronously so the caller can pass them straight into a Save
   * mutation without waiting for the async state update to flush.
   */
  commit(): CvRawCommitResult;
};

type Props = {
  fields: CvField[];
  defaults: Record<string, string>;
  overrides: Record<string, string>;
  locks: ReadonlySet<string>;
  onCommit: (next: Record<string, string>) => void;
  registerHandle?: (handle: CvRawEditorHandle | null) => void;
};

/**
 * Raw tagged-text editor. The textarea is hydrated from the current
 * overrides + locks via `serializeTaggedText`. On commit, the content is
 * parsed strictly; on failure, all errors are displayed inline with line
 * numbers and the commit is rejected.
 */
export const CvRawEditor: React.FC<Props> = ({
  fields,
  defaults,
  overrides,
  locks,
  onCommit,
  registerHandle,
}) => {
  const hydrated = serializeTaggedText({ fields, defaults, overrides, locks });
  const [draft, setDraft] = useState(hydrated);
  const [errors, setErrors] = useState<ParseError[]>([]);

  // Re-hydrate when the upstream state changes (e.g. parent persisted a
  // save). Without this, mounting the Raw tab after a Save would show
  // stale text.
  useEffect(() => {
    setDraft(hydrated);
    setErrors([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  useEffect(() => {
    if (!registerHandle) return;
    const handle: CvRawEditorHandle = {
      commit: () => {
        const result = parseTaggedText(draft, fields);
        if (!result.ok) {
          setErrors(result.errors);
          return { ok: false };
        }
        setErrors([]);
        // Diff against defaults — entries equal to the default drop out of
        // the persisted override map.
        const next: Record<string, string> = {};
        for (const [id, value] of Object.entries(result.overrides)) {
          const baseline =
            defaults[id] ?? fields.find((f) => f.id === id)?.value;
          if (baseline !== undefined && value === baseline) continue;
          next[id] = value;
        }
        onCommit(next);
        return { ok: true, overrides: next };
      },
    };
    registerHandle(handle);
    return () => registerHandle(null);
  }, [draft, defaults, fields, onCommit, registerHandle]);

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-hidden">
      {errors.length > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
          <div className="mb-1 flex items-center gap-1 font-medium text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            {errors.length} parse error{errors.length === 1 ? "" : "s"} — fix
            and Save again
          </div>
          <ul className="ml-5 list-disc text-destructive/90">
            {errors.slice(0, 12).map((err, idx) => (
              <li key={`${err.line}-${idx}`}>
                Line {err.line}: {err.message}
              </li>
            ))}
            {errors.length > 12 ? (
              <li>… and {errors.length - 12} more</li>
            ) : null}
          </ul>
        </div>
      ) : null}
      <Textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (errors.length > 0) setErrors([]);
        }}
        className="flex-1 resize-none font-mono text-xs leading-relaxed"
        spellCheck={false}
      />
    </div>
  );
};
