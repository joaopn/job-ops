import type { JobChatMessage } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestId: vi.fn(),
  buildJobChatPromptContext: vi.fn(),
  llmCallJson: vi.fn(),
  repo: {
    getOrCreateThreadForJob: vi.fn(),
    getThreadForJob: vi.fn(),
    listMessagesForThread: vi.fn(),
    getActiveRunForThread: vi.fn(),
    createMessage: vi.fn(),
    createRun: vi.fn(),
    updateMessage: vi.fn(),
    completeRun: vi.fn(),
    completeRunIfRunning: vi.fn(),
    getMessageById: vi.fn(),
    getLatestAssistantMessage: vi.fn(),
    getRunById: vi.fn(),
    getActivePathFromRoot: vi.fn(),
    getAncestorPath: vi.fn(),
    setActiveChild: vi.fn(),
    setActiveRoot: vi.fn(),
    getSiblingsOf: vi.fn(),
    getChildrenOfMessage: vi.fn(),
  },
  settings: {
    getAllSettings: vi.fn(),
  },
}));

vi.mock("@infra/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@infra/request-context", () => ({
  getRequestId: mocks.getRequestId,
}));

vi.mock("./ghostwriter-context", () => ({
  buildJobChatPromptContext: mocks.buildJobChatPromptContext,
}));

vi.mock("../repositories/settings", () => ({
  getAllSettings: mocks.settings.getAllSettings,
}));

vi.mock("../repositories/ghostwriter", () => ({
  getOrCreateThreadForJob: mocks.repo.getOrCreateThreadForJob,
  getThreadForJob: mocks.repo.getThreadForJob,
  listMessagesForThread: mocks.repo.listMessagesForThread,
  getActiveRunForThread: mocks.repo.getActiveRunForThread,
  createMessage: mocks.repo.createMessage,
  createRun: mocks.repo.createRun,
  updateMessage: mocks.repo.updateMessage,
  completeRun: mocks.repo.completeRun,
  completeRunIfRunning: mocks.repo.completeRunIfRunning,
  getMessageById: mocks.repo.getMessageById,
  getLatestAssistantMessage: mocks.repo.getLatestAssistantMessage,
  getRunById: mocks.repo.getRunById,
  getActivePathFromRoot: mocks.repo.getActivePathFromRoot,
  getAncestorPath: mocks.repo.getAncestorPath,
  setActiveChild: mocks.repo.setActiveChild,
  getSiblingsOf: mocks.repo.getSiblingsOf,
  getChildrenOfMessage: mocks.repo.getChildrenOfMessage,
  setActiveRoot: mocks.repo.setActiveRoot,
}));

vi.mock("./llm/service", () => ({
  LlmService: class {
    callJson = mocks.llmCallJson;
  },
}));

import {
  cancelRun,
  cancelRunForJob,
  regenerateMessage,
  sendMessage,
  sendMessageForJob,
} from "./ghostwriter";

const thread = {
  id: "thread-1",
  jobId: "job-1",
  title: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastMessageAt: null,
  activeRootMessageId: "user-1",
};

const baseUserMessage: JobChatMessage = {
  id: "user-1",
  threadId: "thread-1",
  jobId: "job-1",
  role: "user",
  content: "Tell me about this role",
  status: "complete",
  tokensIn: 6,
  tokensOut: null,
  version: 1,
  replacesMessageId: null,
  parentMessageId: null,
  activeChildId: "assistant-1",
  proposedEdit: null,
  editStatus: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const baseAssistantMessage: JobChatMessage = {
  id: "assistant-1",
  threadId: "thread-1",
  jobId: "job-1",
  role: "assistant",
  content: "Draft response",
  status: "complete",
  tokensIn: 6,
  tokensOut: 4,
  version: 1,
  replacesMessageId: null,
  parentMessageId: "user-1",
  activeChildId: null,
  proposedEdit: null,
  editStatus: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("ghostwriter service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getRequestId.mockReturnValue("req-123");
    mocks.settings.getAllSettings.mockResolvedValue({});
    mocks.buildJobChatPromptContext.mockResolvedValue({
      job: { id: "job-1" },
      cv: null,
      style: {
        tone: "professional",
        formality: "medium",
        constraints: "",
        doNotUse: "",
      },
      systemPrompt: "system prompt",
      jobSnapshot: '{"job":"snapshot"}',
      briefSnapshot: "brief snapshot",
      cvSnapshot: '{"cv":null}',
      coverLetterSnapshot: "",
    });

    mocks.repo.getOrCreateThreadForJob.mockResolvedValue(thread);
    mocks.repo.getThreadForJob.mockResolvedValue(thread);
    mocks.repo.getActiveRunForThread.mockResolvedValue(null);
    mocks.repo.createRun.mockResolvedValue({
      id: "run-1",
      threadId: "thread-1",
      jobId: "job-1",
      status: "running",
      model: "model-a",
      provider: "openrouter",
      errorCode: null,
      errorMessage: null,
      startedAt: Date.now(),
      completedAt: null,
      requestId: "req-123",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mocks.repo.completeRun.mockResolvedValue(null);
    mocks.repo.completeRunIfRunning.mockResolvedValue({
      id: "run-1",
      threadId: "thread-1",
      jobId: "job-1",
      status: "cancelled",
      model: "model-a",
      provider: "openrouter",
      errorCode: "REQUEST_TIMEOUT",
      errorMessage: "Generation cancelled by user",
      startedAt: Date.now(),
      completedAt: Date.now(),
      requestId: "req-123",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mocks.repo.updateMessage.mockResolvedValue(baseAssistantMessage);
    mocks.repo.getMessageById.mockResolvedValue(baseAssistantMessage);
    mocks.repo.listMessagesForThread.mockResolvedValue([
      baseUserMessage,
      baseAssistantMessage,
      {
        ...baseAssistantMessage,
        id: "tool-1",
        role: "tool",
      },
      {
        ...baseAssistantMessage,
        id: "failed-1",
        role: "assistant",
        status: "failed",
      },
    ]);
    mocks.repo.getActivePathFromRoot.mockResolvedValue([
      baseUserMessage,
      baseAssistantMessage,
    ]);
    mocks.repo.getAncestorPath.mockResolvedValue([
      baseUserMessage,
      baseAssistantMessage,
    ]);
    mocks.repo.setActiveChild.mockResolvedValue(undefined);
    mocks.repo.setActiveRoot.mockResolvedValue(undefined);
    mocks.repo.getSiblingsOf.mockResolvedValue({
      siblings: [baseAssistantMessage],
      activeIndex: 0,
    });
    mocks.llmCallJson.mockResolvedValue({
      success: true,
      data: { message: "Thanks for your question.", toolCalls: [] },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends message, runs LLM, and returns user + assistant messages", async () => {
    const assistantPartial: JobChatMessage = {
      ...baseAssistantMessage,
      id: "assistant-partial",
      content: "",
      status: "partial",
    };
    const assistantComplete: JobChatMessage = {
      ...baseAssistantMessage,
      id: "assistant-partial",
      content: "Thanks for your question.",
      status: "complete",
      tokensOut: 7,
    };

    mocks.repo.createMessage
      .mockResolvedValueOnce(baseUserMessage)
      .mockResolvedValueOnce(assistantPartial);
    mocks.repo.updateMessage.mockResolvedValue(assistantComplete);
    mocks.repo.getMessageById.mockResolvedValue(assistantComplete);

    const result = await sendMessageForJob({
      jobId: "job-1",
      content: "  Tell me about this role  ",
    });

    expect(result.runId).toBe("run-1");
    expect(result.userMessage.role).toBe("user");
    expect(result.assistantMessage?.role).toBe("assistant");
    expect(mocks.repo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-123",
      }),
    );

    const llmArg = mocks.llmCallJson.mock.calls[0][0];
    expect(llmArg.messages.at(-1)).toMatchObject({
      role: "user",
      content: "Tell me about this role",
    });
    expect(
      llmArg.messages.filter(
        (message: { role: string }) =>
          message.role !== "system" && message.role !== "user",
      ),
    ).toEqual([{ role: "assistant", content: "Draft response" }]);
  });

  it("rejects empty message content", async () => {
    await expect(
      sendMessage({
        jobId: "job-1",
        threadId: "thread-1",
        content: "   ",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      status: 400,
    });
  });

  it("cancels a running generation during streaming", async () => {
    vi.useFakeTimers();

    const assistantPartial: JobChatMessage = {
      ...baseAssistantMessage,
      id: "assistant-stream",
      content: "",
      status: "partial",
    };
    const assistantCancelled: JobChatMessage = {
      ...assistantPartial,
      status: "cancelled",
      content: "",
    };
    let cancelPromise: Promise<{
      cancelled: boolean;
      alreadyFinished: boolean;
    }> | null = null;

    mocks.repo.createMessage
      .mockResolvedValueOnce(baseUserMessage)
      .mockResolvedValueOnce(assistantPartial);
    mocks.repo.updateMessage.mockResolvedValue(assistantCancelled);
    mocks.repo.getMessageById.mockResolvedValue(assistantCancelled);
    mocks.repo.getRunById.mockResolvedValue({
      id: "run-1",
      threadId: "thread-1",
      jobId: "job-1",
      status: "running",
      model: "model-a",
      provider: "openrouter",
      errorCode: null,
      errorMessage: null,
      startedAt: Date.now(),
      completedAt: null,
      requestId: "req-123",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mocks.llmCallJson.mockImplementation(async () => {
      await vi.advanceTimersByTimeAsync(1);
      return {
        success: true,
        data: { message: "x".repeat(200), toolCalls: [] },
      };
    });

    const onReady = vi.fn(({ runId }: { runId: string }) => {
      cancelPromise = cancelRunForJob({ jobId: "job-1", runId });
    });
    const onCancelled = vi.fn();
    const onCompleted = vi.fn();

    const resultPromise = sendMessageForJob({
      jobId: "job-1",
      content: "Cancel this",
      stream: {
        onReady,
        onDelta: vi.fn(),
        onCompleted,
        onCancelled,
        onError: vi.fn(),
      },
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;
    await cancelPromise;

    expect(onReady).toHaveBeenCalled();
    expect(onCancelled).toHaveBeenCalled();
    expect(onCompleted).not.toHaveBeenCalled();
    expect(result.assistantMessage?.status).toBe("cancelled");
  });

  it("regenerates any assistant message, not just the latest", async () => {
    const assistantPartial: JobChatMessage = {
      ...baseAssistantMessage,
      id: "assistant-regen",
      content: "",
      status: "partial",
      parentMessageId: "user-1",
    };
    const assistantComplete: JobChatMessage = {
      ...baseAssistantMessage,
      id: "assistant-regen",
      content: "Thanks for your question.",
      status: "complete",
      parentMessageId: "user-1",
    };

    mocks.repo.getMessageById
      .mockResolvedValueOnce(baseAssistantMessage) // target lookup
      .mockResolvedValueOnce(baseUserMessage) // parent user lookup
      .mockResolvedValueOnce(assistantComplete); // final lookup after run

    mocks.repo.getAncestorPath.mockResolvedValue([baseUserMessage]);
    mocks.repo.createMessage.mockResolvedValueOnce(assistantPartial);
    mocks.repo.updateMessage.mockResolvedValue(assistantComplete);

    const result = await regenerateMessage({
      jobId: "job-1",
      threadId: "thread-1",
      assistantMessageId: "assistant-1",
    });

    expect(result.runId).toBe("run-1");
    expect(result.assistantMessage?.id).toBe("assistant-regen");
    expect(mocks.repo.setActiveChild).toHaveBeenCalledWith(
      "user-1",
      "assistant-regen",
    );
  });

  it("returns alreadyFinished when cancelling non-running run", async () => {
    mocks.repo.getRunById.mockResolvedValue({
      id: "run-finished",
      threadId: "thread-1",
      jobId: "job-1",
      status: "completed",
      model: "model-a",
      provider: "openrouter",
      errorCode: null,
      errorMessage: null,
      startedAt: Date.now(),
      completedAt: Date.now(),
      requestId: "req-123",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await cancelRun({
      jobId: "job-1",
      threadId: "thread-1",
      runId: "run-finished",
    });

    expect(result).toEqual({ cancelled: false, alreadyFinished: true });
    expect(mocks.repo.completeRun).not.toHaveBeenCalled();
    expect(mocks.repo.completeRunIfRunning).not.toHaveBeenCalled();
  });

  it("returns alreadyFinished when run completes before cancel write", async () => {
    mocks.repo.getRunById.mockResolvedValue({
      id: "run-race",
      threadId: "thread-1",
      jobId: "job-1",
      status: "running",
      model: "model-a",
      provider: "openrouter",
      errorCode: null,
      errorMessage: null,
      startedAt: Date.now(),
      completedAt: null,
      requestId: "req-123",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mocks.repo.completeRunIfRunning.mockResolvedValue({
      id: "run-race",
      threadId: "thread-1",
      jobId: "job-1",
      status: "completed",
      model: "model-a",
      provider: "openrouter",
      errorCode: null,
      errorMessage: null,
      startedAt: Date.now(),
      completedAt: Date.now(),
      requestId: "req-123",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await cancelRun({
      jobId: "job-1",
      threadId: "thread-1",
      runId: "run-race",
    });

    expect(result).toEqual({ cancelled: false, alreadyFinished: true });
  });

  it("attaches a cover-letter edit from a tool call", async () => {
    mocks.repo.createMessage
      .mockResolvedValueOnce(baseUserMessage)
      .mockResolvedValueOnce({
        ...baseAssistantMessage,
        id: "assistant-cl",
        content: "",
        status: "partial",
      });
    mocks.llmCallJson.mockResolvedValue({
      success: true,
      data: {
        message: "Rewrote the letter to lead with data-platform work.",
        toolCalls: [
          {
            name: "rewrite_cover_letter",
            argumentsJson: JSON.stringify({ draft: "Dear hiring team, ..." }),
          },
        ],
      },
    });

    await sendMessageForJob({ jobId: "job-1", content: "Tighten the letter" });

    const updateArgs = mocks.repo.updateMessage.mock.calls.at(-1)?.[1];
    expect(updateArgs).toMatchObject({
      status: "complete",
      editStatus: "pending",
      proposedEdit: {
        kind: "cover-letter-edit",
        draft: "Dear hiring team, ...",
        rationale: "",
      },
    });
  });

  it("fills cv-edit `from` from the current field value (model sends only fieldId+to)", async () => {
    mocks.buildJobChatPromptContext.mockResolvedValue({
      job: { id: "job-1", title: "Eng", employer: "Acme", tailoredFields: {} },
      cv: { id: "cv-1", fields: [{ id: "f1", role: "bullet", value: "old latex" }] },
      style: { tone: "professional", formality: "medium", constraints: "", doNotUse: "" },
      systemPrompt: "system prompt",
      jobSnapshot: '{"job":"snapshot"}',
      briefSnapshot: "brief",
      cvSnapshot: '{"cv":"snapshot"}',
      coverLetterSnapshot: "",
    });
    mocks.repo.createMessage
      .mockResolvedValueOnce(baseUserMessage)
      .mockResolvedValueOnce({
        ...baseAssistantMessage,
        id: "assistant-cv",
        content: "",
        status: "partial",
      });
    mocks.llmCallJson.mockResolvedValue({
      success: true,
      data: {
        message: "Tightened that bullet.",
        toolCalls: [
          {
            name: "propose_cv_edit",
            argumentsJson: JSON.stringify({
              edits: [{ fieldId: "f1", to: "new latex" }],
            }),
          },
        ],
      },
    });

    await sendMessageForJob({ jobId: "job-1", content: "tighten bullet 1" });

    const updateArgs = mocks.repo.updateMessage.mock.calls.at(-1)?.[1];
    expect(updateArgs.proposedEdit).toEqual({
      kind: "cv-edit",
      rationale: "",
      edits: [{ fieldId: "f1", from: "old latex", to: "new latex" }],
    });
  });

  it("corrective-retries an invalid reply, then succeeds", async () => {
    mocks.repo.createMessage
      .mockResolvedValueOnce(baseUserMessage)
      .mockResolvedValueOnce({
        ...baseAssistantMessage,
        id: "assistant-retry",
        content: "",
        status: "partial",
      });
    mocks.llmCallJson
      .mockResolvedValueOnce({
        success: true,
        data: { foo: "not the schema" },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { message: "Fixed.", toolCalls: [] },
      });

    await sendMessageForJob({ jobId: "job-1", content: "hi" });

    expect(mocks.llmCallJson).toHaveBeenCalledTimes(2);
    // Second attempt must include the prior bad reply + a correction turn.
    const secondMessages = mocks.llmCallJson.mock.calls[1][0].messages;
    expect(secondMessages.at(-1).content).toContain("previous reply was invalid");
    const updateArgs = mocks.repo.updateMessage.mock.calls.at(-1)?.[1];
    expect(updateArgs).toMatchObject({ status: "complete", content: "Fixed." });
  });

  it("fails the turn when the reply stays invalid after all attempts", async () => {
    mocks.repo.createMessage
      .mockResolvedValueOnce(baseUserMessage)
      .mockResolvedValueOnce({
        ...baseAssistantMessage,
        id: "assistant-bad",
        content: "",
        status: "partial",
      });
    mocks.llmCallJson.mockResolvedValue({
      success: true,
      data: { message: "", toolCalls: "nope" },
    });

    await expect(
      sendMessageForJob({ jobId: "job-1", content: "hi" }),
    ).rejects.toMatchObject({ status: 502 });

    const failingUpdate = mocks.repo.updateMessage.mock.calls
      .map((call) => call[1])
      .find((args) => args.status === "failed");
    expect(failingUpdate).toBeTruthy();
  });

  it("maps createRun unique constraint races to conflict", async () => {
    mocks.repo.createMessage.mockResolvedValue(baseUserMessage);
    mocks.repo.createRun.mockRejectedValue(
      new Error(
        "UNIQUE constraint failed: job_chat_runs.thread_id (idx_job_chat_runs_thread_running_unique)",
      ),
    );

    await expect(
      sendMessageForJob({
        jobId: "job-1",
        content: "hello",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    });
  });
});
