/**
 * Single-slot undo controller for the Manage screen. Any action site captures
 * the affected jobs' prior state and `pushUndo`s a restore thunk; the toast
 * Undo button, the toolbar button, and Ctrl/Cmd+Z all call `undo()`.
 */

import { toast } from "@client/lib/toast";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

export interface UndoEntry {
  label: string;
  restore: () => Promise<void>;
}

export interface UndoController {
  pushUndo: (entry: UndoEntry) => void;
  undo: () => Promise<void>;
  canUndo: boolean;
  pendingLabel: string | null;
}

export function useUndoController(
  onAfterUndo: () => Promise<void> | void,
): UndoController {
  const [entry, setEntry] = useState<UndoEntry | null>(null);
  // Mirror in a ref so `undo` can stay referentially stable and always act on
  // the latest entry — a toast's Undo onClick is captured at action time, but
  // the entry it should revert is pushed in the same render cycle.
  const entryRef = useRef<UndoEntry | null>(null);

  const pushUndo = useCallback((next: UndoEntry) => {
    entryRef.current = next;
    setEntry(next);
  }, []);

  const undo = useCallback(async () => {
    const current = entryRef.current;
    if (!current) return;
    entryRef.current = null;
    setEntry(null);
    try {
      await current.restore();
      toast.success(`Reverted: ${current.label}`);
    } catch {
      toast.error(`Couldn't undo: ${current.label}`);
    }
    await onAfterUndo();
  }, [onAfterUndo]);

  return useMemo(
    () => ({
      pushUndo,
      undo,
      canUndo: entry !== null,
      pendingLabel: entry?.label ?? null,
    }),
    [pushUndo, undo, entry],
  );
}

const UndoContext = createContext<UndoController | null>(null);

export const UndoProvider = UndoContext.Provider;

export function useUndo(): UndoController {
  const ctx = useContext(UndoContext);
  if (!ctx) {
    throw new Error("useUndo must be used within an UndoProvider");
  }
  return ctx;
}
