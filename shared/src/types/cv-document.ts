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

/**
 * One pass through the 5e upload pipeline: an LLM template-extract call
 * plus the gates the result faces (render → tectonic → pdftotext diff).
 * Mirrored in shared types so the verification UI / failed-upload modal
 * can render the log without re-deriving the shape from the server.
 */
export interface CvUploadPipelineAttempt {
  attempt: number;
  templatedTex: string;
  fields: CvField[];
  failureKind: "llm" | "render" | "compile" | "content-diff" | null;
  failureMessage: string | null;
  compileStderr: string | null;
  contentDiff: string | null;
}

/**
 * Successful upload via POST /api/cv/upload-template (or re-extract):
 * the persisted CV plus the attempt log so the verification view can
 * surface "compiled in N attempts".
 */
export interface CvUploadTemplateResponse {
  cv: CvDocument;
  attempts: CvUploadPipelineAttempt[];
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
