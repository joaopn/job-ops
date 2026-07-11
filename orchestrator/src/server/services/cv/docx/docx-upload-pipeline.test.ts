// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConvertDocxError } from "./convert-docx-pdf";
import { runDocxUploadPipeline } from "./docx-upload-pipeline";
import { RenderDocxError } from "./render-docx";
import {
  docxWithBody,
  para,
  simpleDoc,
  trackedChangesDoc,
} from "./test/fixture-builder";

const mocks = vi.hoisted(() => ({
  llmExtract: vi.fn(),
  convert: vi.fn(),
  // The override receives the REAL renderDocx so tests can pass through
  // the zero-values render (roundTripCheck's stage-1 call goes through
  // this same mock) and tamper only with the substitution render.
  renderOverride: {
    fn: null as
      | null
      | ((
          args: { effectiveValues: Record<string, string> },
          actualRender: (args: unknown) => Uint8Array,
        ) => Uint8Array),
  },
}));

vi.mock("@server/db/index", () => ({ db: {}, schema: {}, closeDb: vi.fn() }));

// Plain factory (no importActual): the real module transitively imports the
// LLM/prompts service stack. The pipeline only needs the function and the
// error class identity, and its llm catch is identity-agnostic anyway.
vi.mock("./llm-docx-extract", () => ({
  llmDocxExtract: mocks.llmExtract,
  DocxExtractError: class DocxExtractError extends Error {},
}));

vi.mock("./convert-docx-pdf", async (importActual) => ({
  ...(await importActual<typeof import("./convert-docx-pdf")>()),
  convertDocxToPdf: (args: unknown) => mocks.convert(args),
}));

vi.mock("./render-docx", async (importActual) => {
  const actual = await importActual<typeof import("./render-docx")>();
  const realRender = (args: unknown) =>
    actual.renderDocx(args as Parameters<typeof actual.renderDocx>[0]);
  return {
    ...actual,
    renderDocx: (args: unknown) =>
      mocks.renderOverride.fn
        ? mocks.renderOverride.fn(
            args as { effectiveValues: Record<string, string> },
            realRender,
          )
        : realRender(args),
  };
});

// simpleDoc segments (non-empty paragraphs, document order):
//   [0] Jane Q. Applicant
//   [1] Vienna, Austria · jane@example.com
//   [2] Led migration of the rendering fleet to a queue-based architecture.
//   [3] Cut PDF generation latency by 60% through template precompilation.
const BULLET_FIELD = {
  id: "experience.0.bullet.0",
  role: "bullet" as const,
  value: "Led migration of the rendering fleet to a queue-based architecture.",
  segmentId: 2,
};

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

describe("runDocxUploadPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.renderOverride.fn = null;
    mocks.convert.mockResolvedValue(PDF_BYTES);
  });

  it("accepts a clean document with the full success shape", async () => {
    mocks.llmExtract.mockResolvedValue({
      fields: [BULLET_FIELD],
      personalBrief: "the brief",
    });

    const result = await runDocxUploadPipeline({ archive: simpleDoc() });
    if (!result.ok) throw new Error(`expected success, got ${result.stage}`);

    const envelope = JSON.parse(result.templatedTex) as {
      parts: Record<string, string>;
    };
    expect(envelope.parts["word/document.xml"]).toContain(
      "⟦experience.0.bullet.0⟧",
    );
    expect(result.fields).toEqual([
      {
        id: BULLET_FIELD.id,
        role: BULLET_FIELD.role,
        value: BULLET_FIELD.value,
      },
    ]);
    expect(result.defaultFieldValues).toEqual({
      [BULLET_FIELD.id]: BULLET_FIELD.value,
    });
    expect(result.flattenedTex).toBe(
      [
        "Jane Q. Applicant",
        "Vienna, Austria · jane@example.com",
        BULLET_FIELD.value,
        "Cut PDF generation latency by 60% through template precompilation.",
      ].join("\n"),
    );
    expect(result.personalBrief).toBe("the brief");
    expect(result.compileAttempts).toBe(1);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].failureKind).toBeNull();
    // convert-original + convert-substituted.
    expect(mocks.convert).toHaveBeenCalledTimes(2);
  });

  it("maps a parse reject to stage flatten with the typed code", async () => {
    const result = await runDocxUploadPipeline({
      archive: trackedChangesDoc(),
    });
    expect(result).toMatchObject({
      ok: false,
      stage: "flatten",
      flattenCode: "TRACKED_CHANGES",
    });
    expect(mocks.llmExtract).not.toHaveBeenCalled();
    expect(mocks.convert).not.toHaveBeenCalled();
  });

  it("maps a convert-original failure to stage compile-original", async () => {
    mocks.convert.mockRejectedValueOnce(
      new ConvertDocxError("daemon down", "UNAVAILABLE", "spawn ENOENT"),
    );
    const result = await runDocxUploadPipeline({ archive: simpleDoc() });
    expect(result).toMatchObject({
      ok: false,
      stage: "compile-original",
      originalCompileStderr: "spawn ENOENT",
    });
    expect(mocks.llmExtract).not.toHaveBeenCalled();
  });

  it("retries a splice failure with previous-attempt context", async () => {
    mocks.llmExtract
      .mockResolvedValueOnce({
        fields: [{ ...BULLET_FIELD, value: "NOT IN THE SEGMENT" }],
        personalBrief: "b",
      })
      .mockResolvedValueOnce({
        fields: [BULLET_FIELD],
        personalBrief: "b",
      });

    const result = await runDocxUploadPipeline({ archive: simpleDoc() });
    if (!result.ok) throw new Error(`expected success, got ${result.stage}`);

    expect(result.compileAttempts).toBe(2);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].failureKind).toBe("llm");
    expect(result.attempts[1].failureKind).toBeNull();

    const secondCall = mocks.llmExtract.mock.calls[1][0];
    expect(secondCall.previousAttempt).toMatchObject({
      failureKind: "splice",
    });
    expect(secondCall.previousAttempt.detail).toContain(
      "value not found in segment 2",
    );
    expect(secondCall.previousAttempt.fields[0].value).toBe(
      "NOT IN THE SEGMENT",
    );
  });

  it("records a text divergence as content-diff", async () => {
    mocks.llmExtract.mockResolvedValue({
      fields: [BULLET_FIELD],
      personalBrief: "b",
    });
    mocks.renderOverride.fn = (args, actualRender) =>
      Object.keys(args.effectiveValues).length === 0
        ? actualRender(args)
        : docxWithBody(para("Tampered text"));

    const result = await runDocxUploadPipeline({
      archive: simpleDoc(),
      maxRetries: 1,
    });
    expect(result).toMatchObject({ ok: false, stage: "extract-loop" });
    if (result.ok) throw new Error("expected failure");
    expect(result.attempts?.[0]).toMatchObject({
      failureKind: "content-diff",
    });
    expect(result.attempts?.[0].contentDiff).toContain("word/document.xml");
    expect(result.attempts?.[0].contentDiff).toContain("- Jane Q. Applicant");
  });

  it("records a render failure as failureKind render", async () => {
    mocks.llmExtract.mockResolvedValue({
      fields: [BULLET_FIELD],
      personalBrief: "b",
    });
    mocks.renderOverride.fn = (args, actualRender) => {
      if (Object.keys(args.effectiveValues).length === 0) {
        return actualRender(args);
      }
      throw new RenderDocxError("leftover marker", "MISSING_FIELD");
    };

    const result = await runDocxUploadPipeline({
      archive: simpleDoc(),
      maxRetries: 1,
    });
    expect(result).toMatchObject({ ok: false, stage: "extract-loop" });
    if (result.ok) throw new Error("expected failure");
    expect(result.attempts?.[0]).toMatchObject({
      failureKind: "render",
      failureMessage: "leftover marker",
    });
  });

  it("maps a convert-substituted failure to failureKind compile", async () => {
    mocks.llmExtract.mockResolvedValue({
      fields: [BULLET_FIELD],
      personalBrief: "b",
    });
    mocks.convert
      .mockResolvedValueOnce(PDF_BYTES)
      .mockRejectedValueOnce(
        new ConvertDocxError("hung", "TIMEOUT", "conversion timed out"),
      );

    const result = await runDocxUploadPipeline({
      archive: simpleDoc(),
      maxRetries: 1,
    });
    expect(result).toMatchObject({ ok: false, stage: "extract-loop" });
    if (result.ok) throw new Error("expected failure");
    expect(result.attempts?.[0]).toMatchObject({
      failureKind: "compile",
      compileStderr: "conversion timed out",
    });
  });

  it("exhausts llm failures and returns the attempt log", async () => {
    mocks.llmExtract.mockRejectedValue(new Error("llm down"));

    const result = await runDocxUploadPipeline({
      archive: simpleDoc(),
      maxRetries: 2,
    });
    expect(result).toMatchObject({ ok: false, stage: "extract-loop" });
    if (result.ok) throw new Error("expected failure");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts?.every((a) => a.failureKind === "llm")).toBe(true);
    // An llm failure carries nothing forward — the retry starts fresh.
    expect(mocks.llmExtract.mock.calls[1][0].previousAttempt).toBeUndefined();
    expect(result.message).toContain("llm down");
  });
});
