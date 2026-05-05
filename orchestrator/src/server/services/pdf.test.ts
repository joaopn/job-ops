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
  flattenedTex: "\\documentclass{article}\n\\name{Ada Lovelace}\n",
  fields: SAMPLE_FIELDS,
  personalBrief: "",
  templatedTex: "\\documentclass{article}\n\\name{«basics.name»}\n",
  defaultFieldValues: { "basics.name": "Ada Lovelace" },
  lastCompileStderr: null,
  compileAttempts: 0,
  extractionPrompt: "",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

vi.mock("@server/repositories/cv-documents", () => ({
  getCvDocumentById: vi.fn(),
  getCvDocumentArchive: vi.fn(),
}));

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
  it("renders the templated CV with default field values when no overrides are supplied", async () => {
    const result = await generatePdf({
      jobId: "job-42",
      cvDocumentId: "cv-1",
    });

    expect(result.success).toBe(true);
    const expectedPath = join(dataDir, "pdfs", "resume_job-42.pdf");
    expect(result.pdfPath).toBe(expectedPath);

    const written = await fs.readFile(expectedPath);
    expect(written.subarray(0, 4).toString("ascii")).toBe("%PDF");

    expect(runTectonic).toHaveBeenCalledWith(
      expect.objectContaining({
        renderedTex: "\\documentclass{article}\n\\name{Ada Lovelace}\n",
      }),
    );
  });

  it("substitutes overrides on top of defaults via the «marker» path", async () => {
    const result = await generatePdf({
      jobId: "job-43",
      cvDocumentId: "cv-1",
      overrides: { "basics.name": "Ada L. Byron" },
    });

    expect(result.success).toBe(true);
    expect(runTectonic).toHaveBeenCalledWith(
      expect.objectContaining({
        renderedTex: "\\documentclass{article}\n\\name{Ada L. Byron}\n",
      }),
    );
  });

  it("hard-fails when overrides are non-empty but the rendered tex equals the default-substituted baseline", async () => {
    vi.mocked(cvRepo.getCvDocumentById).mockResolvedValueOnce({
      ...FAKE_CV,
      // CV with a marker the override doesn't address — render falls back
      // to defaults and is identical to the default-only baseline.
      templatedTex: "\\documentclass{article}\n\\name{«basics.name»}\n",
      defaultFieldValues: { "basics.name": "Ada Lovelace" },
    });

    const result = await generatePdf({
      jobId: "job-44",
      cvDocumentId: "cv-1",
      overrides: { "ghost.field": "ignored" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no actual change to the CV/);
  });

  it("hard-fails when the CV has no templatedTex (legacy upload)", async () => {
    vi.mocked(cvRepo.getCvDocumentById).mockResolvedValueOnce({
      ...FAKE_CV,
      templatedTex: "",
      defaultFieldValues: {},
    });

    const result = await generatePdf({
      jobId: "job-45",
      cvDocumentId: "cv-1",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not have an extracted template/);
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
