// @vitest-environment node
import type { CvField } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flattenInput: vi.fn(),
  llmTemplateExtract: vi.fn(),
  runTectonic: vi.fn(),
  pdftotextDiff: vi.fn(),
}));

vi.mock("./flatten-input", async (importActual) => {
  const actual = await importActual<typeof import("./flatten-input")>();
  return {
    ...actual,
    flattenInput: mocks.flattenInput,
  };
});

vi.mock("./llm-template-extract", async (importActual) => {
  const actual =
    await importActual<typeof import("./llm-template-extract")>();
  return {
    ...actual,
    llmTemplateExtract: mocks.llmTemplateExtract,
  };
});

vi.mock("./run-tectonic", async (importActual) => {
  const actual = await importActual<typeof import("./run-tectonic")>();
  return {
    ...actual,
    runTectonic: mocks.runTectonic,
  };
});

vi.mock("./pdftotext-diff", async (importActual) => {
  const actual = await importActual<typeof import("./pdftotext-diff")>();
  return {
    ...actual,
    pdftotextDiff: mocks.pdftotextDiff,
  };
});

vi.mock("@infra/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { FlattenInputError } from "./flatten-input";
import { TemplateExtractError } from "./llm-template-extract";
import { RunTectonicError } from "./run-tectonic";
import { runUploadPipeline } from "./upload-pipeline";

const VALID_FIELDS: CvField[] = [
  { id: "basics.name", role: "name", value: "Ada Lovelace" },
];
const VALID_TEMPLATE = "\\textbf{«basics.name»}";
const VALID_FLATTENED = "\\textbf{Ada Lovelace}";

const FAKE_PDF_ORIGINAL = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"
const FAKE_PDF_TEMPLATED = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x01]);

const FAKE_FLATTENED_RESULT = {
  flattenedTex: VALID_FLATTENED,
  entrypoint: "main.tex",
  assetReferences: [],
};

const ARCHIVE = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // zip header bytes

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flattenInput.mockReturnValue(FAKE_FLATTENED_RESULT);
  mocks.runTectonic.mockResolvedValue({
    pdf: FAKE_PDF_ORIGINAL,
    log: "ok",
  });
  mocks.llmTemplateExtract.mockResolvedValue({
    templatedTex: VALID_TEMPLATE,
    fields: VALID_FIELDS,
    personalBrief: "Brief",
  });
  mocks.pdftotextDiff.mockResolvedValue({
    ok: true,
    diff: "",
    divergentLines: 0,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runUploadPipeline — happy path", () => {
  it("accepts the upload on the first attempt when every gate passes", async () => {
    // Arrange: tectonic returns a different PDF for the templated render
    // than for the original (so the diff would have something to compare).
    mocks.runTectonic
      .mockResolvedValueOnce({ pdf: FAKE_PDF_ORIGINAL, log: "original-ok" })
      .mockResolvedValueOnce({ pdf: FAKE_PDF_TEMPLATED, log: "templated-ok" });

    const result = await runUploadPipeline({
      archive: ARCHIVE,
      filename: "cv.zip",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compileAttempts).toBe(1);
    expect(result.fields).toEqual(VALID_FIELDS);
    expect(result.defaultFieldValues).toEqual({
      "basics.name": "Ada Lovelace",
    });
    expect(result.compileStderr).toBe("templated-ok");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].failureKind).toBeNull();
  });
});

describe("runUploadPipeline — pre-LLM rejection", () => {
  it("rejects at flatten stage", async () => {
    mocks.flattenInput.mockImplementation(() => {
      throw new FlattenInputError(
        "Single-file upload contains \\input{}.",
        "UNRESOLVED_INPUT",
      );
    });

    const result = await runUploadPipeline({
      archive: ARCHIVE,
      filename: "cv.tex",
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        stage: "flatten",
        flattenCode: "UNRESOLVED_INPUT",
      }),
    );
    expect(mocks.llmTemplateExtract).not.toHaveBeenCalled();
  });

  it("rejects when the original CV does not compile", async () => {
    mocks.runTectonic.mockRejectedValueOnce(
      new RunTectonicError("missing class", "NON_ZERO_EXIT", "! File foo.cls"),
    );

    const result = await runUploadPipeline({
      archive: ARCHIVE,
      filename: "cv.zip",
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        stage: "compile-original",
        originalCompileStderr: "! File foo.cls",
      }),
    );
    expect(mocks.llmTemplateExtract).not.toHaveBeenCalled();
  });
});

describe("runUploadPipeline — extract loop", () => {
  it("retries with previous-attempt context after a compile failure and accepts on attempt 2", async () => {
    // Original compile, then templated compile fails, then templated compile passes.
    mocks.runTectonic
      .mockResolvedValueOnce({ pdf: FAKE_PDF_ORIGINAL, log: "" })
      .mockRejectedValueOnce(
        new RunTectonicError("brace mismatch", "NON_ZERO_EXIT", "! Extra }"),
      )
      .mockResolvedValueOnce({ pdf: FAKE_PDF_TEMPLATED, log: "ok" });

    const result = await runUploadPipeline({
      archive: ARCHIVE,
      filename: "cv.zip",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compileAttempts).toBe(2);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].failureKind).toBe("compile");
    expect(result.attempts[0].compileStderr).toBe("! Extra }");
    expect(result.attempts[1].failureKind).toBeNull();

    // Second LLM call should have received previous-attempt context.
    const secondLlmCall = mocks.llmTemplateExtract.mock.calls[1][0];
    expect(secondLlmCall.previousAttempt).toEqual(
      expect.objectContaining({
        templatedTex: VALID_TEMPLATE,
        failureKind: "compile",
        compileStderr: "! Extra }",
      }),
    );
  });

  it("retries after a content-diff failure and feeds the diff back", async () => {
    mocks.runTectonic
      .mockResolvedValueOnce({ pdf: FAKE_PDF_ORIGINAL, log: "" })
      .mockResolvedValueOnce({ pdf: FAKE_PDF_TEMPLATED, log: "" })
      .mockResolvedValueOnce({ pdf: FAKE_PDF_TEMPLATED, log: "" });
    mocks.pdftotextDiff
      .mockResolvedValueOnce({
        ok: false,
        diff: "- Original line\n+ Spurious line",
        divergentLines: 2,
      })
      .mockResolvedValueOnce({ ok: true, diff: "", divergentLines: 0 });

    const result = await runUploadPipeline({
      archive: ARCHIVE,
      filename: "cv.zip",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compileAttempts).toBe(2);
    expect(result.attempts[0].failureKind).toBe("content-diff");
    expect(result.attempts[0].contentDiff).toContain("Original line");

    const secondLlmCall = mocks.llmTemplateExtract.mock.calls[1][0];
    expect(secondLlmCall.previousAttempt).toEqual(
      expect.objectContaining({
        failureKind: "content-diff",
        contentDiff: expect.stringContaining("Original line"),
      }),
    );
  });

  it("records an llm failure without a template to carry forward", async () => {
    mocks.llmTemplateExtract
      .mockRejectedValueOnce(
        new TemplateExtractError("rate limited", "LLM_FAILED"),
      )
      .mockResolvedValueOnce({
        templatedTex: VALID_TEMPLATE,
        fields: VALID_FIELDS,
        personalBrief: "Brief",
      });
    mocks.runTectonic
      .mockResolvedValueOnce({ pdf: FAKE_PDF_ORIGINAL, log: "" })
      .mockResolvedValueOnce({ pdf: FAKE_PDF_TEMPLATED, log: "" });

    const result = await runUploadPipeline({
      archive: ARCHIVE,
      filename: "cv.zip",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compileAttempts).toBe(2);
    expect(result.attempts[0].failureKind).toBe("llm");
    expect(result.attempts[0].failureMessage).toContain("LLM_FAILED");

    // The first failure had no template, so the second LLM call should
    // not receive a previousAttempt context.
    const secondLlmCall = mocks.llmTemplateExtract.mock.calls[1][0];
    expect(secondLlmCall.previousAttempt).toBeUndefined();
  });

  it("rejects after exhausting all retries", async () => {
    mocks.runTectonic.mockResolvedValue({ pdf: FAKE_PDF_ORIGINAL, log: "" });
    mocks.pdftotextDiff.mockResolvedValue({
      ok: false,
      diff: "- bad",
      divergentLines: 1,
    });

    const result = await runUploadPipeline({
      archive: ARCHIVE,
      filename: "cv.zip",
      maxRetries: 2,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("extract-loop");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts?.every((a) => a.failureKind !== null)).toBe(true);
  });

  it("clamps maxRetries to a minimum of 1", async () => {
    mocks.pdftotextDiff.mockResolvedValue({
      ok: false,
      diff: "",
      divergentLines: 1,
    });
    mocks.runTectonic.mockResolvedValue({ pdf: FAKE_PDF_ORIGINAL, log: "" });

    const result = await runUploadPipeline({
      archive: ARCHIVE,
      filename: "cv.zip",
      maxRetries: 0,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.attempts).toHaveLength(1);
  });
});
