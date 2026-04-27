// @vitest-environment node
import { loadPrompt } from "@server/services/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { llmAdjustContent } from "./llm-adjust-content";

const callJsonMock = vi.fn();

vi.mock("@server/services/llm/service", () => ({
  LlmService: class {
    callJson = callJsonMock;
  },
}));

vi.mock("@server/services/prompts", () => ({
  loadPrompt: vi.fn().mockResolvedValue({
    name: "cv-adjust",
    description: "",
    system: "stub-system",
    user: "stub-user",
    modelHints: {},
  }),
}));

vi.mock("@server/services/modelSelection", () => ({
  resolveLlmModel: vi.fn().mockResolvedValue("test-model"),
}));

vi.mock("@server/services/writing-style", () => ({
  getWritingStyle: vi.fn().mockResolvedValue({
    tone: "professional",
    formality: "neutral",
    constraints: "",
    doNotUse: "",
    languageMode: "manual",
    manualLanguage: "english",
    summaryMaxWords: null,
    maxKeywordsPerSkill: null,
  }),
  stripLanguageDirectivesFromConstraints: (s: string) => s,
}));

const SAMPLE_CONTENT = {
  basics: { name: "Ada Lovelace" },
  experience: [{ company: "Analytical", bullets: ["Wrote algorithms."] }],
};

beforeEach(() => {
  callJsonMock.mockReset();
});

describe("llmAdjustContent", () => {
  it("threads inputs into the prompt and returns the LLM result", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        tailoredContent: { ...SAMPLE_CONTENT, summary: "Tailored." },
        matched: ["algorithms", "python"],
        skipped: ["kubernetes"],
      },
    });

    const result = await llmAdjustContent({
      personalBrief: "I'm Ada — I write algorithms in Python.",
      jobDescription: "Hiring a Python engineer who can write algorithms.",
      currentContent: SAMPLE_CONTENT,
    });

    expect(result).toEqual({
      success: true,
      tailoredContent: { ...SAMPLE_CONTENT, summary: "Tailored." },
      matched: ["algorithms", "python"],
      skipped: ["kubernetes"],
    });

    expect(loadPrompt).toHaveBeenCalledWith(
      "cv-adjust",
      expect.objectContaining({
        personalBrief: "I'm Ada — I write algorithms in Python.",
        jobDescription:
          "Hiring a Python engineer who can write algorithms.",
        contentJson: expect.stringContaining("Analytical"),
        outputLanguage: "English",
        tone: "professional",
        formality: "neutral",
      }),
    );
  });

  it("substitutes placeholders for empty brief and JD", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: { tailoredContent: SAMPLE_CONTENT, matched: [], skipped: [] },
    });

    await llmAdjustContent({
      personalBrief: "",
      jobDescription: "",
      currentContent: SAMPLE_CONTENT,
    });

    expect(loadPrompt).toHaveBeenCalledWith(
      "cv-adjust",
      expect.objectContaining({
        personalBrief: "(empty — no candidate brief on file)",
        jobDescription: "(empty)",
      }),
    );
  });

  it("returns failure when the LLM call fails", async () => {
    callJsonMock.mockResolvedValue({ success: false, error: "rate limited" });

    const result = await llmAdjustContent({
      personalBrief: "x",
      jobDescription: "y",
      currentContent: SAMPLE_CONTENT,
    });

    expect(result).toEqual({
      success: false,
      error: "LLM call failed: rate limited",
    });
  });

  it("returns failure when tailoredContent is not a JSON object", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: { tailoredContent: ["not", "an", "object"], matched: [], skipped: [] },
    });

    const result = await llmAdjustContent({
      personalBrief: "x",
      jobDescription: "y",
      currentContent: SAMPLE_CONTENT,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not a JSON object/);
    }
  });

  it("coerces non-string entries out of matched/skipped arrays", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        tailoredContent: SAMPLE_CONTENT,
        matched: ["python", 42, "rust"],
        skipped: null,
      },
    });

    const result = await llmAdjustContent({
      personalBrief: "x",
      jobDescription: "y",
      currentContent: SAMPLE_CONTENT,
    });

    expect(result).toMatchObject({
      success: true,
      matched: ["python", "rust"],
      skipped: [],
    });
  });
});
