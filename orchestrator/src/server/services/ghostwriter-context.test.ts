// @vitest-environment node
import { createJob } from "@shared/testing/factories";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getJobById: vi.fn(),
  getActiveCvDocument: vi.fn(),
  getActiveCoverLetterDocument: vi.fn(),
  loadPrompt: vi.fn(),
  getWritingStyle: vi.fn(),
  getEffectiveSettings: vi.fn(),
  getCvFormatNote: vi.fn(async (format: string) => `format-note:${format}`),
}));

vi.mock("@infra/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../repositories/jobs", () => ({
  getJobById: mocks.getJobById,
}));

vi.mock("./cv-active", () => ({
  getActiveCvDocument: mocks.getActiveCvDocument,
}));

vi.mock("./cover-letter/active", () => ({
  getActiveCoverLetterDocument: mocks.getActiveCoverLetterDocument,
}));

vi.mock("./prompts", () => ({
  loadPrompt: mocks.loadPrompt,
}));

vi.mock("./settings", () => ({
  getEffectiveSettings: mocks.getEffectiveSettings,
}));

vi.mock("./cv/cv-format-note", () => ({
  getCvFormatNote: mocks.getCvFormatNote,
}));

vi.mock("./writing-style", () => ({
  getWritingStyle: mocks.getWritingStyle,
  stripLanguageDirectivesFromConstraints: (value: string) => value,
}));

import { buildJobChatPromptContext } from "./ghostwriter-context";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getJobById.mockResolvedValue(
    createJob({ id: "job-1", title: "Engineer", employer: "Acme" }),
  );
  mocks.getActiveCvDocument.mockResolvedValue(null);
  mocks.getActiveCoverLetterDocument.mockResolvedValue(null);
  mocks.getWritingStyle.mockResolvedValue({
    tone: "professional",
    formality: "neutral",
    constraints: "",
    doNotUse: "",
    languageMode: "manual",
    manualLanguage: "english",
    summaryMaxWords: null,
    maxKeywordsPerSkill: null,
  });
  mocks.getEffectiveSettings.mockResolvedValue({ cvSourceFormat: null });
  mocks.getCvFormatNote.mockImplementation(
    async (format: string) => `format-note:${format}`,
  );
  mocks.loadPrompt.mockResolvedValue({
    name: "ghostwriter-system",
    description: "",
    system: "stub-system",
    user: "",
    modelHints: {},
  });
});

describe("buildJobChatPromptContext", () => {
  it("passes the LaTeX format note when the profile's CV format is unset", async () => {
    await buildJobChatPromptContext("job-1");

    expect(mocks.getCvFormatNote).toHaveBeenCalledWith("latex");
    expect(mocks.loadPrompt).toHaveBeenCalledWith(
      "ghostwriter-system",
      expect.objectContaining({ cvFormatNote: "format-note:latex" }),
    );
  });

  it("passes the Word format note on a docx profile", async () => {
    mocks.getEffectiveSettings.mockResolvedValue({ cvSourceFormat: "docx" });

    await buildJobChatPromptContext("job-1");

    expect(mocks.getCvFormatNote).toHaveBeenCalledWith("docx");
    expect(mocks.loadPrompt).toHaveBeenCalledWith(
      "ghostwriter-system",
      expect.objectContaining({ cvFormatNote: "format-note:docx" }),
    );
  });

  it("throws when the job does not exist", async () => {
    mocks.getJobById.mockResolvedValue(null);

    await expect(buildJobChatPromptContext("missing")).rejects.toThrow(
      /Job not found/,
    );
  });
});
