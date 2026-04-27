import { badRequest, conflict } from "@infra/errors";
import type {
  CvContent,
  JobChatProposedBriefEdit,
  JobChatProposedCvEditOp,
} from "@shared/types";

/**
 * Apply a list of cv-edit operations to a CvContent tree. Each op is a
 * `{ path, from, to }` triplet: walk the path; verify the leaf value matches
 * `from` exactly; replace it with `to`. Numeric path segments index into
 * arrays; string segments index into objects. Pure, no I/O.
 *
 * Throws `conflict` when `from` no longer matches — surfacing stale-edit
 * collisions so the client can roll back its optimistic update.
 */
export function applyCvEditOps(
  content: CvContent,
  ops: JobChatProposedCvEditOp[],
): CvContent {
  if (ops.length === 0) {
    throw badRequest("No edits to apply");
  }
  const next = structuredClone(content);
  for (const op of ops) {
    if (op.path.length === 0) {
      throw badRequest("Edit path is empty");
    }
    let cursor: unknown = next;
    for (let i = 0; i < op.path.length - 1; i++) {
      const segment = op.path[i];
      cursor = readSegment(cursor, segment);
      if (cursor === null || cursor === undefined) {
        throw conflict(
          `Edit path cannot be resolved against current content (path: ${JSON.stringify(op.path)})`,
        );
      }
    }
    const last = op.path[op.path.length - 1];
    const currentValue = readSegment(cursor, last);
    if (currentValue !== op.from) {
      throw conflict(
        `Edit's \`from\` value no longer matches current content (path: ${JSON.stringify(op.path)})`,
      );
    }
    writeSegment(cursor, last, op.to);
  }
  return next;
}

/**
 * Append-or-replace logic for personal_brief edits. `append` wins when both
 * fields are present, mirroring the prompt's preference for additive edits.
 */
export function applyBriefEdit(
  currentBrief: string,
  edit: JobChatProposedBriefEdit,
): string {
  if (edit.append?.trim()) {
    const trimmedExisting = currentBrief.replace(/\s+$/, "");
    if (!trimmedExisting) return edit.append.trim();
    return `${trimmedExisting}\n\n${edit.append.trim()}`;
  }
  if (edit.replace !== undefined) {
    return edit.replace.trim();
  }
  return currentBrief;
}

function readSegment(target: unknown, segment: string | number): unknown {
  if (target === null || target === undefined) return undefined;
  if (Array.isArray(target)) {
    const index = typeof segment === "number" ? segment : Number(segment);
    if (!Number.isInteger(index)) return undefined;
    return target[index];
  }
  if (typeof target === "object") {
    return (target as Record<string, unknown>)[String(segment)];
  }
  return undefined;
}

function writeSegment(
  target: unknown,
  segment: string | number,
  value: unknown,
): void {
  if (target === null || target === undefined) {
    throw conflict("Cannot write to null/undefined parent");
  }
  if (Array.isArray(target)) {
    const index = typeof segment === "number" ? segment : Number(segment);
    if (!Number.isInteger(index)) {
      throw badRequest(`Array path segment '${segment}' is not an integer`);
    }
    target[index] = value;
    return;
  }
  if (typeof target === "object") {
    (target as Record<string, unknown>)[String(segment)] = value;
    return;
  }
  throw conflict(
    `Cannot write segment '${segment}' to non-object parent (${typeof target})`,
  );
}
