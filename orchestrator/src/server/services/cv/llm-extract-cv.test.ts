// @vitest-environment node
import { loadPrompt } from "@server/services/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CvExtractError, extractCv } from "./llm-extract-cv";

const callJsonMock = vi.fn();

vi.mock("@server/services/llm/service", () => ({
  LlmService: class {
    callJson = callJsonMock;
  },
}));

vi.mock("@server/services/prompts", () => ({
  loadPrompt: vi.fn().mockResolvedValue({
    name: "cv-extract",
    description: "",
    system: "stub-system",
    user: "stub-user",
    modelHints: {},
  }),
}));

vi.mock("@server/services/modelSelection", () => ({
  resolveLlmModel: vi.fn().mockResolvedValue("test-model"),
}));

const SAMPLE_CONTENT = {
  basics: { name: "Ada", profiles: [] },
  experience: [],
};

beforeEach(() => {
  callJsonMock.mockReset();
});

describe("extractCv", () => {
  it("returns the parsed result on success", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        template: "\\documentclass{article}",
        content: SAMPLE_CONTENT,
        personalBrief: "I'm a mathematician.",
      },
    });

    const result = await extractCv({
      flattenedTex: "\\documentclass{article}",
      assetReferences: [],
    });

    expect(result.template).toBe("\\documentclass{article}");
    expect(result.content).toEqual(SAMPLE_CONTENT);
    expect(result.personalBrief).toBe("I'm a mathematician.");
  });

  it("accepts a content shape that doesn't match the legacy CvContent layout", async () => {
    const exoticContent = {
      profile: { fullName: "Ada" },
      publications: [{ title: "Notes on the Engine" }],
    };
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        template: "\\documentclass{article}",
        content: exoticContent,
        personalBrief: "I publish things.",
      },
    });

    const result = await extractCv({ flattenedTex: "x", assetReferences: [] });
    expect(result.content).toEqual(exoticContent);
    expect(result.personalBrief).toBe("I publish things.");
  });

  it("throws CvExtractError when the LLM call fails", async () => {
    callJsonMock.mockResolvedValue({
      success: false,
      error: "rate limited",
    });

    await expect(
      extractCv({ flattenedTex: "x", assetReferences: [] }),
    ).rejects.toMatchObject({ name: "CvExtractError", code: "LLM_FAILED" });
  });

  it("throws when the template is empty", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        template: "   ",
        content: SAMPLE_CONTENT,
        personalBrief: "",
      },
    });

    await expect(
      extractCv({ flattenedTex: "x", assetReferences: [] }),
    ).rejects.toMatchObject({ code: "EMPTY_TEMPLATE" });
  });

  it("throws INVALID_CONTENT when content is not a JSON object", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        template: "\\documentclass{article}",
        content: ["not", "an", "object"],
        personalBrief: "",
      },
    });

    await expect(
      extractCv({ flattenedTex: "x", assetReferences: [] }),
    ).rejects.toMatchObject({ code: "INVALID_CONTENT" });
  });

  it("throws INVALID_BRIEF when personalBrief is missing", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        template: "\\documentclass{article}",
        content: SAMPLE_CONTENT,
        personalBrief: 42,
      },
    });

    await expect(
      extractCv({ flattenedTex: "x", assetReferences: [] }),
    ).rejects.toMatchObject({ code: "INVALID_BRIEF" });
  });

  it("formats the asset list as a newline-separated string when populated", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        template: "\\documentclass{article}",
        content: SAMPLE_CONTENT,
        personalBrief: "",
      },
    });

    await extractCv({
      flattenedTex: "x",
      assetReferences: ["photo.jpg", "logo.png"],
    });

    expect(loadPrompt).toHaveBeenCalledWith(
      "cv-extract",
      expect.objectContaining({ assetReferencesList: "photo.jpg\nlogo.png" }),
    );
  });

  it("uses '(none)' when no assets were detected", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        template: "\\documentclass{article}",
        content: SAMPLE_CONTENT,
        personalBrief: "",
      },
    });

    await extractCv({ flattenedTex: "x", assetReferences: [] });

    expect(loadPrompt).toHaveBeenCalledWith(
      "cv-extract",
      expect.objectContaining({ assetReferencesList: "(none)" }),
    );
  });

  it("exports CvExtractError as a named class", () => {
    expect(new CvExtractError("x", "Y").code).toBe("Y");
  });
});
