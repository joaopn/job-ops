// @vitest-environment node
import type {
  CvDocument,
  CvField,
  CvFieldOverrides,
  Job,
  JobChatMessage,
  JobChatProposedBriefEdit,
  JobChatProposedCvEdit,
} from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jobsRepo: {
    getJobById: vi.fn(),
    updateJob: vi.fn(),
  },
  cvRepo: {
    getCvDocumentById: vi.fn(),
    updateCvDocument: vi.fn(),
  },
  jobChatRepo: {
    getMessageById: vi.fn(),
    setMessageEditStatus: vi.fn(),
  },
  cvActive: {
    getActiveCvDocument: vi.fn(),
  },
  pdf: {
    generatePdf: vi.fn(),
  },
}));

vi.mock("@infra/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../repositories/jobs", () => ({
  getJobById: mocks.jobsRepo.getJobById,
  updateJob: mocks.jobsRepo.updateJob,
}));

vi.mock("../repositories/cv-documents", () => ({
  getCvDocumentById: mocks.cvRepo.getCvDocumentById,
  updateCvDocument: mocks.cvRepo.updateCvDocument,
}));

vi.mock("../repositories/ghostwriter", () => ({
  getMessageById: mocks.jobChatRepo.getMessageById,
  setMessageEditStatus: mocks.jobChatRepo.setMessageEditStatus,
}));

vi.mock("./cv-active", () => ({
  getActiveCvDocument: mocks.cvActive.getActiveCvDocument,
}));

vi.mock("./pdf", () => ({
  generatePdf: mocks.pdf.generatePdf,
}));

import { acceptEditForJob, rejectEditForJob } from "./job-edits";

const baseFields: CvField[] = [
  { id: "basics.name", role: "name", value: "Alice" },
  { id: "experience.0.bullet.0", role: "bullet", value: "Built foo" },
  { id: "experience.1.bullet.0", role: "bullet", value: "Shipped bar" },
];

const baseOverrides: CvFieldOverrides = {};

const baseJob: Job = {
  id: "job-1",
  cvDocumentId: "cv-1",
  tailoredFields: baseOverrides,
  pdfPath: "/data/pdfs/resume_job-1.pdf",
} as unknown as Job;

const baseCvDocument: CvDocument = {
  id: "cv-1",
  name: "alice.tex",
  flattenedTex: "...",
  fields: baseFields,
  personalBrief: "First paragraph.",
  createdAt: "2026-04-26T00:00:00Z",
  updatedAt: "2026-04-26T00:00:00Z",
};

function makeMessage(
  proposed: JobChatProposedCvEdit | JobChatProposedBriefEdit | null,
  overrides: Partial<JobChatMessage> = {},
): JobChatMessage {
  return {
    id: "msg-1",
    threadId: "thread-1",
    jobId: "job-1",
    role: "assistant",
    content: "Proposed edit",
    status: "complete",
    tokensIn: null,
    tokensOut: null,
    version: 1,
    replacesMessageId: null,
    parentMessageId: null,
    activeChildId: null,
    proposedEdit: proposed,
    editStatus: proposed ? "pending" : null,
    createdAt: "2026-04-26T00:00:00Z",
    updatedAt: "2026-04-26T00:00:00Z",
    ...overrides,
  };
}

describe("acceptEditForJob: cv-edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.jobsRepo.updateJob.mockResolvedValue(baseJob);
    mocks.jobsRepo.getJobById.mockResolvedValue(baseJob);
    mocks.cvRepo.getCvDocumentById.mockResolvedValue(baseCvDocument);
    mocks.pdf.generatePdf.mockResolvedValue({
      success: true,
      pdfPath: "/data/pdfs/resume_job-1.pdf",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges the patch into tailoredFields, re-renders, and accepts the message", async () => {
    const proposed: JobChatProposedCvEdit = {
      kind: "cv-edit",
      rationale: "Tighten phrasing",
      edits: [
        {
          fieldId: "experience.1.bullet.0",
          from: "Shipped bar",
          to: "Shipped bar end-to-end",
        },
      ],
    };
    const acceptedMessage = makeMessage(proposed, { editStatus: "accepted" });

    mocks.jobChatRepo.getMessageById.mockResolvedValue(makeMessage(proposed));
    mocks.jobChatRepo.setMessageEditStatus.mockResolvedValue(acceptedMessage);

    const result = await acceptEditForJob({
      jobId: "job-1",
      messageId: "msg-1",
    });

    expect(result.kind).toBe("cv-edit");
    const firstUpdate = mocks.jobsRepo.updateJob.mock.calls[0][1];
    expect(firstUpdate.tailoredFields).toEqual({
      "experience.1.bullet.0": "Shipped bar end-to-end",
    });
    expect(mocks.pdf.generatePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        cvDocumentId: "cv-1",
        overrides: { "experience.1.bullet.0": "Shipped bar end-to-end" },
      }),
    );
    expect(mocks.jobChatRepo.setMessageEditStatus).toHaveBeenCalledWith(
      "msg-1",
      "accepted",
    );
  });

  it("rolls back tailoredFields when PDF render fails", async () => {
    const proposed: JobChatProposedCvEdit = {
      kind: "cv-edit",
      rationale: "Tweak",
      edits: [
        { fieldId: "basics.name", from: "Alice", to: "Alice (PhD)" },
      ],
    };
    mocks.jobChatRepo.getMessageById.mockResolvedValue(makeMessage(proposed));
    mocks.pdf.generatePdf.mockResolvedValue({
      success: false,
      error: "tectonic exploded",
    });

    await expect(
      acceptEditForJob({ jobId: "job-1", messageId: "msg-1" }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    // First call applies the patched overrides; second restores the original.
    expect(mocks.jobsRepo.updateJob.mock.calls[0][1].tailoredFields).toEqual({
      "basics.name": "Alice (PhD)",
    });
    expect(mocks.jobsRepo.updateJob.mock.calls[1][1].tailoredFields).toBe(
      baseOverrides,
    );
    expect(mocks.jobChatRepo.setMessageEditStatus).not.toHaveBeenCalled();
  });

  it("returns 409 when the message edit was already resolved", async () => {
    const proposed: JobChatProposedCvEdit = {
      kind: "cv-edit",
      rationale: "any",
      edits: [{ fieldId: "basics.name", from: "Alice", to: "Bob" }],
    };
    mocks.jobChatRepo.getMessageById.mockResolvedValue(
      makeMessage(proposed, { editStatus: "accepted" }),
    );

    await expect(
      acceptEditForJob({ jobId: "job-1", messageId: "msg-1" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("acceptEditForJob: brief-edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cvActive.getActiveCvDocument.mockResolvedValue(baseCvDocument);
    mocks.cvRepo.updateCvDocument.mockResolvedValue({
      ...baseCvDocument,
      personalBrief: "First paragraph.\n\nSecond paragraph.",
    });
  });

  it("appends to personal_brief and marks accepted", async () => {
    const proposed: JobChatProposedBriefEdit = {
      kind: "brief-edit",
      rationale: "remember postgres",
      append: "Second paragraph.",
    };
    const acceptedMessage = makeMessage(proposed, { editStatus: "accepted" });

    mocks.jobChatRepo.getMessageById.mockResolvedValue(makeMessage(proposed));
    mocks.jobChatRepo.setMessageEditStatus.mockResolvedValue(acceptedMessage);

    const result = await acceptEditForJob({
      jobId: "job-1",
      messageId: "msg-1",
    });

    expect(result.kind).toBe("brief-edit");
    expect(mocks.cvRepo.updateCvDocument).toHaveBeenCalledWith("cv-1", {
      personalBrief: "First paragraph.\n\nSecond paragraph.",
    });
    expect(mocks.jobChatRepo.setMessageEditStatus).toHaveBeenCalledWith(
      "msg-1",
      "accepted",
    );
  });
});

describe("rejectEditForJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets editStatus to 'rejected' and returns the updated message", async () => {
    const proposed: JobChatProposedCvEdit = {
      kind: "cv-edit",
      rationale: "any",
      edits: [{ fieldId: "basics.name", from: "Alice", to: "Bob" }],
    };
    const rejectedMessage = makeMessage(proposed, { editStatus: "rejected" });

    mocks.jobChatRepo.getMessageById.mockResolvedValue(makeMessage(proposed));
    mocks.jobChatRepo.setMessageEditStatus.mockResolvedValue(rejectedMessage);

    const result = await rejectEditForJob({
      jobId: "job-1",
      messageId: "msg-1",
    });

    expect(result.editStatus).toBe("rejected");
    expect(mocks.jobChatRepo.setMessageEditStatus).toHaveBeenCalledWith(
      "msg-1",
      "rejected",
    );
  });

  it("returns 404 when the message belongs to a different job", async () => {
    mocks.jobChatRepo.getMessageById.mockResolvedValue(
      makeMessage(
        {
          kind: "cv-edit",
          rationale: "any",
          edits: [{ fieldId: "basics.name", from: "Alice", to: "Bob" }],
        },
        { jobId: "other-job" },
      ),
    );

    await expect(
      rejectEditForJob({ jobId: "job-1", messageId: "msg-1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
