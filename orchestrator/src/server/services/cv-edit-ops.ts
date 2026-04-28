import { badRequest, conflict } from "@infra/errors";
import type {
  CvField,
  CvFieldOverrides,
  JobChatProposedBriefEdit,
  JobChatProposedCvEditOp,
} from "@shared/types";

/**
 * Merge a list of `{ fieldId, from, to }` ops into a copy of `currentOverrides`.
 * For each op, the current effective value (override-or-original) must equal
 * `from`; otherwise we raise `conflict` so the client can roll back its
 * optimistic update. Pure, no I/O.
 */
export function applyCvEditOps(
  fields: CvField[],
  currentOverrides: CvFieldOverrides,
  ops: JobChatProposedCvEditOp[],
): CvFieldOverrides {
  if (ops.length === 0) {
    throw badRequest("No edits to apply");
  }
  const fieldsById = new Map<string, CvField>();
  for (const field of fields) fieldsById.set(field.id, field);

  const next: CvFieldOverrides = { ...currentOverrides };
  for (const op of ops) {
    if (!op.fieldId) {
      throw badRequest("Edit fieldId is empty");
    }
    const field = fieldsById.get(op.fieldId);
    if (!field) {
      throw conflict(`Edit references unknown fieldId '${op.fieldId}'`);
    }
    const currentValue = next[op.fieldId] ?? field.value;
    if (currentValue !== op.from) {
      throw conflict(
        `Edit's \`from\` value no longer matches current field value (fieldId: ${op.fieldId})`,
      );
    }
    next[op.fieldId] = op.to;
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
