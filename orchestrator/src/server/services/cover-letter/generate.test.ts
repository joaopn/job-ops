// @vitest-environment node
import { createCoverLetterDocument, createJob } from "@shared/testing/factories";
import type { CvDocument } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const buildCv = (overrides: Partial<CvDocument> = {}): CvDocument => ({
  id: "cv-1",
  name: "CV",
  flattenedTex: "",
  fields: [],
  personalBrief: "",
  templatedTex: "",
  defaultFieldValues: {},
  lastCompileStderr: null,
  compileAttempts: 0,
  extractionPrompt: "",
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

const callJsonMock = vi.fn();

vi.mock("@server/services/llm/service", () => ({
  LlmService: class {
    callJson = callJsonMock;
  },
}));

vi.mock("@server/services/prompts", () => ({
  loadPrompt: vi.fn().mockResolvedValue({
    name: "cover-letter-generate",
    description: "",
    system: "stub-system",
    user: "stub-user-with-bodyFieldId",
    modelHints: {},
  }),
}));

vi.mock("@server/services/modelSelection", () => ({
  resolveLlmModel: vi.fn().mockResolvedValue("test-model"),
}));

vi.mock("@server/services/writing-style", () => ({
  getWritingStyle: vi.fn().mockResolvedValue({
    languageMode: "auto",
    manualLanguage: "english",
    tone: "professional",
    formality: "neutral",
    constraints: "",
    doNotUse: "",
  }),
  stripLanguageDirectivesFromConstraints: (s: string) => s,
}));

const getJobByIdMock = vi.fn();
const updateJobMock = vi.fn();
vi.mock("@server/repositories/jobs", () => ({
  getJobById: (...args: unknown[]) => getJobByIdMock(...args),
  updateJob: (...args: unknown[]) => updateJobMock(...args),
}));

const getActiveCvDocumentMock = vi.fn();
vi.mock("@server/services/cv-active", () => ({
  getActiveCvDocument: (...args: unknown[]) =>
    getActiveCvDocumentMock(...args),
}));

const getActiveCoverLetterDocumentMock = vi.fn();
vi.mock("./active", () => ({
  getActiveCoverLetterDocument: (...args: unknown[]) =>
    getActiveCoverLetterDocumentMock(...args),
}));

vi.mock("@infra/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { generateCoverLetter } from "./generate";

const BODY_FIELD_ID = "body.text";

beforeEach(() => {
  callJsonMock.mockReset();
  getJobByIdMock.mockReset();
  updateJobMock.mockReset();
  getActiveCvDocumentMock.mockReset();
  getActiveCoverLetterDocumentMock.mockReset();
});

const llmReply = (patches: Array<{ fieldId: string; newValue: string }>) => ({
  success: true,
  data: { patchesJson: JSON.stringify(patches) },
});

describe("generateCoverLetter", () => {
  it("merges all patched fields and pins the cover-letter doc", async () => {
    const job = createJob({
      id: "job-1",
      title: "Lead Engineer",
      employer: "Acme",
      coverLetterFieldOverrides: { "letter.closing": "Sincerely," },
      coverLetterDocumentId: null,
      jobDescription: "JD text",
    });
    const cv = buildCv({ personalBrief: "I'm Ada — engineer." });
    const cl = createCoverLetterDocument({
      id: "cl-1",
      fields: [
        { id: "letter.opening", role: "other", value: "Dear Hiring Team," },
        { id: BODY_FIELD_ID, role: "body", value: "default body" },
      ],
    });
    getJobByIdMock
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce({
        ...job,
        coverLetterDocumentId: "cl-1",
      });
    getActiveCvDocumentMock.mockResolvedValue(cv);
    getActiveCoverLetterDocumentMock.mockResolvedValue(cl);
    callJsonMock.mockResolvedValue(
      llmReply([
        { fieldId: "letter.opening", newValue: "Dear Acme Hiring Team," },
        { fieldId: BODY_FIELD_ID, newValue: "Body paragraphs here." },
      ]),
    );

    const result = await generateCoverLetter({ jobId: "job-1" });

    expect(result.success).toBe(true);
    expect(updateJobMock).toHaveBeenCalledWith("job-1", {
      coverLetterDocumentId: "cl-1",
      coverLetterFieldOverrides: {
        "letter.closing": "Sincerely,",
        "letter.opening": "Dear Acme Hiring Team,",
        [BODY_FIELD_ID]: "Body paragraphs here.",
      },
    });
  });

  it("drops patches targeting unknown field ids", async () => {
    const job = createJob({ id: "job-1", coverLetterDocumentId: null });
    const cl = createCoverLetterDocument({
      id: "cl-1",
      fields: [{ id: BODY_FIELD_ID, role: "body", value: "default" }],
    });
    getJobByIdMock
      .mockResolvedValueOnce(job)
      .mockResolvedValueOnce({ ...job, coverLetterDocumentId: "cl-1" });
    getActiveCvDocumentMock.mockResolvedValue(buildCv());
    getActiveCoverLetterDocumentMock.mockResolvedValue(cl);
    callJsonMock.mockResolvedValue(
      llmReply([
        { fieldId: "ghost.id", newValue: "should be dropped" },
        { fieldId: BODY_FIELD_ID, newValue: "real body" },
      ]),
    );

    const result = await generateCoverLetter({ jobId: "job-1" });
    expect(result.success).toBe(true);
    expect(updateJobMock).toHaveBeenCalledWith("job-1", {
      coverLetterDocumentId: "cl-1",
      coverLetterFieldOverrides: { [BODY_FIELD_ID]: "real body" },
    });
  });

  it("rejects when no patch targets the body field", async () => {
    const job = createJob({ id: "job-1", coverLetterDocumentId: null });
    const cl = createCoverLetterDocument({
      id: "cl-1",
      fields: [
        { id: "letter.opening", role: "other", value: "Dear Hiring Team," },
        { id: BODY_FIELD_ID, role: "body", value: "default" },
      ],
    });
    getJobByIdMock.mockResolvedValueOnce(job);
    getActiveCvDocumentMock.mockResolvedValue(buildCv());
    getActiveCoverLetterDocumentMock.mockResolvedValue(cl);
    callJsonMock.mockResolvedValue(
      llmReply([
        { fieldId: "letter.opening", newValue: "Dear Acme Hiring Team," },
      ]),
    );

    const result = await generateCoverLetter({ jobId: "job-1" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/no patch for the body field/i);
  });

  it("rejects forbidden LaTeX patterns in patch values", async () => {
    const job = createJob({ id: "job-1", coverLetterDocumentId: null });
    const cl = createCoverLetterDocument({
      id: "cl-1",
      fields: [{ id: BODY_FIELD_ID, role: "body", value: "default" }],
    });
    getJobByIdMock.mockResolvedValueOnce(job);
    getActiveCvDocumentMock.mockResolvedValue(buildCv());
    getActiveCoverLetterDocumentMock.mockResolvedValue(cl);
    callJsonMock.mockResolvedValue(
      llmReply([
        {
          fieldId: BODY_FIELD_ID,
          newValue: "evil \\write18{ls /} body",
        },
      ]),
    );

    const result = await generateCoverLetter({ jobId: "job-1" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/no patch for the body field/i);
  });

  it("rejects when no cover-letter doc has been uploaded", async () => {
    getJobByIdMock.mockResolvedValueOnce(createJob({ id: "job-1" }));
    getActiveCoverLetterDocumentMock.mockResolvedValue(null);

    const result = await generateCoverLetter({ jobId: "job-1" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/no cover-letter template/i);
  });

  it("rejects when the cover-letter doc has no body field", async () => {
    getJobByIdMock.mockResolvedValueOnce(createJob({ id: "job-1" }));
    getActiveCoverLetterDocumentMock.mockResolvedValue(
      createCoverLetterDocument({
        fields: [
          { id: "recipient.name", role: "name", value: "Acme Hiring Team" },
        ],
      }),
    );

    const result = await generateCoverLetter({ jobId: "job-1" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/no body field/i);
  });

  it("rejects malformed patchesJson", async () => {
    const job = createJob({ id: "job-1", coverLetterDocumentId: null });
    const cl = createCoverLetterDocument({
      id: "cl-1",
      fields: [{ id: BODY_FIELD_ID, role: "body", value: "default" }],
    });
    getJobByIdMock.mockResolvedValueOnce(job);
    getActiveCvDocumentMock.mockResolvedValue(buildCv());
    getActiveCoverLetterDocumentMock.mockResolvedValue(cl);
    callJsonMock.mockResolvedValue({
      success: true,
      data: { patchesJson: "{not valid json" },
    });

    const result = await generateCoverLetter({ jobId: "job-1" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/malformed patches json/i);
  });

  it("propagates LLM service failures", async () => {
    getJobByIdMock.mockResolvedValueOnce(createJob({ id: "job-1" }));
    getActiveCvDocumentMock.mockResolvedValue(
      buildCv({ personalBrief: "x" }),
    );
    getActiveCoverLetterDocumentMock.mockResolvedValue(
      createCoverLetterDocument({
        fields: [{ id: BODY_FIELD_ID, role: "body", value: "default" }],
      }),
    );
    callJsonMock.mockResolvedValue({
      success: false,
      error: "rate limited",
    });

    const result = await generateCoverLetter({ jobId: "job-1" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatch(/LLM call failed.*rate limited/);
  });
});
