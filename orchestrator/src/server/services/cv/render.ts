import type { CvField, CvFieldOverrides } from "@shared/types";

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /\\(?:immediate\s*)?write18\b/,
    description: "\\write18 (shell-escape)",
  },
  { pattern: /\\openout\b/, description: "\\openout (file write)" },
  { pattern: /\\input\s*\{\s*\//, description: "\\input{} with absolute path" },
  {
    pattern: /\\input\s*\{\s*\.\.\//,
    description: "\\input{} with parent-traversal path",
  },
];

export class RenderCvError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "RenderCvError";
    this.code = code;
  }
}

/**
 * Walk `flattenedTex` and substitute each field's `value` with its override
 * (when one is present and differs). Substitution is verbatim — no template
 * engine, no escaping, no whitespace normalisation. With an empty
 * `overrides`, the result is byte-identical to `flattenedTex`.
 *
 * Sequential cursor handles repeated field values correctly when the LLM
 * extracted them in document order: each subsequent `indexOf` starts from
 * the position right after the previous match.
 *
 * Final output is checked against forbidden patterns (`\write18`, abs-path
 * `\input{}`, etc.) so a malicious override can't slip through.
 */
export function renderCv(
  flattenedTex: string,
  fields: CvField[],
  overrides: CvFieldOverrides = {},
): string {
  let result = flattenedTex;
  let cursor = 0;
  for (const field of fields) {
    const idx = result.indexOf(field.value, cursor);
    if (idx === -1) {
      // Field's original text not present at-or-after cursor. The LLM
      // extracted something the source doesn't contain, or earlier
      // overrides shifted text around so the cursor advanced past it.
      // Skip and leave whatever's there alone.
      continue;
    }
    const next = overrides[field.id] ?? field.value;
    if (next !== field.value) {
      result =
        result.slice(0, idx) + next + result.slice(idx + field.value.length);
    }
    cursor = idx + next.length;
  }

  for (const guard of FORBIDDEN_PATTERNS) {
    if (guard.pattern.test(result)) {
      throw new RenderCvError(
        `Rendered output contains forbidden pattern: ${guard.description}.`,
        "FORBIDDEN_PATTERN",
      );
    }
  }

  return result;
}

/**
 * Validate that every field's `value` is locatable in `flattenedTex` when
 * walked sequentially. The LLM is required to emit fields in document
 * order; this checks that constraint at extraction time so we surface bad
 * extractions immediately rather than at render time.
 *
 * Returns the index of the first field that fails validation, or `null`
 * when every field's value is reachable from the running cursor.
 */
export function findUnreachableField(
  flattenedTex: string,
  fields: CvField[],
): number | null {
  let cursor = 0;
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const idx = flattenedTex.indexOf(field.value, cursor);
    if (idx === -1) return i;
    cursor = idx + field.value.length;
  }
  return null;
}
