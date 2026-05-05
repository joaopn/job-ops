import { promises as fs } from "node:fs";
import { join } from "node:path";
import { logger } from "@infra/logger";
import { getDataDir } from "@server/config/dataDir";
import * as cvRepo from "@server/repositories/cv-documents";
import { renderCv, RenderCvError } from "@server/services/cv/render";
import {
  RunTectonicError,
  runTectonic,
} from "@server/services/cv/run-tectonic";
import type { CvFieldOverrides } from "@shared/types";

export interface GeneratePdfArgs {
  jobId: string;
  cvDocumentId: string;
  /**
   * Per-field overrides. Empty/missing → render the original `flattened_tex`
   * byte-for-byte.
   */
  overrides?: CvFieldOverrides;
}

export interface PdfResult {
  success: boolean;
  pdfPath?: string;
  error?: string;
}

export async function generatePdf(args: GeneratePdfArgs): Promise<PdfResult> {
  const document = await cvRepo.getCvDocumentById(args.cvDocumentId);
  if (!document) {
    return { success: false, error: "CV document not found." };
  }
  const archive = await cvRepo.getCvDocumentArchive(args.cvDocumentId);
  if (!archive) {
    return { success: false, error: "CV archive missing for document." };
  }

  let renderedTex: string;
  try {
    renderedTex = renderCv(
      document.flattenedTex,
      document.fields,
      args.overrides ?? {},
    );
  } catch (error) {
    if (error instanceof RenderCvError) {
      return { success: false, error: `Template render failed: ${error.message}` };
    }
    throw error;
  }

  const overrideCount = Object.keys(args.overrides ?? {}).length;
  const identicalToBaseline = renderedTex === document.flattenedTex;
  logger.info("CV render result", {
    jobId: args.jobId,
    cvDocumentId: args.cvDocumentId,
    overrideCount,
    cvFieldCount: document.fields.length,
    flattenedTexLength: document.flattenedTex.length,
    renderedTexLength: renderedTex.length,
    identicalToBaseline,
  });
  if (overrideCount > 0 && identicalToBaseline) {
    logger.warn(
      "CV render produced byte-identical output despite overrides — fieldId mismatch or unfindable values",
      {
        jobId: args.jobId,
        cvDocumentId: args.cvDocumentId,
        overrideIds: Object.keys(args.overrides ?? {}).slice(0, 10),
        cvFieldIdSample: document.fields.slice(0, 5).map((f) => f.id),
      },
    );
  }

  const pdfDir = join(getDataDir(), "pdfs");
  await fs.mkdir(pdfDir, { recursive: true });
  const pdfPath = join(pdfDir, `resume_${args.jobId}.pdf`);

  try {
    const result = await runTectonic({
      renderedTex,
      archive: new Uint8Array(archive),
    });
    await fs.writeFile(pdfPath, Buffer.from(result.pdf));
    return { success: true, pdfPath };
  } catch (error) {
    if (error instanceof RunTectonicError) {
      return { success: false, error: `LaTeX compile failed: ${error.message}` };
    }
    throw error;
  }
}
