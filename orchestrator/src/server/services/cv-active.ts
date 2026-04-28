import * as cvRepo from "@server/repositories/cv-documents";
import type { CvDocument } from "@shared/types";

/**
 * Returns the most recently updated CV document, or null when no CV has been
 * uploaded yet. The single-CV assumption matches the onboarding flow:
 * users upload one LaTeX CV, edit it, and re-extract; multi-CV management is
 * deferred.
 */
export async function getActiveCvDocument(): Promise<CvDocument | null> {
  const summaries = await cvRepo.listCvDocuments();
  if (summaries.length === 0) return null;
  return cvRepo.getCvDocumentById(summaries[0].id);
}
