/**
 * Marker syntax for the docx substrate. `⟦id⟧` (U+27E6 / U+27E7,
 * mathematical white brackets) instead of the LaTeX substrate's `«id»`:
 * guillemets are real quotation marks in French/German CV prose, while
 * the white brackets are effectively absent from natural text. The
 * server owns all splicing (the LLM never writes a marker), so the only
 * constraint is collision with source text — parse-docx hard-rejects an
 * upload whose visible text already contains either glyph.
 */
export const MARKER_OPEN = "⟦";
export const MARKER_CLOSE = "⟧";

/** Canonical marker encoding; mirrors render-template.ts#markerFor. */
export function markerFor(fieldId: string): string {
  return `${MARKER_OPEN}${fieldId}${MARKER_CLOSE}`;
}

/**
 * Default cap on the total UNCOMPRESSED size of a docx package. Same
 * value and reasoning as flatten-input's DEFAULT_MAX_EXPANDED_BYTES: a
 * real CV is a few MB even with embedded photos; 50 MB is an order of
 * magnitude of headroom, and anything past it is a zip bomb, not a CV.
 * Callers may override (W4 wires this to the existing
 * `maxExpandedLatexBytes`-style setting); enforcement checks BOTH the
 * declared entry sizes before extraction AND the actual inflated bytes
 * during extraction, because declared sizes are attacker-controlled.
 */
export const DEFAULT_MAX_EXPANDED_BYTES = 50 * 1024 * 1024;

/**
 * Default cap on the number of zip entries. A real-world CV docx holds
 * well under 100 parts (XML parts + media); 1000 gives 10x headroom
 * while stopping many-tiny-entries bombs that stay under the byte cap.
 */
export const DEFAULT_MAX_PART_COUNT = 1000;
