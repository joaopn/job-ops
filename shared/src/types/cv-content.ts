/**
 * The original `flattened_tex` is the canonical render substrate. The LLM
 * extracts a list of `CvField`s — verbatim spans of the source — that the
 * renderer can substitute at known offsets without ever rewriting the
 * surrounding LaTeX. A render with no overrides is byte-identical to the
 * source.
 */
export const CV_FIELD_ROLES = [
  "name",
  "title",
  "company",
  "location",
  "date",
  "bullet",
  "summary",
  "skill",
  "publication",
  "url",
  "email",
  "phone",
  "education",
  "section-heading",
  "body",
  "other",
] as const;

export type CvFieldRole = (typeof CV_FIELD_ROLES)[number];

export interface CvField {
  /** Stable, human-meaningful id (e.g. "basics.name", "experience.0.title"). */
  id: string;
  /** ATS hint + chat affordance. */
  role: CvFieldRole;
  /**
   * Verbatim substring of `flattened_tex`. May contain LaTeX as written
   * (`\_`, `\&`, `\textbf{...}`, etc.) — the LLM extracts it byte-for-byte
   * and the renderer never normalises or re-escapes.
   */
  value: string;
}

/**
 * Per-job overrides: a sparse map from field id to replacement value. Absent
 * ids fall back to the field's original `value` at render time.
 */
export type CvFieldOverrides = Record<string, string>;
