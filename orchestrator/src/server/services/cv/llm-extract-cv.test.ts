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

const SOURCE_TEX = `\\name{Ada Lovelace}
\\position{Engineer}
\\experience{Engineer}{2020 -- 2024}
`;

const SAMPLE_FIELDS = [
  { id: "basics.name", role: "name", value: "Ada Lovelace" },
  { id: "basics.position", role: "title", value: "Engineer" },
  { id: "experience.0.dates", role: "date", value: "2020 -- 2024" },
];

beforeEach(() => {
  callJsonMock.mockReset();
});

describe("extractCv", () => {
  it("returns the parsed result on success", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        fieldsJson: JSON.stringify(SAMPLE_FIELDS),
        personalBrief: "I'm a mathematician.",
      },
    });

    const result = await extractCv({
      flattenedTex: SOURCE_TEX,
      assetReferences: [],
    });

    expect(result.fields).toEqual(SAMPLE_FIELDS);
    expect(result.personalBrief).toBe("I'm a mathematician.");
  });

  it("throws CvExtractError when the LLM call fails", async () => {
    callJsonMock.mockResolvedValue({
      success: false,
      error: "rate limited",
    });

    await expect(
      extractCv({ flattenedTex: SOURCE_TEX, assetReferences: [] }),
    ).rejects.toMatchObject({ name: "CvExtractError", code: "LLM_FAILED" });
  });

  it("throws INVALID_FIELDS_JSON when fieldsJson is unparseable", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        fieldsJson: "not-json",
        personalBrief: "x",
      },
    });

    await expect(
      extractCv({ flattenedTex: SOURCE_TEX, assetReferences: [] }),
    ).rejects.toMatchObject({ code: "INVALID_FIELDS_JSON" });
  });

  it("throws EMPTY_FIELDS when the array is empty", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        fieldsJson: "[]",
        personalBrief: "x",
      },
    });

    await expect(
      extractCv({ flattenedTex: SOURCE_TEX, assetReferences: [] }),
    ).rejects.toMatchObject({ code: "EMPTY_FIELDS" });
  });

  it("rejects unknown roles", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        fieldsJson: JSON.stringify([
          { id: "x", role: "not-a-role", value: "Ada Lovelace" },
        ]),
        personalBrief: "x",
      },
    });

    await expect(
      extractCv({ flattenedTex: SOURCE_TEX, assetReferences: [] }),
    ).rejects.toMatchObject({ code: "INVALID_FIELD_ROLE" });
  });

  it("rejects duplicate field ids", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        fieldsJson: JSON.stringify([
          { id: "a", role: "name", value: "Ada Lovelace" },
          { id: "a", role: "title", value: "Engineer" },
        ]),
        personalBrief: "x",
      },
    });

    await expect(
      extractCv({ flattenedTex: SOURCE_TEX, assetReferences: [] }),
    ).rejects.toMatchObject({ code: "DUPLICATE_FIELD_ID" });
  });

  it("rejects fields whose value cannot be located in the source", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        fieldsJson: JSON.stringify([
          { id: "a", role: "name", value: "Ada Lovelace" },
          { id: "b", role: "title", value: "DOES_NOT_EXIST_IN_SOURCE" },
        ]),
        personalBrief: "x",
      },
    });

    await expect(
      extractCv({ flattenedTex: SOURCE_TEX, assetReferences: [] }),
    ).rejects.toMatchObject({ code: "FIELD_NOT_FOUND" });
  });

  it("rejects out-of-document-order fields", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        // basics.position appears in source AFTER basics.name. Listing
        // them in reverse order moves the cursor past basics.name first.
        fieldsJson: JSON.stringify([
          { id: "basics.position", role: "title", value: "Engineer" },
          { id: "basics.name", role: "name", value: "Ada Lovelace" },
        ]),
        personalBrief: "x",
      },
    });

    await expect(
      extractCv({ flattenedTex: SOURCE_TEX, assetReferences: [] }),
    ).rejects.toMatchObject({ code: "FIELD_NOT_FOUND" });
  });

  it("formats the asset list as a newline-separated string when populated", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        fieldsJson: JSON.stringify(SAMPLE_FIELDS),
        personalBrief: "x",
      },
    });

    await extractCv({
      flattenedTex: SOURCE_TEX,
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
        fieldsJson: JSON.stringify(SAMPLE_FIELDS),
        personalBrief: "x",
      },
    });

    await extractCv({ flattenedTex: SOURCE_TEX, assetReferences: [] });

    expect(loadPrompt).toHaveBeenCalledWith(
      "cv-extract",
      expect.objectContaining({ assetReferencesList: "(none)" }),
    );
  });
});
