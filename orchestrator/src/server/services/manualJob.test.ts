// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callJsonMock = vi.fn();

vi.mock("./llm/service", () => ({
  LlmService: class {
    callJson = callJsonMock;
  },
}));

vi.mock("./modelSelection", () => ({
  resolveLlmModel: vi.fn().mockResolvedValue("test-model"),
}));

vi.mock("./prompts", () => ({
  loadPrompt: vi.fn().mockResolvedValue({
    name: "job-fetch-from-url",
    description: "",
    system: "stub-system",
    user: "stub-user",
    modelHints: {},
  }),
}));

import { inferManualJobDetails } from "./manualJob";

describe("inferManualJobDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a warning when LlmService reports a missing API key", async () => {
    callJsonMock.mockResolvedValue({
      success: false,
      error: "LLM API key not set",
    });

    const result = await inferManualJobDetails("JD text");

    expect(result.job).toEqual({});
    expect(result.warning).toContain("LLM API key not set");
  });

  it("returns a warning when LlmService reports a generic failure", async () => {
    callJsonMock.mockResolvedValue({
      success: false,
      error: "Upstream 500",
    });

    const result = await inferManualJobDetails("JD text");

    expect(result.job).toEqual({});
    expect(result.warning).toContain("AI inference failed");
  });

  it("normalizes a successful response into a manual job draft", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        title: "Backend Engineer",
        employer: "Acme",
        location: "",
        salary: " 100k ",
        deadline: "",
        jobUrl: "",
        applicationLink: "",
        jobType: "",
        jobLevel: "",
        jobFunction: "",
        disciplines: "",
        degreeRequired: "",
        starting: "",
        jobDescription: "",
      },
    });

    const result = await inferManualJobDetails("JD text");

    expect(result.warning).toBeUndefined();
    expect(result.job).toEqual({
      title: "Backend Engineer",
      employer: "Acme",
      salary: "100k",
    });
  });
});
