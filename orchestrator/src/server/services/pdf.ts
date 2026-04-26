/**
 * Stub: PDF generation is being rewritten on top of a user-uploaded LaTeX
 * template + structured CvContent + Tectonic. Until that lands, every call
 * site here returns a graceful failure so the pipeline can still boot and
 * the rest of the app works.
 */

export interface PdfResult {
  success: boolean;
  pdfPath?: string;
  error?: string;
}

export interface TailoredPdfContent {
  summary?: string | null;
  headline?: string | null;
  skills?: Array<{ name: string; keywords: string[] }> | null;
}

export interface GeneratePdfOptions {
  requestOrigin?: string | null;
}

const PENDING_MESSAGE =
  "PDF generation is offline while the LaTeX-based resume layer is being rebuilt.";

export async function generatePdf(
  _jobId: string,
  _content: TailoredPdfContent,
  _jobDescription: string,
  _baseResumePath?: string,
  _selectedProjectIds?: string | null,
  _options?: GeneratePdfOptions,
): Promise<PdfResult> {
  return { success: false, error: PENDING_MESSAGE };
}
