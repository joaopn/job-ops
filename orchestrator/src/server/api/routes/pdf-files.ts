/**
 * Serves generated job PDFs from the `job_pdfs` BLOB table.
 *
 * Mounted at `/pdfs` OUTSIDE `/api` — deliberately auth-exempt, exactly like
 * the `express.static(data/pdfs)` mount it replaces (`requiresAuth` exempts
 * non-/api GET/HEAD). URL shape is unchanged so no client code moves:
 * `/pdfs/resume_<jobId>.pdf` and `/pdfs/cover_letter_<jobId>.pdf`, with the
 * client's `?v=<updatedAt>` cache-buster ignored server-side. Missing PDFs
 * now 404 instead of falling through to the SPA index.html.
 */

import { logger } from "@infra/logger";
import { getJobPdf, type JobPdfKind } from "@server/repositories/job-pdfs";
import { type Request, type Response, Router } from "express";

// Job ids are randomUUID(); the charset class stays a superset for safety.
const FILENAME_PATTERN = /^(resume|cover_letter)_([A-Za-z0-9_-]+)\.pdf$/;

export const pdfFilesRouter = Router();

pdfFilesRouter.get("/:filename", async (req: Request, res: Response) => {
  try {
    const match = FILENAME_PATTERN.exec(req.params.filename);
    if (!match) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    const kind = match[1] as JobPdfKind;
    const jobId = match[2];

    const data = await getJobPdf(jobId, kind);
    if (!data) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${req.params.filename}"`,
    );
    res.send(data);
  } catch (error) {
    logger.error("Failed to serve job PDF", {
      route: "/pdfs/:filename",
      filename: req.params.filename,
      error: error instanceof Error ? error.message : String(error),
    });
    if (!res.headersSent) {
      res.status(500).type("text/plain").send("Internal error");
    }
  }
});
