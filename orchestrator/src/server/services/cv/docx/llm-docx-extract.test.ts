// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocxSegment } from "./extract-segments";
import {
  buildDocxPreviousAttemptBlock,
  llmDocxExtract,
} from "./llm-docx-extract";

const mocks = vi.hoisted(() => ({
  callJson: vi.fn(),
  loadPrompt: vi.fn(),
}));

vi.mock("@server/db/index", () => ({ db: {}, schema: {}, closeDb: vi.fn() }));

vi.mock("@server/services/llm/service", () => ({
  LlmService: class {
    callJson = mocks.callJson;
  },
}));

vi.mock("@server/services/modelSelection", () => ({
  resolveLlmModel: vi.fn().mockResolvedValue("test-model"),
}));

vi.mock("@server/services/prompts", () => ({
  loadPrompt: mocks.loadPrompt,
}));

const SEGMENTS: DocxSegment[] = [
  { segmentId: 0, partName: "word/document.xml", text: "Jane Q. Applicant" },
  {
    segmentId: 1,
    partName: "word/document.xml",
    text: "Led migration of the rendering fleet.",
  },
];

function llmReturns(fields: unknown, personalBrief: unknown = "brief"): void {
  mocks.callJson.mockResolvedValue({
    success: true,
    data: {
      fieldsJson: typeof fields === "string" ? fields : JSON.stringify(fields),
      personalBrief,
    },
  });
}

const VALID_FIELD = {
  id: "experience.0.bullet.0",
  role: "bullet",
  value: "Led migration of the rendering fleet.",
  segmentId: 1,
};

describe("llmDocxExtract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadPrompt.mockResolvedValue({
      name: "cv-docx-extract",
      description: "",
      system: "stub-system",
      user: "stub-user",
      modelHints: {},
    });
  });

  it("returns fields and brief on a valid response", async () => {
    llmReturns([VALID_FIELD]);
    const result = await llmDocxExtract({ segments: SEGMENTS });
    expect(result.fields).toEqual([VALID_FIELD]);
    expect(result.personalBrief).toBe("brief");
  });

  it("passes numbered segments to the prompt", async () => {
    llmReturns([VALID_FIELD]);
    await llmDocxExtract({ segments: SEGMENTS });
    const vars = mocks.loadPrompt.mock.calls[0][1];
    expect(vars.segmentsList).toBe(
      "[0] (word/document.xml) Jane Q. Applicant\n[1] (word/document.xml) Led migration of the rendering fleet.",
    );
    expect(vars.previousAttemptBlock).toBe("");
  });

  it("uses the extractionPrompt override as the system message", async () => {
    llmReturns([VALID_FIELD]);
    await llmDocxExtract({
      segments: SEGMENTS,
      extractionPrompt: "custom system",
    });
    const { messages } = mocks.callJson.mock.calls[0][0];
    expect(messages[0]).toEqual({ role: "system", content: "custom system" });
    expect(messages[1]).toEqual({ role: "user", content: "stub-user" });
  });

  it("renders the previous attempt into the prompt variables", async () => {
    llmReturns([VALID_FIELD]);
    await llmDocxExtract({
      segments: SEGMENTS,
      previousAttempt: {
        fields: [VALID_FIELD],
        failureKind: "splice",
        detail: "span not found",
      },
    });
    const vars = mocks.loadPrompt.mock.calls[0][1];
    expect(vars.previousAttemptBlock).toContain("PREVIOUS ATTEMPT");
    expect(vars.previousAttemptBlock).toContain(
      "could not be located verbatim",
    );
    expect(vars.previousAttemptBlock).toContain("span not found");
  });

  it("throws LLM_FAILED when the call fails", async () => {
    mocks.callJson.mockResolvedValue({ success: false, error: "boom" });
    await expect(llmDocxExtract({ segments: SEGMENTS })).rejects.toMatchObject({
      name: "DocxExtractError",
      code: "LLM_FAILED",
    });
  });

  const rejectCases: Array<{
    label: string;
    fields: unknown;
    brief?: unknown;
    code: string;
  }> = [
    {
      label: "unparseable fieldsJson",
      fields: "not json",
      code: "INVALID_FIELDS_JSON",
    },
    { label: "empty fields array", fields: [], code: "EMPTY_FIELDS" },
    {
      label: "non-object field entry",
      fields: ["nope"],
      code: "INVALID_FIELD_SHAPE",
    },
    {
      label: "missing id",
      fields: [{ ...VALID_FIELD, id: "" }],
      code: "INVALID_FIELD_ID",
    },
    {
      label: "duplicate id",
      fields: [VALID_FIELD, { ...VALID_FIELD, value: "fleet" }],
      code: "DUPLICATE_FIELD_ID",
    },
    {
      label: "unknown role",
      fields: [{ ...VALID_FIELD, role: "wizard" }],
      code: "INVALID_FIELD_ROLE",
    },
    {
      label: "empty value",
      fields: [{ ...VALID_FIELD, value: "" }],
      code: "INVALID_FIELD_VALUE",
    },
    {
      label: "segmentId out of range",
      fields: [{ ...VALID_FIELD, segmentId: 2 }],
      code: "INVALID_SEGMENT_ID",
    },
    {
      label: "non-integer segmentId",
      fields: [{ ...VALID_FIELD, segmentId: 0.5 }],
      code: "INVALID_SEGMENT_ID",
    },
    {
      label: "non-string brief",
      fields: [VALID_FIELD],
      brief: 42,
      code: "INVALID_BRIEF",
    },
  ];

  for (const testCase of rejectCases) {
    it(`rejects ${testCase.label} with ${testCase.code}`, async () => {
      llmReturns(testCase.fields, testCase.brief ?? "brief");
      await expect(
        llmDocxExtract({ segments: SEGMENTS }),
      ).rejects.toMatchObject({
        name: "DocxExtractError",
        code: testCase.code,
      });
    });
  }
});

describe("buildDocxPreviousAttemptBlock", () => {
  it("returns an empty string without a previous attempt", () => {
    expect(buildDocxPreviousAttemptBlock(undefined)).toBe("");
  });

  it("truncates an oversized failure detail", () => {
    const block = buildDocxPreviousAttemptBlock({
      fields: [VALID_FIELD],
      failureKind: "convert",
      detail: "x".repeat(5000),
    });
    expect(block).toContain("…(truncated)");
    expect(block).toContain("failed to convert to PDF");
  });
});
