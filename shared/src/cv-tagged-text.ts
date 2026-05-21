import type { CvField, CvFieldOverrides } from "./types";

/**
 * Tagged-text serialization for the per-job CV editor's Raw sub-tab.
 *
 * Format: each field is rendered as a fence + value block, in `fields[]`
 * order. Locked fields get a `# locked` annotation line above the fence
 * (cosmetic only — locks are stored in `jobs.cvFieldLocks`, not parsed
 * from the text).
 *
 *     # locked
 *     --- experience.0.bullet.0 ---
 *     Built a service that handled 100k requests/sec.
 *
 *     --- experience.0.bullet.1 ---
 *     Mentored a team of 4 junior engineers.
 *
 *     --- experience.0.bullet.2 ---
 *
 * Strict parser: malformed input fails Save with line-numbered errors.
 * Drop-and-continue is forbidden — same invariant as the upload pipeline.
 */

const FENCE_RE = /^--- (\S+) ---$/;
const LOCKED_ANNOTATION = "# locked";

export interface ParseError {
  line: number;
  message: string;
}

export type ParseTaggedTextResult =
  | { ok: true; overrides: CvFieldOverrides }
  | { ok: false; errors: ParseError[] };

/**
 * Parse a tagged-text document into a `CvFieldOverrides` map.
 *
 * Strict-rejects (returns ALL errors, not just the first):
 *   - Orphan content before the first fence.
 *   - Fence whose id is not in `fields`.
 *   - Two fences with the same id.
 *   - A field in `fields` whose fence is missing.
 *   - Lines starting with `---` that don't fully match the fence shape.
 *
 * Empty value between fences = a real `""` override (renderer substitutes
 * empty, distinct from "no override").
 */
export function parseTaggedText(
  input: string,
  fields: CvField[],
): ParseTaggedTextResult {
  const lines = input.split("\n");
  const knownIds = new Set(fields.map((f) => f.id));
  const errors: ParseError[] = [];

  interface Block {
    id: string;
    startLine: number;
    valueLines: string[];
  }
  const blocks: Block[] = [];
  let current: Block | null = null;

  const closeBlock = (block: Block): void => {
    // Trim trailing blank + `# locked` lines — those belong to the next
    // block's preamble, not this block's value.
    while (block.valueLines.length > 0) {
      const last = block.valueLines[block.valueLines.length - 1];
      const trimmed = last.trim();
      if (trimmed === "" || trimmed === LOCKED_ANNOTATION) {
        block.valueLines.pop();
        continue;
      }
      break;
    }
    blocks.push(block);
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];
    const fenceMatch = line.match(FENCE_RE);

    if (fenceMatch) {
      const id = fenceMatch[1];
      if (current) closeBlock(current);
      current = { id, startLine: lineNo, valueLines: [] };
      if (!knownIds.has(id)) {
        errors.push({ line: lineNo, message: `Unknown fieldId "${id}"` });
      }
      continue;
    }

    // Catch malformed fences early: any line starting with `---` that
    // didn't match the strict fence regex is suspicious.
    if (line.startsWith("---")) {
      errors.push({
        line: lineNo,
        message: `Malformed fence line: "${line}". Expected "--- <fieldId> ---".`,
      });
      // Continue processing — don't accumulate as content either.
      continue;
    }

    if (!current) {
      // Pre-first-fence: blank + `# locked` lines are tolerated as preamble.
      const trimmed = line.trim();
      if (trimmed === "" || trimmed === LOCKED_ANNOTATION) continue;
      errors.push({
        line: lineNo,
        message: `Orphan content before first field block: "${line}".`,
      });
      continue;
    }

    current.valueLines.push(line);
  }

  if (current) closeBlock(current);

  // Duplicates (second-or-later occurrence flagged at its own line).
  const seen = new Set<string>();
  const duplicateAt: Block[] = [];
  for (const block of blocks) {
    if (seen.has(block.id)) duplicateAt.push(block);
    else seen.add(block.id);
  }
  for (const block of duplicateAt) {
    errors.push({
      line: block.startLine,
      message: `Duplicate block for fieldId "${block.id}".`,
    });
  }

  // Missing fences (a field in `fields` that the textarea omits).
  for (const field of fields) {
    if (!seen.has(field.id)) {
      errors.push({
        line: 1,
        message: `Missing block for fieldId "${field.id}".`,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const overrides: CvFieldOverrides = {};
  for (const block of blocks) {
    overrides[block.id] = block.valueLines.join("\n");
  }
  return { ok: true, overrides };
}

/**
 * Render a `fields[]` + overrides + locks combination as tagged text the
 * parser round-trips losslessly. Fields are emitted in `fields[]` order
 * (deterministic; matches the doc order).
 */
export function serializeTaggedText(args: {
  fields: CvField[];
  overrides: CvFieldOverrides;
  defaults: CvFieldOverrides;
  locks: ReadonlySet<string>;
}): string {
  const { fields, overrides, defaults, locks } = args;
  const blocks: string[] = [];
  for (const field of fields) {
    const value =
      field.id in overrides
        ? overrides[field.id]
        : (defaults[field.id] ?? field.value);
    const lockedPrefix = locks.has(field.id) ? `${LOCKED_ANNOTATION}\n` : "";
    blocks.push(`${lockedPrefix}--- ${field.id} ---\n${value}`);
  }
  return blocks.join("\n\n");
}
