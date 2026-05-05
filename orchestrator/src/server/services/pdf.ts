import { promises as fs } from "node:fs";
import { join } from "node:path";
import { logger } from "@infra/logger";
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
import type { CvFieldOverrides } from "@shared/types";

export interface GeneratePdfArgs {
  jobId: string;
  cvDocumentId: string;
  /**
   * Per-field overrides. Empty/missing → render `templatedTex` against
   * `defaultFieldValues` only, producing a PDF equivalent to the original
   * source CV.
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

  // Render the rendered-template via literal placeholder replacement.
  // The legacy cursor-walk path is retired — it silently dropped overrides
  // whenever the extracted field value didn't match the source byte-for-
  // byte, which produced baseline-identical "tailored" PDFs.
  if (!document.templatedTex || document.templatedTex.trim().length === 0) {
    return {
      success: false,
      error:
        "This CV does not have an extracted template yet. Re-upload the CV from the CV page to rebuild it.",
    };
  }

  const overrides = args.overrides ?? {};
  const effectiveValues: CvFieldOverrides = {
    ...document.defaultFieldValues,
    ...overrides,
  };

  let renderedTex: string;
  try {
    renderedTex = renderTemplate(document.templatedTex, effectiveValues);
  } catch (error) {
    if (error instanceof RenderTemplateError) {
      return {
        success: false,
        error: `Could not render the CV template: ${error.message}`,
      };
    }
    throw error;
  }

  const overrideCount = Object.keys(overrides).length;
  const baselineRender = renderTemplate(
    document.templatedTex,
    document.defaultFieldValues,
  );
  const identicalToBaseline = renderedTex === baselineRender;
  logger.info("CV render result", {
    jobId: args.jobId,
    cvDocumentId: args.cvDocumentId,
    overrideCount,
    cvFieldCount: document.fields.length,
    templatedTexLength: document.templatedTex.length,
    renderedTexLength: renderedTex.length,
    identicalToBaseline,
  });

  // Hard-fail when overrides were supplied but the rendered output equals
  // the default-substituted baseline. Either every tailored field was
  // missing from the CV's extracted fields OR every tailored value was
  // identical to the original. Shipping a baseline PDF as a "tailored" one
  // is forbidden.
  if (overrideCount > 0 && identicalToBaseline) {
    const overrideIds = Object.keys(overrides);
    const knownFieldIds = document.fields.slice(0, 5).map((f) => f.id);
    logger.error(
      "Tailoring produced no actual change to the CV — failing hard",
      {
        jobId: args.jobId,
        cvDocumentId: args.cvDocumentId,
        overrideIds: overrideIds.slice(0, 10),
        knownFieldIds,
      },
    );
    return {
      success: false,
      error: `Tailoring produced no actual change to the CV. The ${overrideCount} proposed change(s) either targeted unknown CV fields or matched the original values exactly. Try re-uploading the CV from the CV page.`,
    };
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
