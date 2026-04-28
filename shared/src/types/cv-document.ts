import type { CvField, CvFieldOverrides } from "./cv-content";

export interface CvDocument {
  id: string;
  name: string;
  flattenedTex: string;
  fields: CvField[];
  personalBrief: string;
  /**
   * 5e substrate: the LLM-authored templated `.tex` with `«field-id»`
   * markers in place of tailorable spans. Empty string on 5d-era rows
   * that haven't been re-uploaded yet — runtime path still uses
   * `flattenedTex` + `fields` until 5e.4 cuts over.
   */
  templatedTex: string;
  /**
   * 5e substrate: the per-field "original" values extracted from the
   * source. Substitution at render time uses these as the fallback when a
   * `tailoredFields` override is absent.
   */
  defaultFieldValues: CvFieldOverrides;
  /** Most recent tectonic stderr from the upload gate. Surfaced in the log viewer. */
  lastCompileStderr: string | null;
  /** How many template-extract retries the upload took. Observability. */
  compileAttempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface CvDocumentSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCvDocumentInput {
  name: string;
  originalArchive: Uint8Array;
  flattenedTex: string;
  fields: CvField[];
  personalBrief: string;
  /** 5e substrate fields. Optional during the dual-track transition. */
  templatedTex?: string;
  defaultFieldValues?: CvFieldOverrides;
  lastCompileStderr?: string | null;
  compileAttempts?: number;
}

export interface UpdateCvDocumentInput {
  name?: string;
  originalArchive?: Uint8Array;
  flattenedTex?: string;
  fields?: CvField[];
  personalBrief?: string;
  templatedTex?: string;
  defaultFieldValues?: CvFieldOverrides;
  lastCompileStderr?: string | null;
  compileAttempts?: number;
}
