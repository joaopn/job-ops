// @vitest-environment node
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

vi.mock("@server/repositories/job-pdfs", () => ({
  upsertJobPdf: vi.fn(),
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

// generatePdf now reads the profile's CV format; the real settings service
// opens SQLite at module load.
vi.mock("@server/services/settings", () => ({
  getEffectiveSettings: vi.fn(),
}));

// Keeps the real ConvertDocxError class for the instanceof branch.
vi.mock("@server/services/cv/docx/convert-docx-pdf", async () => {
  const actual = await vi.importActual<
    typeof import("@server/services/cv/docx/convert-docx-pdf")
  >("@server/services/cv/docx/convert-docx-pdf");
  return {
    ...actual,
    convertDocxToPdf: vi.fn(),
  };
});

import * as cvRepo from "@server/repositories/cv-documents";
import { upsertJobPdf } from "@server/repositories/job-pdfs";
import {
  ConvertDocxError,
  convertDocxToPdf,
} from "@server/services/cv/docx/convert-docx-pdf";
import { normalizeStoryPart } from "@server/services/cv/docx/normalize-runs";
import { parseDocx } from "@server/services/cv/docx/parse-docx";
import { spliceMarkers } from "@server/services/cv/docx/splice-markers";
import { simpleDoc } from "@server/services/cv/docx/test/fixture-builder";
import { RunTectonicError, runTectonic } from "@server/services/cv/run-tectonic";
import { getEffectiveSettings } from "@server/services/settings";
import { createAppSettings } from "@shared/testing/factories";
import { generatePdf } from "./pdf";

// A REAL template envelope over the fixture (parse → normalize → splice), so
// the docx cases exercise the real substituteParts / zipDocxParts.
const DOCX_ARCHIVE = simpleDoc();
const DOCX_FIELD_ID = "experience.0.bullet.0";
const DOCX_DEFAULT_VALUE =
  "Led migration of the rendering fleet to a queue-based architecture.";

function buildDocxCv(): CvDocument {
  const pkg = parseDocx(DOCX_ARCHIVE);
  for (const doc of pkg.storyParts.values()) normalizeStoryPart(doc);
  const parts = spliceMarkers(pkg.storyParts, pkg.storyPartOrder, [
    { id: DOCX_FIELD_ID, value: DOCX_DEFAULT_VALUE, segmentId: 2 },
  ]);
  return {
    ...FAKE_CV,
    id: "cv-docx",
    fields: [{ id: DOCX_FIELD_ID, role: "bullet", value: DOCX_DEFAULT_VALUE }],
    templatedTex: JSON.stringify({ parts: Object.fromEntries(parts) }),
    defaultFieldValues: { [DOCX_FIELD_ID]: DOCX_DEFAULT_VALUE },
  };
}

const DOCX_CV = buildDocxCv();

function useDocxProfile(): void {
  vi.mocked(getEffectiveSettings).mockResolvedValue(
    createAppSettings({ cvSourceFormat: "docx" }),
  );
  vi.mocked(cvRepo.getCvDocumentById).mockResolvedValue(DOCX_CV);
  vi.mocked(cvRepo.getCvDocumentArchive).mockResolvedValue(
    Buffer.from(DOCX_ARCHIVE),
  );
}

beforeEach(() => {
  vi.mocked(cvRepo.getCvDocumentById).mockResolvedValue(FAKE_CV);
  vi.mocked(cvRepo.getCvDocumentArchive).mockResolvedValue(
    Buffer.from("\\documentclass{article}\n", "utf8"),
  );
  vi.mocked(runTectonic).mockResolvedValue({
    pdf: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    log: "",
  });
  vi.mocked(getEffectiveSettings).mockResolvedValue(createAppSettings());
  vi.mocked(convertDocxToPdf).mockResolvedValue(
    new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("generatePdf", () => {
  it("renders the templated CV with default field values when no overrides are supplied", async () => {
    const result = await generatePdf({
      jobId: "job-42",
      cvDocumentId: "cv-1",
    });

    expect(result.success).toBe(true);
    expect(result.pdfPath).toBe("resume_job-42.pdf");

    expect(upsertJobPdf).toHaveBeenCalledTimes(1);
    const upsertArgs = vi.mocked(upsertJobPdf).mock.calls[0][0];
    expect(upsertArgs.jobId).toBe("job-42");
    expect(upsertArgs.kind).toBe("resume");
    expect(upsertArgs.data.subarray(0, 4).toString("ascii")).toBe("%PDF");

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
    expect(upsertJobPdf).not.toHaveBeenCalled();
  });

  it("renders successfully when overrides are no-op but allowBaselineRender is true", async () => {
    vi.mocked(cvRepo.getCvDocumentById).mockResolvedValueOnce({
      ...FAKE_CV,
      templatedTex: "\\documentclass{article}\n\\name{«basics.name»}\n",
      defaultFieldValues: { "basics.name": "Ada Lovelace" },
    });

    const result = await generatePdf({
      jobId: "job-44b",
      cvDocumentId: "cv-1",
      overrides: { "ghost.field": "ignored" },
      allowBaselineRender: true,
    });

    expect(result.success).toBe(true);
    expect(result.pdfPath).toBe("resume_job-44b.pdf");
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
    expect(upsertJobPdf).not.toHaveBeenCalled();
  });
});

describe("generatePdf on a Word profile", () => {
  beforeEach(() => {
    useDocxProfile();
  });

  it("persists the tailored .docx and its converted PDF", async () => {
    const result = await generatePdf({
      jobId: "job-50",
      cvDocumentId: "cv-docx",
      overrides: { [DOCX_FIELD_ID]: "Rebuilt the rendering fleet on a queue." },
    });

    expect(result.success).toBe(true);
    // Unchanged filename: the converted PDF rides the same `resume` kind, so
    // every caller and client surface keeps working.
    expect(result.pdfPath).toBe("resume_job-50.pdf");

    expect(runTectonic).not.toHaveBeenCalled();
    expect(upsertJobPdf).toHaveBeenCalledTimes(2);

    const [docxUpsert, pdfUpsert] = vi
      .mocked(upsertJobPdf)
      .mock.calls.map((call) => call[0]);
    // The .docx is the authoritative artifact and is persisted first.
    expect(docxUpsert.kind).toBe("resume_docx");
    expect(docxUpsert.jobId).toBe("job-50");
    expect(docxUpsert.data.subarray(0, 2).toString("ascii")).toBe("PK");
    expect(pdfUpsert.kind).toBe("resume");
    expect(pdfUpsert.data.subarray(0, 4).toString("ascii")).toBe("%PDF");

    // The converter received the rendered docx, and the tailored text made it
    // into the document.
    const converted = vi.mocked(convertDocxToPdf).mock.calls[0][0].docx;
    expect(Buffer.from(converted).toString("latin1")).not.toContain(
      `⟦${DOCX_FIELD_ID}`,
    );
  });

  it("hard-fails a no-op tailoring without persisting or converting", async () => {
    const result = await generatePdf({
      jobId: "job-51",
      cvDocumentId: "cv-docx",
      overrides: { "ghost.field": "ignored" },
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no actual change to the CV/);
    expect(upsertJobPdf).not.toHaveBeenCalled();
    expect(convertDocxToPdf).not.toHaveBeenCalled();
  });

  it("renders a no-op override set when allowBaselineRender is true", async () => {
    const result = await generatePdf({
      jobId: "job-52",
      cvDocumentId: "cv-docx",
      overrides: { "ghost.field": "ignored" },
      allowBaselineRender: true,
    });

    expect(result.success).toBe(true);
    expect(upsertJobPdf).toHaveBeenCalledTimes(2);
  });

  it("persists nothing when the conversion fails", async () => {
    vi.mocked(convertDocxToPdf).mockRejectedValueOnce(
      new ConvertDocxError("daemon down", "UNAVAILABLE", "spawn ENOENT"),
    );

    const result = await generatePdf({
      jobId: "job-53",
      cvDocumentId: "cv-docx",
      overrides: { [DOCX_FIELD_ID]: "Rebuilt the fleet." },
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/PDF conversion failed/);
    // The ordering invariant: no stranded .docx blob on a conversion failure.
    expect(upsertJobPdf).not.toHaveBeenCalled();
  });

  it("fails when the template references an unknown field", async () => {
    vi.mocked(cvRepo.getCvDocumentById).mockResolvedValueOnce({
      ...DOCX_CV,
      // Defaults no longer cover the spliced marker → leftover on render.
      defaultFieldValues: {},
    });

    const result = await generatePdf({
      jobId: "job-54",
      cvDocumentId: "cv-docx",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Could not render the CV template/);
    expect(upsertJobPdf).not.toHaveBeenCalled();
    expect(convertDocxToPdf).not.toHaveBeenCalled();
  });
});
