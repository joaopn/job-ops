// @vitest-environment node
import type { CvField } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  flattenInput: vi.fn(),
  llmCoverLetterTemplateExtract: vi.fn(),
  runTectonic: vi.fn(),
  pdftotextDiff: vi.fn(),
}));

vi.mock("@server/services/cv/flatten-input", async (importActual) => {
  const actual =
    await importActual<typeof import("@server/services/cv/flatten-input")>();
  return {
    ...actual,
    flattenInput: mocks.flattenInput,
  };
});

vi.mock("./llm-template-extract", async (importActual) => {
  const actual = await importActual<typeof import("./llm-template-extract")>();
  return {
    ...actual,
    llmCoverLetterTemplateExtract: mocks.llmCoverLetterTemplateExtract,
  };
});

vi.mock("@server/services/cv/run-tectonic", async (importActual) => {
  const actual =
    await importActual<typeof import("@server/services/cv/run-tectonic")>();
  return {
    ...actual,
    runTectonic: mocks.runTectonic,
  };
});

vi.mock("@server/services/cv/pdftotext-diff", async (importActual) => {
  const actual =
    await importActual<typeof import("@server/services/cv/pdftotext-diff")>();
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

import { FlattenInputError } from "@server/services/cv/flatten-input";
import { RunTectonicError } from "@server/services/cv/run-tectonic";
import { CoverLetterTemplateExtractError } from "./llm-template-extract";
import { runCoverLetterUploadPipeline } from "./upload-pipeline";

const VALID_FIELDS: CvField[] = [
  { id: "body.text", role: "body", value: "Dear Hiring Team,\nApplying for the Lead Engineer role.\nSincerely," },
];
const VALID_TEMPLATE = "\\begin{letter}{Acme}«body.text»\\end{letter}";
const VALID_FLATTENED =
  "\\begin{letter}{Acme}Dear Hiring Team,\nApplying for the Lead Engineer role.\nSincerely,\\end{letter}";

const FAKE_PDF_ORIGINAL = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
const FAKE_PDF_TEMPLATED = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x01]);

const FAKE_FLATTENED_RESULT = {
  flattenedTex: VALID_FLATTENED,
  entrypoint: "coverletter.tex",
  assetReferences: [],
};

const ARCHIVE = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.flattenInput.mockReturnValue(FAKE_FLATTENED_RESULT);
  mocks.runTectonic.mockResolvedValue({
    pdf: FAKE_PDF_ORIGINAL,
    log: "ok",
  });
  mocks.llmCoverLetterTemplateExtract.mockResolvedValue({
    templatedTex: VALID_TEMPLATE,
    fields: VALID_FIELDS,
    bodyFieldId: "body.text",
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

describe("runCoverLetterUploadPipeline — happy path", () => {
  it("accepts the upload on the first attempt when every gate passes", async () => {
    mocks.runTectonic
      .mockResolvedValueOnce({ pdf: FAKE_PDF_ORIGINAL, log: "original-ok" })
      .mockResolvedValueOnce({ pdf: FAKE_PDF_TEMPLATED, log: "templated-ok" });

    const result = await runCoverLetterUploadPipeline({
      archive: ARCHIVE,
      filename: "letter.zip",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compileAttempts).toBe(1);
    expect(result.fields).toEqual(VALID_FIELDS);
    expect(result.bodyFieldId).toBe("body.text");
    expect(result.defaultFieldValues).toEqual({
      "body.text": VALID_FIELDS[0].value,
    });
    expect(result.compileStderr).toBe("templated-ok");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].failureKind).toBeNull();
  });

  it("passes the cover-letter entrypoint priority list to flattenInput", async () => {
    mocks.runTectonic
      .mockResolvedValueOnce({ pdf: FAKE_PDF_ORIGINAL, log: "" })
      .mockResolvedValueOnce({ pdf: FAKE_PDF_TEMPLATED, log: "" });

    await runCoverLetterUploadPipeline({
      archive: ARCHIVE,
      filename: "bundle.zip",
    });

    const args = mocks.flattenInput.mock.calls[0][0];
    expect(args.entrypointPriority).toEqual([
      "coverletter.tex",
      "cover-letter.tex",
      "letter.tex",
      "cover.tex",
    ]);
  });
});

describe("runCoverLetterUploadPipeline — pre-LLM rejection", () => {
  it("rejects at flatten stage", async () => {
    mocks.flattenInput.mockImplementation(() => {
      throw new FlattenInputError(
        "Single-file upload contains \\input{}.",
        "UNRESOLVED_INPUT",
      );
    });

    const result = await runCoverLetterUploadPipeline({
      archive: ARCHIVE,
      filename: "letter.tex",
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        stage: "flatten",
        flattenCode: "UNRESOLVED_INPUT",
      }),
    );
    expect(mocks.llmCoverLetterTemplateExtract).not.toHaveBeenCalled();
  });

  it("rejects when the original cover letter does not compile", async () => {
    mocks.runTectonic.mockRejectedValueOnce(
      new RunTectonicError(
        "missing class",
        "NON_ZERO_EXIT",
        "! File foo.cls",
      ),
    );

    const result = await runCoverLetterUploadPipeline({
      archive: ARCHIVE,
      filename: "letter.zip",
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        stage: "compile-original",
        originalCompileStderr: "! File foo.cls",
      }),
    );
    expect(mocks.llmCoverLetterTemplateExtract).not.toHaveBeenCalled();
  });
});

describe("runCoverLetterUploadPipeline — extract loop", () => {
  it("retries with previous-attempt context after a compile failure and accepts on attempt 2", async () => {
    mocks.runTectonic
      .mockResolvedValueOnce({ pdf: FAKE_PDF_ORIGINAL, log: "" })
      .mockRejectedValueOnce(
        new RunTectonicError("brace mismatch", "NON_ZERO_EXIT", "! Extra }"),
      )
      .mockResolvedValueOnce({ pdf: FAKE_PDF_TEMPLATED, log: "ok" });

    const result = await runCoverLetterUploadPipeline({
      archive: ARCHIVE,
      filename: "letter.zip",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compileAttempts).toBe(2);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].failureKind).toBe("compile");
    expect(result.attempts[0].compileStderr).toBe("! Extra }");
    expect(result.attempts[1].failureKind).toBeNull();

    const secondLlmCall = mocks.llmCoverLetterTemplateExtract.mock.calls[1][0];
    expect(secondLlmCall.previousAttempt).toEqual(
      expect.objectContaining({
        templatedTex: VALID_TEMPLATE,
        failureKind: "compile",
        compileStderr: "! Extra }",
      }),
    );
  });

  it("records an llm failure (e.g. body-field-count violation) without a template to carry forward", async () => {
    mocks.llmCoverLetterTemplateExtract
      .mockRejectedValueOnce(
        new CoverLetterTemplateExtractError(
          "Multiple body fields",
          "MULTIPLE_BODY_FIELDS",
        ),
      )
      .mockResolvedValueOnce({
        templatedTex: VALID_TEMPLATE,
        fields: VALID_FIELDS,
        bodyFieldId: "body.text",
      });
    mocks.runTectonic
      .mockResolvedValueOnce({ pdf: FAKE_PDF_ORIGINAL, log: "" })
      .mockResolvedValueOnce({ pdf: FAKE_PDF_TEMPLATED, log: "" });

    const result = await runCoverLetterUploadPipeline({
      archive: ARCHIVE,
      filename: "letter.zip",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compileAttempts).toBe(2);
    expect(result.attempts[0].failureKind).toBe("llm");
    expect(result.attempts[0].failureMessage).toContain("MULTIPLE_BODY_FIELDS");

    const secondLlmCall = mocks.llmCoverLetterTemplateExtract.mock.calls[1][0];
    expect(secondLlmCall.previousAttempt).toBeUndefined();
  });

  it("rejects after exhausting all retries", async () => {
    mocks.runTectonic.mockResolvedValue({ pdf: FAKE_PDF_ORIGINAL, log: "" });
    mocks.pdftotextDiff.mockResolvedValue({
      ok: false,
      diff: "- bad",
      divergentLines: 1,
    });

    const result = await runCoverLetterUploadPipeline({
      archive: ARCHIVE,
      filename: "letter.zip",
      maxRetries: 2,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe("extract-loop");
    expect(result.attempts).toHaveLength(2);
    expect(
      result.attempts?.every((attempt) => attempt.failureKind === "content-diff"),
    ).toBe(true);
  });
});
