// @vitest-environment node
import { loadPrompt } from "@server/services/prompts";
import type { CvField } from "@shared/types";
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

const SAMPLE_FIELDS: CvField[] = [
  { id: "basics.name", role: "name", value: "Ada Lovelace" },
  { id: "experience.0.company", role: "company", value: "Analytical" },
  {
    id: "experience.0.bullet.0",
    role: "bullet",
    value: "Wrote algorithms.",
  },
];

beforeEach(() => {
  callJsonMock.mockReset();
});

describe("llmAdjustContent", () => {
  it("threads inputs into the prompt and returns parsed patches", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        patchesJson: JSON.stringify([
          {
            fieldId: "experience.0.bullet.0",
            newValue: "Wrote algorithms in Python.",
          },
        ]),
        matched: ["algorithms", "python"],
        skipped: ["kubernetes"],
      },
    });

    const result = await llmAdjustContent({
      personalBrief: "I'm Ada — I write algorithms in Python.",
      jobDescription: "Hiring a Python engineer who can write algorithms.",
      currentFields: SAMPLE_FIELDS,
      currentOverrides: {},
    });

    expect(result).toEqual({
      success: true,
      patches: [
        {
          fieldId: "experience.0.bullet.0",
          newValue: "Wrote algorithms in Python.",
        },
      ],
      matched: ["algorithms", "python"],
      skipped: ["kubernetes"],
    });

    expect(loadPrompt).toHaveBeenCalledWith(
      "cv-adjust",
      expect.objectContaining({
        personalBrief: "I'm Ada — I write algorithms in Python.",
        jobDescription:
          "Hiring a Python engineer who can write algorithms.",
        fieldsJson: expect.stringContaining("Analytical"),
        outputLanguage: "English",
        tone: "professional",
        formality: "neutral",
      }),
    );
  });

  it("uses overrides as the effective field value in the prompt", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        patchesJson: JSON.stringify([]),
        matched: [],
        skipped: [],
      },
    });

    await llmAdjustContent({
      personalBrief: "x",
      jobDescription: "y",
      currentFields: SAMPLE_FIELDS,
      currentOverrides: { "basics.name": "Ada L." },
    });

    const calls = (loadPrompt as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    const call = calls[calls.length - 1][1];
    expect(call.fieldsJson).toContain("Ada L.");
    expect(call.fieldsJson).not.toContain("Ada Lovelace");
  });

  it("substitutes placeholders for empty brief and JD", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        patchesJson: JSON.stringify([]),
        matched: [],
        skipped: [],
      },
    });

    await llmAdjustContent({
      personalBrief: "",
      jobDescription: "",
      currentFields: SAMPLE_FIELDS,
      currentOverrides: {},
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
      currentFields: SAMPLE_FIELDS,
      currentOverrides: {},
    });

    expect(result).toEqual({
      success: false,
      error: "LLM call failed: rate limited",
    });
  });

  it("returns failure when patchesJson is not a JSON array", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        patchesJson: JSON.stringify({ fieldId: "x", newValue: "y" }),
        matched: [],
        skipped: [],
      },
    });

    const result = await llmAdjustContent({
      personalBrief: "x",
      jobDescription: "y",
      currentFields: SAMPLE_FIELDS,
      currentOverrides: {},
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/not a JSON array/);
    }
  });

  it("drops patches with unknown fieldIds, non-string newValue, or forbidden patterns", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        patchesJson: JSON.stringify([
          { fieldId: "unknown.id", newValue: "ignored" },
          { fieldId: "basics.name", newValue: 42 },
          { fieldId: "basics.name", newValue: "evil \\write18 stuff" },
          { fieldId: "basics.name", newValue: "Ada (verified)" },
        ]),
        matched: ["python", 42, "rust"],
        skipped: null,
      },
    });

    const result = await llmAdjustContent({
      personalBrief: "x",
      jobDescription: "y",
      currentFields: SAMPLE_FIELDS,
      currentOverrides: {},
    });

    expect(result).toMatchObject({
      success: true,
      patches: [{ fieldId: "basics.name", newValue: "Ada (verified)" }],
      matched: ["python", "rust"],
      skipped: [],
    });
  });
});
