import * as repo from "@server/repositories/cover-letter-documents";
import type { CoverLetterDocument } from "@shared/types";

/**
 * Returns the most recently updated cover-letter document, or null when
 * none has been uploaded yet. Single-doc assumption mirrors `getActiveCvDocument`;
 * multi-cover-letter parity arrives with phase 8b.
 */
export async function getActiveCoverLetterDocument(): Promise<CoverLetterDocument | null> {
  const summaries = await repo.listCoverLetterDocuments();
  if (summaries.length === 0) return null;
  return repo.getCoverLetterDocumentById(summaries[0].id);
}
