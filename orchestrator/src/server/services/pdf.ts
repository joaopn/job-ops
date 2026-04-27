import { promises as fs } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@server/config/dataDir";
import * as cvRepo from "@server/repositories/cv-documents";
import {
  RenderTemplateError,
  renderTemplate,
} from "@server/services/cv/render-template";
import {
  RunTectonicError,
  runTectonic,
} from "@server/services/cv/run-tectonic";
import type { CvContent } from "@shared/types";

export interface GeneratePdfArgs {
  jobId: string;
  cvDocumentId: string;
  content: CvContent;
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
    renderedTex = renderTemplate(document.template, args.content);
  } catch (error) {
    if (error instanceof RenderTemplateError) {
      return { success: false, error: `Template render failed: ${error.message}` };
    }
    throw error;
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
