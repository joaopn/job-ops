import { promises as fs } from "node:fs";
import { join } from "node:path";
import { logger } from "@infra/logger";
import { getDataDir } from "@server/config/dataDir";
import * as repo from "@server/repositories/cover-letter-documents";
import * as jobsRepo from "@server/repositories/jobs";
import {
  RenderTemplateError,
  renderTemplate,
} from "@server/services/cv/render-template";
import {
  RunTectonicError,
  runTectonic,
} from "@server/services/cv/run-tectonic";
import type { CvFieldOverrides, Job } from "@shared/types";

/**
 * 5h cover-letter Render path. Substitutes the per-job overrides into
 * the active cover-letter doc's templated tex, runs tectonic, writes
 * `data/pdfs/cover_letter_<jobId>.pdf`, persists the path on
 * `jobs.coverLetterPdfPath`. No LLM call — just template + render.
 *
 * The resolved doc id is the job's pinned `coverLetterDocumentId` if
 * present, falling back to the most-recently-updated cover-letter doc.
 */
export interface RenderCoverLetterArgs {
  jobId: string;
}

export type RenderCoverLetterResult =
  | { success: true; job: Job; pdfPath: string }
  | { success: false; error: string };

export async function renderCoverLetterPdf(
  args: RenderCoverLetterArgs,
): Promise<RenderCoverLetterResult> {
  const job = await jobsRepo.getJobById(args.jobId);
  if (!job) {
    return { success: false, error: "Job not found." };
  }

  let docId = job.coverLetterDocumentId;
  if (!docId) {
    const summaries = await repo.listCoverLetterDocuments();
    docId = summaries[0]?.id ?? null;
  }
  if (!docId) {
    return {
      success: false,
      error:
        "No cover-letter template uploaded yet. Upload one from the Cover Letter page first.",
    };
  }

  const document = await repo.getCoverLetterDocumentById(docId);
  if (!document) {
    return { success: false, error: "Cover-letter document not found." };
  }
  if (!document.templatedTex || document.templatedTex.trim().length === 0) {
    return {
      success: false,
      error:
        "Cover-letter document has no templated tex. Re-extract it from the Cover Letter page.",
    };
  }
  const archive = await repo.getCoverLetterDocumentArchive(docId);
  if (!archive) {
    return { success: false, error: "Cover-letter archive missing." };
  }

  const effectiveValues: CvFieldOverrides = {
    ...document.defaultFieldValues,
    ...(job.coverLetterFieldOverrides ?? {}),
  };

  let renderedTex: string;
  try {
    renderedTex = renderTemplate(document.templatedTex, effectiveValues);
  } catch (error) {
    if (error instanceof RenderTemplateError) {
      return {
        success: false,
        error: `Could not render the cover-letter template: ${error.message}`,
      };
    }
    throw error;
  }

  const pdfDir = join(getDataDir(), "pdfs");
  await fs.mkdir(pdfDir, { recursive: true });
  const pdfPath = join(pdfDir, `cover_letter_${args.jobId}.pdf`);

  let pdfBytes: Uint8Array;
  try {
    const result = await runTectonic({
      renderedTex,
      archive: new Uint8Array(archive),
    });
    pdfBytes = result.pdf;
  } catch (error) {
    if (error instanceof RunTectonicError) {
      return {
        success: false,
        error: `LaTeX compile failed: ${error.message}`,
      };
    }
    throw error;
  }

  await fs.writeFile(pdfPath, Buffer.from(pdfBytes));

  // Pin doc id if not already pinned (e.g. user clicked Render without
  // first running Generate).
  const pinUpdate =
    job.coverLetterDocumentId === document.id
      ? {}
      : { coverLetterDocumentId: document.id };

  await jobsRepo.updateJob(job.id, {
    ...pinUpdate,
    coverLetterPdfPath: pdfPath,
  });

  logger.info("Cover letter PDF rendered", {
    jobId: job.id,
    coverLetterDocumentId: document.id,
    pdfPath,
    bytes: pdfBytes.byteLength,
  });

  const updated = await jobsRepo.getJobById(job.id);
  if (!updated) {
    return { success: false, error: "Failed to reload job after render." };
  }
  return { success: true, job: updated, pdfPath };
}
