// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPreviousAttemptBlock,
  llmTemplateExtract,
  TemplateExtractError,
} from "./llm-template-extract";

const callJsonMock = vi.fn();

vi.mock("@server/services/llm/service", () => ({
  LlmService: class {
    callJson = callJsonMock;
  },
}));

vi.mock("@server/services/prompts", () => ({
  loadPrompt: vi.fn().mockResolvedValue({
    name: "cv-template-extract",
    description: "",
    system: "stub-system",
    user: "stub-user",
    modelHints: {},
  }),
}));

vi.mock("@server/services/modelSelection", () => ({
  resolveLlmModel: vi.fn().mockResolvedValue("test-model"),
}));

const SAMPLE_TEX =
  "\\textbf{«basics.name»} \\\\\n\\textit{«basics.title»}\n\\begin{itemize}\\item «experience.0.bullet.0»\\end{itemize}";

const SAMPLE_FIELDS = [
  { id: "basics.name", role: "name", value: "Ada Lovelace" },
  { id: "basics.title", role: "title", value: "Engineer" },
  { id: "experience.0.bullet.0", role: "bullet", value: "Built things." },
];

beforeEach(() => {
  callJsonMock.mockReset();
});

describe("llmTemplateExtract", () => {
  it("parses a well-formed response into templatedTex + fields + brief", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        templatedTex: SAMPLE_TEX,
        fieldsJson: JSON.stringify(SAMPLE_FIELDS),
        personalBrief: "I'm Ada — I write algorithms.",
      },
    });

    const result = await llmTemplateExtract({
      flattenedTex: "\\textbf{Ada Lovelace} \\\\\n\\textit{Engineer}",
      assetReferences: [],
    });

    expect(result.templatedTex).toBe(SAMPLE_TEX);
    expect(result.fields).toEqual(SAMPLE_FIELDS);
    expect(result.personalBrief).toBe("I'm Ada — I write algorithms.");
  });

  it("rejects an empty templatedTex", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        templatedTex: "",
        fieldsJson: "[]",
        personalBrief: "x",
      },
    });

    await expect(
      llmTemplateExtract({ flattenedTex: "x", assetReferences: [] }),
    ).rejects.toMatchObject({
      name: "TemplateExtractError",
      code: "EMPTY_TEMPLATE",
    });
  });

  it("rejects malformed fieldsJson", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        templatedTex: SAMPLE_TEX,
        fieldsJson: "{not valid json",
        personalBrief: "x",
      },
    });

    await expect(
      llmTemplateExtract({ flattenedTex: "x", assetReferences: [] }),
    ).rejects.toMatchObject({ code: "INVALID_FIELDS_JSON" });
  });

  it("rejects an empty fields array", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        templatedTex: SAMPLE_TEX,
        fieldsJson: "[]",
        personalBrief: "x",
      },
    });

    await expect(
      llmTemplateExtract({ flattenedTex: "x", assetReferences: [] }),
    ).rejects.toMatchObject({ code: "EMPTY_FIELDS" });
  });

  it("rejects duplicate field ids", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        templatedTex: "«x» «x»",
        fieldsJson: JSON.stringify([
          { id: "x", role: "name", value: "A" },
          { id: "x", role: "name", value: "B" },
        ]),
        personalBrief: "x",
      },
    });

    await expect(
      llmTemplateExtract({ flattenedTex: "A B", assetReferences: [] }),
    ).rejects.toMatchObject({ code: "DUPLICATE_FIELD_ID" });
  });

  it("rejects an unknown role", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        templatedTex: "«x»",
        fieldsJson: JSON.stringify([
          { id: "x", role: "magical", value: "A" },
        ]),
        personalBrief: "x",
      },
    });

    await expect(
      llmTemplateExtract({ flattenedTex: "A", assetReferences: [] }),
    ).rejects.toMatchObject({ code: "INVALID_FIELD_ROLE" });
  });

  it("rejects orphan markers (template references a fieldId with no entry)", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        templatedTex: "«basics.name» «basics.email»",
        fieldsJson: JSON.stringify([
          { id: "basics.name", role: "name", value: "Ada" },
        ]),
        personalBrief: "x",
      },
    });

    await expect(
      llmTemplateExtract({ flattenedTex: "Ada x", assetReferences: [] }),
    ).rejects.toMatchObject({
      code: "ORPHAN_MARKER",
      detail: { fieldId: "basics.email" },
    });
  });

  it("rejects orphan fields (entry has no marker in template)", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        templatedTex: "«basics.name»",
        fieldsJson: JSON.stringify([
          { id: "basics.name", role: "name", value: "Ada" },
          { id: "basics.email", role: "email", value: "ada@x.com" },
        ]),
        personalBrief: "x",
      },
    });

    await expect(
      llmTemplateExtract({ flattenedTex: "Ada", assetReferences: [] }),
    ).rejects.toMatchObject({
      code: "ORPHAN_FIELD",
      detail: { fieldId: "basics.email" },
    });
  });

  it("translates an LLM call failure into LLM_FAILED", async () => {
    callJsonMock.mockResolvedValue({ success: false, error: "rate limited" });

    await expect(
      llmTemplateExtract({ flattenedTex: "x", assetReferences: [] }),
    ).rejects.toMatchObject({ code: "LLM_FAILED" });
  });
});

describe("buildPreviousAttemptBlock", () => {
  it("returns empty string when no previous attempt", () => {
    expect(buildPreviousAttemptBlock(undefined)).toBe("");
  });

  it("includes templatedTex and stderr on a compile failure", () => {
    const block = buildPreviousAttemptBlock({
      templatedTex: "\\bad{",
      fields: [],
      failureKind: "compile",
      compileStderr: "! Missing } inserted.",
    });
    expect(block).toContain("did not compile");
    expect(block).toContain("\\bad{");
    expect(block).toContain("Missing } inserted");
  });

  it("includes templatedTex and content diff on a content-diff failure", () => {
    const block = buildPreviousAttemptBlock({
      templatedTex: "«x»",
      fields: [{ id: "x", role: "name", value: "A" }],
      failureKind: "content-diff",
      contentDiff: "- Original line\n+ Spurious line",
    });
    expect(block).toContain("PDF content diverges");
    expect(block).toContain("- Original line");
    expect(block).toContain("+ Spurious line");
  });

  it("truncates oversized templatedTex / stderr", () => {
    const massive = "x".repeat(20_000);
    const block = buildPreviousAttemptBlock({
      templatedTex: massive,
      fields: [],
      failureKind: "compile",
      compileStderr: massive,
    });
    expect(block.length).toBeLessThan(15_000);
    expect(block).toContain("…(truncated)");
  });
});
