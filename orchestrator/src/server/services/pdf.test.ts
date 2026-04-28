// @vitest-environment node
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CvDocument, CvField } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SAMPLE_FIELDS: CvField[] = [
  { id: "basics.name", role: "name", value: "Ada Lovelace" },
];

const FAKE_CV: CvDocument = {
  id: "cv-1",
  name: "Ada CV",
  flattenedTex:
    "\\documentclass{article}\n\\name{Ada Lovelace}\n",
  fields: SAMPLE_FIELDS,
  personalBrief: "",
  templatedTex: "",
  defaultFieldValues: {},
  lastCompileStderr: null,
  compileAttempts: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

vi.mock("@server/repositories/cv-documents", () => ({
  getCvDocumentById: vi.fn(),
  getCvDocumentArchive: vi.fn(),
}));

vi.mock("@server/services/cv/render", async () => {
  const actual = await vi.importActual<typeof import("@server/services/cv/render")>(
    "@server/services/cv/render",
  );
  return {
    ...actual,
    renderCv: vi.fn(),
  };
});

vi.mock("@server/services/cv/run-tectonic", async () => {
  const actual = await vi.importActual<
    typeof import("@server/services/cv/run-tectonic")
  >("@server/services/cv/run-tectonic");
  return {
    ...actual,
    runTectonic: vi.fn(),
  };
});

import * as cvRepo from "@server/repositories/cv-documents";
import { RenderCvError, renderCv } from "@server/services/cv/render";
import { RunTectonicError, runTectonic } from "@server/services/cv/run-tectonic";
import { generatePdf } from "./pdf";

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(join(tmpdir(), "pdf-svc-test-"));
  process.env.DATA_DIR = dataDir;
  vi.mocked(cvRepo.getCvDocumentById).mockResolvedValue(FAKE_CV);
  vi.mocked(cvRepo.getCvDocumentArchive).mockResolvedValue(
    Buffer.from("\\documentclass{article}\n", "utf8"),
  );
  vi.mocked(renderCv).mockReturnValue(FAKE_CV.flattenedTex);
  vi.mocked(runTectonic).mockResolvedValue({
    pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    log: "",
  });
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("generatePdf", () => {
  it("renders the source verbatim and writes a PDF when no overrides are supplied", async () => {
    const result = await generatePdf({
      jobId: "job-42",
      cvDocumentId: "cv-1",
    });

    expect(result.success).toBe(true);
    const expectedPath = join(dataDir, "pdfs", "resume_job-42.pdf");
    expect(result.pdfPath).toBe(expectedPath);

    const written = await fs.readFile(expectedPath);
    expect(written.subarray(0, 4).toString("ascii")).toBe("%PDF");

    expect(renderCv).toHaveBeenCalledWith(
      FAKE_CV.flattenedTex,
      SAMPLE_FIELDS,
      {},
    );
  });

  it("threads field overrides into the renderer", async () => {
    await generatePdf({
      jobId: "job-43",
      cvDocumentId: "cv-1",
      overrides: { "basics.name": "Ada L. Byron" },
    });

    expect(renderCv).toHaveBeenCalledWith(
      FAKE_CV.flattenedTex,
      SAMPLE_FIELDS,
      { "basics.name": "Ada L. Byron" },
    );
  });

  it("returns a failure when the CV document does not exist", async () => {
    vi.mocked(cvRepo.getCvDocumentById).mockResolvedValueOnce(null);
    const result = await generatePdf({
      jobId: "job-1",
      cvDocumentId: "missing",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/CV document not found/);
  });

  it("returns a failure when the renderer throws", async () => {
    vi.mocked(renderCv).mockImplementationOnce(() => {
      throw new RenderCvError("forbidden", "FORBIDDEN_PATTERN");
    });
    const result = await generatePdf({
      jobId: "job-1",
      cvDocumentId: "cv-1",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Template render failed/);
  });

  it("returns a failure when tectonic exits non-zero", async () => {
    vi.mocked(runTectonic).mockRejectedValueOnce(
      new RunTectonicError("compile failed", "NON_ZERO_EXIT", "log"),
    );
    const result = await generatePdf({
      jobId: "job-1",
      cvDocumentId: "cv-1",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/LaTeX compile failed/);
  });
});
