import type { CvField, CvFieldOverrides } from "./cv-content";
import type { CvUploadPipelineAttempt } from "./cv-document";

/**
 * A user-uploaded LaTeX cover-letter template, processed through the same
 * gated upload pipeline as `CvDocument`. The shape mirrors `CvDocument`
 * deliberately — same `templatedTex` + `fields` + `defaultFieldValues`
 * substrate, same compile-then-pdftotext-zero-diff acceptance gate.
 *
 * The cover-letter extract designates exactly one field with `role: "body"`;
 * that field's override carries the per-job letter body the user sees in
 * the right-pane textarea on the tailoring window.
 */
export interface CoverLetterDocument {
  id: string;
  name: string;
  flattenedTex: string;
  fields: CvField[];
  templatedTex: string;
  defaultFieldValues: CvFieldOverrides;
  /** Most recent tectonic stderr from the upload gate. */
  lastCompileStderr: string | null;
  /** How many template-extract retries the upload took. */
  compileAttempts: number;
  /**
   * Per-document LLM system prompt override. Empty string means
   * "use the server default at extraction time" (the
   * coverletter-template-extract YAML). Capped at 50KB at the API layer.
   */
  extractionPrompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CoverLetterDocumentSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Successful upload via POST /api/coverletter/upload-template (or
 * re-extract): the persisted cover-letter document plus the attempt log.
 * Reuses `CvUploadPipelineAttempt` since the pipeline shape is identical.
 */
export interface CoverLetterUploadTemplateResponse {
  coverLetter: CoverLetterDocument;
  attempts: CvUploadPipelineAttempt[];
}

export interface CreateCoverLetterDocumentInput {
  name: string;
  originalArchive: Uint8Array;
  flattenedTex: string;
  fields: CvField[];
  templatedTex: string;
  defaultFieldValues: CvFieldOverrides;
  lastCompileStderr?: string | null;
  compileAttempts?: number;
  extractionPrompt?: string;
}

export interface UpdateCoverLetterDocumentInput {
  name?: string;
  originalArchive?: Uint8Array;
  flattenedTex?: string;
  fields?: CvField[];
  templatedTex?: string;
  defaultFieldValues?: CvFieldOverrides;
  lastCompileStderr?: string | null;
  compileAttempts?: number;
  extractionPrompt?: string;
}
