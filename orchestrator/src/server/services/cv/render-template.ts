import type { CvFieldOverrides } from "@shared/types";

/**
 * 5e CV substrate: render a templated `.tex` by literal find-and-replace.
 *
 * The template embeds `«field-id»` markers (Unicode guillemets — U+00AB /
 * U+00BB) in place of tailorable spans. These characters never appear in
 * legitimate LaTeX outside a substitution context, so any leaked marker
 * surfaces as a tectonic compile error rather than a silently malformed
 * PDF.
 *
 * Substitution is a literal `String.prototype.replaceAll` per fieldId. No
 * template engine, no `with()` scope tricks, no Eta. The trade-off: a
 * field's value cannot itself contain the literal marker for another
 * field. That's an acceptable constraint because real CV content doesn't
 * use guillemets to express LaTeX.
 *
 * Render order matters when one fieldId is a prefix of another — replace
 * the longest fieldIds first so `«experience.0.title»` doesn't get
 * partially mangled by an earlier `«experience.0»` substitution. We sort
 * descending by length to enforce this.
 */

const MARKER_OPEN = "«";
const MARKER_CLOSE = "»";

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

export class RenderTemplateError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "RenderTemplateError";
    this.code = code;
  }
}

/**
 * Build a `«fieldId»` marker for a given id. Exported so other modules
 * (the LLM template-extraction prompt builder, tests) reference the same
 * canonical encoding rather than re-deriving it.
 */
export function markerFor(fieldId: string): string {
  return `${MARKER_OPEN}${fieldId}${MARKER_CLOSE}`;
}

/**
 * Render `templatedTex` against an effective override map. The caller is
 * expected to merge `defaultFieldValues` and any per-job tailored fields
 * before calling — this function does no merging itself.
 *
 * Failure modes:
 * - If any marker in the template references a fieldId not present in
 *   `effectiveOverrides`, throw `MISSING_FIELD`. A leaked marker would
 *   otherwise compile-fail downstream; surfacing it here gives a cleaner
 *   error.
 * - If the rendered output contains a forbidden LaTeX pattern (e.g.
 *   `\write18` injected via an override value), throw `FORBIDDEN_PATTERN`.
 */
export function renderTemplate(
  templatedTex: string,
  effectiveOverrides: CvFieldOverrides,
): string {
  // Sort fieldIds descending by length so a longer id is replaced before
  // any shorter id that might be its prefix.
  const ids = Object.keys(effectiveOverrides).sort(
    (a, b) => b.length - a.length,
  );

  let result = templatedTex;
  for (const id of ids) {
    const marker = markerFor(id);
    const value = effectiveOverrides[id];
    result = result.replaceAll(marker, value);
  }

  // Surface any unsubstituted marker. A leftover marker means the
  // template references a fieldId we don't have a value for.
  const leftover = findUnsubstitutedMarker(result);
  if (leftover !== null) {
    throw new RenderTemplateError(
      `Template references unknown fieldId "${leftover}" — no entry in defaultFieldValues or tailoredFields.`,
      "MISSING_FIELD",
    );
  }

  for (const guard of FORBIDDEN_PATTERNS) {
    if (guard.pattern.test(result)) {
      throw new RenderTemplateError(
        `Rendered output contains forbidden pattern: ${guard.description}.`,
        "FORBIDDEN_PATTERN",
      );
    }
  }

  return result;
}

/**
 * Scan `templatedTex` for the set of fieldIds it references. Used by the
 * upload pipeline to confirm `defaultFieldValues` covers every marker
 * before persisting.
 */
export function extractMarkerIds(templatedTex: string): Set<string> {
  const ids = new Set<string>();
  const pattern = new RegExp(
    `${MARKER_OPEN}([^${MARKER_OPEN}${MARKER_CLOSE}]+)${MARKER_CLOSE}`,
    "g",
  );
  for (const match of templatedTex.matchAll(pattern)) {
    ids.add(match[1]);
  }
  return ids;
}

function findUnsubstitutedMarker(rendered: string): string | null {
  const pattern = new RegExp(
    `${MARKER_OPEN}([^${MARKER_OPEN}${MARKER_CLOSE}]+)${MARKER_CLOSE}`,
  );
  const match = rendered.match(pattern);
  return match ? match[1] : null;
}
