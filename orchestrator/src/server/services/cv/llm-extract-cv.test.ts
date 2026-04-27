// @vitest-environment node
import { loadPrompt } from "@server/services/prompts";
import type { CvContent } from "@shared/types";
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

const VALID_CONTENT: CvContent = {
  basics: { name: "Ada", profiles: [] },
  experience: [],
  education: [],
  projects: [],
  skillGroups: [],
  custom: [],
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
        content: VALID_CONTENT,
      },
    });

    const result = await extractCv({
      flattenedTex: "\\documentclass{article}",
      assetReferences: [],
    });

    expect(result.template).toBe("\\documentclass{article}");
    expect(result.content.basics.name).toBe("Ada");
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
      data: { template: "   ", content: VALID_CONTENT },
    });

    await expect(
      extractCv({ flattenedTex: "x", assetReferences: [] }),
    ).rejects.toMatchObject({ code: "EMPTY_TEMPLATE" });
  });

  it("throws when the content fails CvContent validation", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        template: "\\documentclass{article}",
        content: { basics: {}, experience: [] },
      },
    });

    await expect(
      extractCv({ flattenedTex: "x", assetReferences: [] }),
    ).rejects.toMatchObject({ code: "INVALID_CONTENT" });
  });

  it("formats the asset list as a newline-separated string when populated", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        template: "\\documentclass{article}",
        content: VALID_CONTENT,
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
        content: VALID_CONTENT,
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
