import {
  badRequest,
  conflict,
  notFound,
  requestTimeout,
  upstreamError,
} from "@infra/errors";
import { logger } from "@infra/logger";
import { getRequestId } from "@infra/request-context";
import type {
  BranchInfo,
  CvField,
  CvFieldOverrides,
  JobChatMessage,
  JobChatProposedBriefEdit,
  JobChatProposedCoverLetterEdit,
  JobChatProposedCvEdit,
  JobChatProposedCvEditOp,
  JobChatProposedEdit,
  JobChatRun,
} from "@shared/types";
import * as jobChatRepo from "../repositories/ghostwriter";
import { buildJobChatPromptContext } from "./ghostwriter-context";
import { LlmService } from "./llm/service";
import type { JsonSchemaDefinition } from "./llm/types";
import { resolveLlmRuntimeSettings as resolveRuntimeLlmSettings } from "./modelSelection";

type LlmRuntimeSettings = {
  model: string;
  provider: string | null;
  baseUrl: string | null;
  apiKey: string | null;
};

const abortControllers = new Map<string, AbortController>();

/**
 * How many times we ask the model for a schema-valid reply before failing the
 * turn. The first attempt is the normal call; each subsequent attempt re-sends
 * the conversation with the concrete validation error appended (corrective
 * retry), which fixes far more wrong-shape replies than a blind resend. Strict:
 * after this many attempts an invalid reply fails the turn rather than
 * degrading to a phantom no-op.
 */
const MAX_VALIDATION_ATTEMPTS = 2;

/**
 * The ghostwriter speaks ONE protocol regardless of provider: every reply is a
 * single JSON object with a chat `message` (always present) plus zero or more
 * `toolCalls` (proposed edits). This is tool-calling expressed as structured
 * output so it works on every backend — native tool-calling transports differ
 * per provider and weak/local models lack them, whereas this rides on the
 * `json_schema -> json_object -> none` degradation chain `callJson` already
 * implements.
 *
 * Why this exact shape:
 *
 *  - Decoupling `message` from `toolCalls` lets the model chat AND edit in the
 *    same turn. The old design forced a single exclusive `kind`, so the model
 *    would narrate a change as a `text` reply that mutated nothing — the
 *    "ghostwriter says it edited but does nothing" bug.
 *
 *  - Strict structured-output mode (OpenAI / OpenRouter / Gemini) requires
 *    EVERY property to be `required` and rejects optional / nested-optional
 *    shapes with a 400 that the capability-fallback layer misreads as "mode
 *    unsupported", silently dropping schema enforcement. So every property is
 *    required and each tool call is a flat `{ name, argumentsJson }` pair whose
 *    per-tool argument shape lives in a JSON STRING (the repo's `patchesJson`
 *    convention). The server JSON-parses + validates `argumentsJson` per tool
 *    name; an invalid call is a hard validation failure (see
 *    `validateChatResponse`) — never a phantom "I edited it".
 */
const CHAT_TOOL_NAMES = [
  "propose_cv_edit",
  "rewrite_cover_letter",
  "edit_brief",
] as const;
type ChatToolName = (typeof CHAT_TOOL_NAMES)[number];

const CHAT_RESPONSE_SCHEMA: JsonSchemaDefinition = {
  name: "job_chat_response",
  schema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description:
          "Your chat reply to the user — ALWAYS present. Explain what you did or answer the question. When you attach an edit, this is where you describe it (one or two sentences). Never leave empty.",
      },
      toolCalls: {
        type: "array",
        description:
          "Proposed edits attached to this reply. Use an EMPTY array when the user only wants to chat. Each call proposes a change to ONE document that the user must accept or reject — only include a call when the user asked for a concrete change.",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              enum: [...CHAT_TOOL_NAMES],
              description:
                "Which document to edit: propose_cv_edit | rewrite_cover_letter | edit_brief.",
            },
            argumentsJson: {
              type: "string",
              description:
                'Stringified JSON arguments for the named tool. propose_cv_edit: {"edits":[{"fieldId":"...","to":"..."}]} — fieldId MUST match an id in the CV State fields list; `to` is the full replacement value (verbatim LaTeX); NEVER include a `from` field. rewrite_cover_letter: {"draft":"...the complete ready-to-send letter..."}. edit_brief: {"append":"..."} (preferred) or {"replace":"...the full rewritten brief..."}.',
            },
          },
          required: ["name", "argumentsJson"],
          additionalProperties: false,
        },
      },
    },
    required: ["message", "toolCalls"],
    additionalProperties: false,
  },
};

/** Shape we expect back from the LLM, before validation. */
type RawChatToolCall = { name?: unknown; argumentsJson?: unknown };
type RawChatResponse = { message?: unknown; toolCalls?: unknown };

type ValidatedReply = {
  /** The chat reply, persisted as the assistant message `content`. */
  message: string;
  /** The single proposed edit attached to this turn, or null. */
  proposedEdit: JobChatProposedEdit | null;
};

type ValidationResult =
  | { ok: true; reply: ValidatedReply }
  | { ok: false; error: string };

type CvEditContext = {
  fields: CvField[];
  overrides: CvFieldOverrides;
};

function currentFieldValue(
  fieldId: string,
  ctx: CvEditContext,
): string | undefined {
  const field = ctx.fields.find((f) => f.id === fieldId);
  if (!field) return undefined;
  return Object.hasOwn(ctx.overrides, fieldId)
    ? ctx.overrides[fieldId]
    : field.value;
}

/**
 * Validate one `propose_cv_edit` call. The model only supplies `{ fieldId, to }`
 * — the server resolves `from` from the field's CURRENT effective value, so the
 * model never has to reproduce verbatim LaTeX, and `from` becomes a real
 * concurrency guard at accept time (`applyCvEditOps`).
 */
function validateCvEditArgs(
  args: unknown,
  ctx: CvEditContext,
): { ok: true; edit: JobChatProposedCvEdit } | { ok: false; error: string } {
  const edits =
    args && typeof args === "object"
      ? (args as { edits?: unknown }).edits
      : undefined;
  if (!Array.isArray(edits) || edits.length === 0) {
    return { ok: false, error: "propose_cv_edit.edits must be a non-empty array" };
  }
  const ops: JobChatProposedCvEditOp[] = [];
  for (const raw of edits) {
    const fieldId =
      raw && typeof raw === "object"
        ? (raw as { fieldId?: unknown }).fieldId
        : undefined;
    const to =
      raw && typeof raw === "object"
        ? (raw as { to?: unknown }).to
        : undefined;
    if (typeof fieldId !== "string" || !fieldId) {
      return { ok: false, error: "each CV edit needs a non-empty string fieldId" };
    }
    if (typeof to !== "string" || !to.trim()) {
      return {
        ok: false,
        error: `CV edit for fieldId '${fieldId}' needs a non-empty 'to' value`,
      };
    }
    const from = currentFieldValue(fieldId, ctx);
    if (from === undefined) {
      const validIds = ctx.fields.map((f) => f.id).join(", ");
      return {
        ok: false,
        error: `fieldId '${fieldId}' is not in the CV fields list. Valid ids: [${validIds}]`,
      };
    }
    ops.push({ fieldId, from, to });
  }
  return {
    ok: true,
    edit: { kind: "cv-edit", rationale: "", edits: ops },
  };
}

function validateChatResponse(
  raw: RawChatResponse,
  ctx: CvEditContext,
): ValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "response was not a JSON object" };
  }
  if (typeof raw.message !== "string" || !raw.message.trim()) {
    return { ok: false, error: "missing required non-empty string 'message'" };
  }
  if (!Array.isArray(raw.toolCalls)) {
    return { ok: false, error: "'toolCalls' must be an array (use [] for none)" };
  }

  const message = raw.message.trim();

  if (raw.toolCalls.length === 0) {
    return { ok: true, reply: { message, proposedEdit: null } };
  }

  // The store holds one proposed edit per message; take the first call and
  // ignore extras (the prompt asks the model to edit one document per turn).
  if (raw.toolCalls.length > 1) {
    logger.warn("Ghostwriter returned multiple tool calls; using the first", {
      count: raw.toolCalls.length,
    });
  }

  const call = raw.toolCalls[0] as RawChatToolCall;
  const name = call?.name;
  if (
    typeof name !== "string" ||
    !CHAT_TOOL_NAMES.includes(name as ChatToolName)
  ) {
    return {
      ok: false,
      error: `toolCalls[0].name must be one of ${CHAT_TOOL_NAMES.join(" | ")}`,
    };
  }
  if (typeof call.argumentsJson !== "string" || !call.argumentsJson.trim()) {
    return {
      ok: false,
      error: "toolCalls[0].argumentsJson must be a non-empty JSON string",
    };
  }

  let args: unknown;
  try {
    args = JSON.parse(call.argumentsJson);
  } catch {
    return {
      ok: false,
      error: "toolCalls[0].argumentsJson was not parseable JSON",
    };
  }

  if (name === "propose_cv_edit") {
    const result = validateCvEditArgs(args, ctx);
    if (!result.ok) return result;
    // rationale stays empty — the chat `message` bubble already explains the
    // edit, so the card's "Rationale:" line would just duplicate it.
    return { ok: true, reply: { message, proposedEdit: result.edit } };
  }

  if (name === "rewrite_cover_letter") {
    const draft =
      args && typeof args === "object"
        ? (args as { draft?: unknown }).draft
        : undefined;
    if (typeof draft !== "string" || !draft.trim()) {
      return {
        ok: false,
        error: "rewrite_cover_letter needs a non-empty 'draft' string",
      };
    }
    const edit: JobChatProposedCoverLetterEdit = {
      kind: "cover-letter-edit",
      draft: draft.trim(),
      rationale: "",
    };
    return { ok: true, reply: { message, proposedEdit: edit } };
  }

  // name === "edit_brief"
  const obj = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  const append = typeof obj.append === "string" ? obj.append.trim() : "";
  const replace = typeof obj.replace === "string" ? obj.replace.trim() : "";
  if (!append && !replace) {
    return {
      ok: false,
      error: "edit_brief needs a non-empty 'append' or 'replace' string",
    };
  }
  const edit: JobChatProposedBriefEdit = {
    kind: "brief-edit",
    rationale: "",
    ...(append ? { append } : { replace }),
  };
  return { ok: true, reply: { message, proposedEdit: edit } };
}

function estimateTokenCount(value: string): number {
  if (!value) return 0;
  return Math.ceil(value.length / 4);
}

function chunkText(value: string, maxChunk = 60): string[] {
  if (!value) return [];
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    chunks.push(value.slice(cursor, cursor + maxChunk));
    cursor += maxChunk;
  }
  return chunks;
}

function isRunningRunUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("idx_job_chat_runs_thread_running_unique") ||
    message.includes("UNIQUE constraint failed: job_chat_runs.thread_id")
  );
}

async function resolveLlmRuntimeSettings(): Promise<LlmRuntimeSettings> {
  return resolveRuntimeLlmSettings("tailoring");
}

async function buildConversationMessages(
  threadId: string,
  targetMessageId?: string,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  // If a target message is given, walk its ancestor path (branch-aware).
  // Otherwise, fall back to the active path from root.
  const messages = targetMessageId
    ? await jobChatRepo.getAncestorPath(targetMessageId)
    : await jobChatRepo.getActivePathFromRoot(threadId);

  return messages
    .filter(
      (message): message is typeof message & { role: "user" | "assistant" } =>
        message.role === "user" || message.role === "assistant",
    )
    .filter((message) => message.status !== "failed")
    .slice(-40)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

type GenerateReplyOptions = {
  jobId: string;
  threadId: string;
  prompt: string;
  replaceMessageId?: string;
  version?: number;
  /** Parent message ID for the assistant reply (i.e. the user message that triggered it). */
  parentMessageId?: string;
  stream?: {
    onReady: (payload: {
      runId: string;
      threadId: string;
      messageId: string;
      requestId: string;
    }) => void;
    onDelta: (payload: {
      runId: string;
      messageId: string;
      delta: string;
    }) => void;
    onCompleted: (payload: {
      runId: string;
      message: Awaited<ReturnType<typeof jobChatRepo.getMessageById>>;
    }) => void;
    onCancelled: (payload: {
      runId: string;
      message: Awaited<ReturnType<typeof jobChatRepo.getMessageById>>;
    }) => void;
    onError: (payload: {
      runId: string;
      code: string;
      message: string;
      requestId: string;
    }) => void;
  };
};

async function ensureJobThread(jobId: string) {
  return jobChatRepo.getOrCreateThreadForJob({
    jobId,
    title: null,
  });
}

export async function createThread(input: {
  jobId: string;
  title?: string | null;
}) {
  return ensureJobThread(input.jobId);
}

export async function listThreads(jobId: string) {
  const thread = await ensureJobThread(jobId);
  return [thread];
}

async function buildBranchInfoForPath(
  messages: JobChatMessage[],
): Promise<BranchInfo[]> {
  const branches: BranchInfo[] = [];

  for (const msg of messages) {
    const { siblings, activeIndex } = await jobChatRepo.getSiblingsOf(msg.id);
    if (siblings.length > 1) {
      branches.push({
        messageId: msg.id,
        siblingIds: siblings.map((s) => s.id),
        activeIndex,
      });
    }
  }

  return branches;
}

export async function listMessages(input: {
  jobId: string;
  threadId: string;
  limit?: number;
  offset?: number;
}): Promise<{ messages: JobChatMessage[]; branches: BranchInfo[] }> {
  const thread = await jobChatRepo.getThreadForJob(input.jobId, input.threadId);
  if (!thread) {
    throw notFound("Thread not found for this job");
  }

  const messages = await jobChatRepo.getActivePathFromRoot(input.threadId);
  const branches = await buildBranchInfoForPath(messages);
  return { messages, branches };
}

export async function listMessagesForJob(input: {
  jobId: string;
  limit?: number;
  offset?: number;
}): Promise<{ messages: JobChatMessage[]; branches: BranchInfo[] }> {
  const thread = await ensureJobThread(input.jobId);
  const messages = await jobChatRepo.getActivePathFromRoot(thread.id);
  const branches = await buildBranchInfoForPath(messages);
  return { messages, branches };
}

async function runAssistantReply(
  options: GenerateReplyOptions,
): Promise<{ runId: string; messageId: string; message: string }> {
  const thread = await jobChatRepo.getThreadForJob(
    options.jobId,
    options.threadId,
  );
  if (!thread) {
    throw notFound("Thread not found for this job");
  }

  const activeRun = await jobChatRepo.getActiveRunForThread(options.threadId);
  if (activeRun) {
    throw conflict("A chat generation is already running for this thread");
  }

  const [context, llmConfig, history] = await Promise.all([
    buildJobChatPromptContext(options.jobId),
    resolveLlmRuntimeSettings(),
    buildConversationMessages(options.threadId, options.parentMessageId),
  ]);

  const requestId = getRequestId() ?? "unknown";

  let run: JobChatRun;
  try {
    run = await jobChatRepo.createRun({
      threadId: options.threadId,
      jobId: options.jobId,
      model: llmConfig.model,
      provider: llmConfig.provider,
      requestId,
    });
  } catch (error) {
    if (isRunningRunUniqueConstraintError(error)) {
      throw conflict("A chat generation is already running for this thread");
    }
    throw error;
  }

  let assistantMessage: JobChatMessage;
  try {
    assistantMessage = await jobChatRepo.createMessage({
      threadId: options.threadId,
      jobId: options.jobId,
      role: "assistant",
      content: "",
      status: "partial",
      version: options.version ?? 1,
      replacesMessageId: options.replaceMessageId ?? null,
      parentMessageId: options.parentMessageId ?? null,
    });
  } catch (error) {
    await jobChatRepo.completeRun(run.id, {
      status: "failed",
      errorCode: "INTERNAL_ERROR",
      errorMessage: "Failed to create assistant message",
    });
    throw error;
  }

  const controller = new AbortController();
  abortControllers.set(run.id, controller);
  options.stream?.onReady({
    runId: run.id,
    threadId: options.threadId,
    messageId: assistantMessage.id,
    requestId,
  });

  let accumulated = "";

  try {
    const llm = new LlmService({
      provider: llmConfig.provider,
      baseUrl: llmConfig.baseUrl,
      apiKey: llmConfig.apiKey,
    });

    const cvEditCtx: CvEditContext = {
      fields: context.cv?.fields ?? [],
      overrides: context.job.tailoredFields ?? {},
    };

    let conversation: Array<{
      role: "user" | "system" | "assistant";
      content: string;
    }> = [
      { role: "system", content: context.systemPrompt },
      { role: "system", content: `Job Context (JSON):\n${context.jobSnapshot}` },
      {
        role: "system",
        content: `Candidate Brief:\n${context.briefSnapshot || "No personal brief available."}`,
      },
      {
        role: "system",
        content: `CV State (JSON):\n${context.cvSnapshot || "No active CV."}`,
      },
      {
        role: "system",
        content: `Cover Letter Draft:\n${context.coverLetterSnapshot || "(no cover letter draft yet)"}`,
      },
      ...history,
      { role: "user", content: options.prompt },
    ];

    let validated: ValidatedReply | null = null;
    let lastValidationError = "";

    for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt++) {
      const llmResult = await llm.callJson<RawChatResponse>({
        model: llmConfig.model,
        messages: conversation,
        jsonSchema: CHAT_RESPONSE_SCHEMA,
        maxRetries: 1,
        retryDelayMs: 300,
        jobId: options.jobId,
        signal: controller.signal,
        label: "chat with assistant",
        subject: `${context.job.title} @ ${context.job.employer}`,
      });

      if (!llmResult.success) {
        if (controller.signal.aborted) {
          throw requestTimeout("Chat generation was cancelled");
        }
        throw upstreamError("LLM generation failed", {
          reason: llmResult.error,
        });
      }

      const validation = validateChatResponse(llmResult.data, cvEditCtx);
      if (validation.ok) {
        validated = validation.reply;
        break;
      }

      lastValidationError = validation.error;
      logger.warn(
        "Ghostwriter reply failed schema validation; requesting correction",
        {
          jobId: options.jobId,
          runId: run.id,
          attempt,
          maxAttempts: MAX_VALIDATION_ATTEMPTS,
          error: lastValidationError,
        },
      );

      // Corrective retry: show the model its invalid reply + the concrete
      // reason, and ask it to re-emit a schema-valid object.
      conversation = [
        ...conversation,
        { role: "assistant", content: JSON.stringify(llmResult.data) },
        {
          role: "user",
          content:
            `Your previous reply was invalid: ${lastValidationError}. ` +
            'Reply with ONLY a JSON object matching the required schema: a ' +
            'non-empty "message" string and a "toolCalls" array (use [] when ' +
            "no edit is needed). Do not include any text outside the JSON.",
        },
      ];
    }

    if (!validated) {
      throw upstreamError(
        `Chat reply failed schema validation after ${MAX_VALIDATION_ATTEMPTS} attempts: ${lastValidationError}`,
      );
    }

    const finalText = validated.message;
    const proposedEdit = validated.proposedEdit;
    const chunks = chunkText(finalText);

    for (const chunk of chunks) {
      if (controller.signal.aborted) {
        const cancelled = await jobChatRepo.updateMessage(assistantMessage.id, {
          content: accumulated,
          status: "cancelled",
          tokensIn: estimateTokenCount(options.prompt),
          tokensOut: estimateTokenCount(accumulated),
        });
        await jobChatRepo.completeRun(run.id, {
          status: "cancelled",
          errorCode: "REQUEST_TIMEOUT",
          errorMessage: "Generation cancelled by user",
        });
        options.stream?.onCancelled({ runId: run.id, message: cancelled });
        return {
          runId: run.id,
          messageId: assistantMessage.id,
          message: accumulated,
        };
      }

      accumulated += chunk;
      options.stream?.onDelta({
        runId: run.id,
        messageId: assistantMessage.id,
        delta: chunk,
      });
    }

    const completedMessage = await jobChatRepo.updateMessage(
      assistantMessage.id,
      {
        content: accumulated,
        status: "complete",
        tokensIn: estimateTokenCount(options.prompt),
        tokensOut: estimateTokenCount(accumulated),
        proposedEdit,
        editStatus: proposedEdit ? "pending" : null,
      },
    );

    await jobChatRepo.completeRun(run.id, {
      status: "completed",
    });

    options.stream?.onCompleted({
      runId: run.id,
      message: completedMessage,
    });

    return {
      runId: run.id,
      messageId: assistantMessage.id,
      message: accumulated,
    };
  } catch (error) {
    const appError = error instanceof Error ? error : new Error(String(error));
    const isCancelled =
      controller.signal.aborted || appError.name === "AbortError";
    const status = isCancelled ? "cancelled" : "failed";
    const code = isCancelled ? "REQUEST_TIMEOUT" : "UPSTREAM_ERROR";
    const message = isCancelled
      ? "Generation cancelled by user"
      : appError.message || "Generation failed";

    const failedMessage = await jobChatRepo.updateMessage(assistantMessage.id, {
      content: accumulated,
      status: isCancelled ? "cancelled" : "failed",
      tokensIn: estimateTokenCount(options.prompt),
      tokensOut: estimateTokenCount(accumulated),
    });

    await jobChatRepo.completeRun(run.id, {
      status,
      errorCode: code,
      errorMessage: message,
    });

    if (isCancelled) {
      options.stream?.onCancelled({ runId: run.id, message: failedMessage });
      return {
        runId: run.id,
        messageId: assistantMessage.id,
        message: accumulated,
      };
    }

    options.stream?.onError({
      runId: run.id,
      code,
      message,
      requestId,
    });

    throw upstreamError(message, { runId: run.id });
  } finally {
    abortControllers.delete(run.id);
    logger.info("Job chat run finished", {
      jobId: options.jobId,
      threadId: options.threadId,
      runId: run.id,
    });
  }
}

export async function sendMessage(input: {
  jobId: string;
  threadId: string;
  content: string;
  stream?: GenerateReplyOptions["stream"];
}) {
  const content = input.content.trim();
  if (!content) {
    throw badRequest("Message content is required");
  }

  const thread = await jobChatRepo.getThreadForJob(input.jobId, input.threadId);
  if (!thread) {
    throw notFound("Thread not found for this job");
  }

  // Determine parent: last message on the current active path
  const activePath = await jobChatRepo.getActivePathFromRoot(input.threadId);
  const parentId =
    activePath.length > 0 ? activePath[activePath.length - 1].id : null;

  const userMessage = await jobChatRepo.createMessage({
    threadId: input.threadId,
    jobId: input.jobId,
    role: "user",
    content,
    status: "complete",
    tokensIn: estimateTokenCount(content),
    tokensOut: null,
    parentMessageId: parentId,
  });

  // Update parent's activeChildId to point to this new user message
  if (parentId) {
    await jobChatRepo.setActiveChild(parentId, userMessage.id);
  } else {
    // First message in thread — set as active root
    await jobChatRepo.setActiveRoot(input.threadId, userMessage.id);
  }

  const result = await runAssistantReply({
    jobId: input.jobId,
    threadId: input.threadId,
    prompt: content,
    parentMessageId: userMessage.id,
    stream: input.stream,
  });

  // Update user message's activeChildId to point to the assistant reply
  await jobChatRepo.setActiveChild(userMessage.id, result.messageId);

  const assistantMessage = await jobChatRepo.getMessageById(result.messageId);
  return {
    userMessage,
    assistantMessage,
    runId: result.runId,
  };
}

export async function sendMessageForJob(input: {
  jobId: string;
  content: string;
  stream?: GenerateReplyOptions["stream"];
}) {
  const thread = await ensureJobThread(input.jobId);
  return sendMessage({
    jobId: input.jobId,
    threadId: thread.id,
    content: input.content,
    stream: input.stream,
  });
}

export async function regenerateMessage(input: {
  jobId: string;
  threadId: string;
  assistantMessageId: string;
  stream?: GenerateReplyOptions["stream"];
}) {
  const thread = await jobChatRepo.getThreadForJob(input.jobId, input.threadId);
  if (!thread) {
    throw notFound("Thread not found for this job");
  }

  const target = await jobChatRepo.getMessageById(input.assistantMessageId);
  if (
    !target ||
    target.threadId !== input.threadId ||
    target.jobId !== input.jobId
  ) {
    throw notFound("Assistant message not found for this thread");
  }

  if (target.role !== "assistant") {
    throw badRequest("Only assistant messages can be regenerated");
  }

  // Find the parent user message (the user message that prompted this assistant reply).
  // With branching, the parent is stored directly in parentMessageId.
  let parentUserMessage: JobChatMessage | null = null;
  if (target.parentMessageId) {
    parentUserMessage = await jobChatRepo.getMessageById(
      target.parentMessageId,
    );
  }

  // Fallback for legacy messages without parentMessageId: walk backwards in time
  if (!parentUserMessage || parentUserMessage.role !== "user") {
    const messages = await jobChatRepo.listMessagesForThread(input.threadId, {
      limit: 200,
    });
    const targetIndex = messages.findIndex(
      (message) => message.id === target.id,
    );
    parentUserMessage =
      targetIndex > 0
        ? ([...messages.slice(0, targetIndex)]
            .reverse()
            .find((message) => message.role === "user") ?? null)
        : null;
  }

  if (!parentUserMessage) {
    throw badRequest("Could not find a user message to regenerate from");
  }

  // Create a new sibling assistant message with the same parent (the user message)
  const result = await runAssistantReply({
    jobId: input.jobId,
    threadId: input.threadId,
    prompt: parentUserMessage.content,
    replaceMessageId: target.id,
    version: (target.version || 1) + 1,
    parentMessageId: parentUserMessage.id,
    stream: input.stream,
  });

  // Update parent's activeChildId to the new assistant message (switch to new branch)
  await jobChatRepo.setActiveChild(parentUserMessage.id, result.messageId);

  const assistantMessage = await jobChatRepo.getMessageById(result.messageId);

  return {
    runId: result.runId,
    assistantMessage,
  };
}

export async function regenerateMessageForJob(input: {
  jobId: string;
  assistantMessageId: string;
  stream?: GenerateReplyOptions["stream"];
}) {
  const thread = await ensureJobThread(input.jobId);
  return regenerateMessage({
    jobId: input.jobId,
    threadId: thread.id,
    assistantMessageId: input.assistantMessageId,
    stream: input.stream,
  });
}

export async function editMessage(input: {
  jobId: string;
  threadId: string;
  messageId: string;
  content: string;
  stream?: GenerateReplyOptions["stream"];
}) {
  const content = input.content.trim();
  if (!content) {
    throw badRequest("Message content is required");
  }

  const thread = await jobChatRepo.getThreadForJob(input.jobId, input.threadId);
  if (!thread) {
    throw notFound("Thread not found for this job");
  }

  const target = await jobChatRepo.getMessageById(input.messageId);
  if (
    !target ||
    target.threadId !== input.threadId ||
    target.jobId !== input.jobId
  ) {
    throw notFound("Message not found for this thread");
  }

  if (target.role !== "user") {
    throw badRequest("Only user messages can be edited");
  }

  // Create a new sibling user message (same parent as the original)
  const newUserMessage = await jobChatRepo.createMessage({
    threadId: input.threadId,
    jobId: input.jobId,
    role: "user",
    content,
    status: "complete",
    tokensIn: estimateTokenCount(content),
    tokensOut: null,
    parentMessageId: target.parentMessageId,
  });

  // Update the grandparent's activeChildId to point to the new user message
  if (target.parentMessageId) {
    await jobChatRepo.setActiveChild(target.parentMessageId, newUserMessage.id);
  } else {
    // Editing a root message — set the new message as active root
    await jobChatRepo.setActiveRoot(input.threadId, newUserMessage.id);
  }

  // Generate assistant reply as a child of the new user message
  const result = await runAssistantReply({
    jobId: input.jobId,
    threadId: input.threadId,
    prompt: content,
    parentMessageId: newUserMessage.id,
    stream: input.stream,
  });

  // Update new user message's activeChildId to the assistant reply
  await jobChatRepo.setActiveChild(newUserMessage.id, result.messageId);

  const assistantMessage = await jobChatRepo.getMessageById(result.messageId);
  return {
    userMessage: newUserMessage,
    assistantMessage,
    runId: result.runId,
  };
}

export async function editMessageForJob(input: {
  jobId: string;
  messageId: string;
  content: string;
  stream?: GenerateReplyOptions["stream"];
}) {
  const thread = await ensureJobThread(input.jobId);
  return editMessage({
    jobId: input.jobId,
    threadId: thread.id,
    messageId: input.messageId,
    content: input.content,
    stream: input.stream,
  });
}

export async function switchBranch(input: {
  jobId: string;
  threadId: string;
  messageId: string;
}): Promise<{ messages: JobChatMessage[]; branches: BranchInfo[] }> {
  const thread = await jobChatRepo.getThreadForJob(input.jobId, input.threadId);
  if (!thread) {
    throw notFound("Thread not found for this job");
  }

  const target = await jobChatRepo.getMessageById(input.messageId);
  if (
    !target ||
    target.threadId !== input.threadId ||
    target.jobId !== input.jobId
  ) {
    throw notFound("Message not found for this thread");
  }

  if (target.parentMessageId) {
    // Update the parent's activeChildId to point to this sibling
    await jobChatRepo.setActiveChild(target.parentMessageId, target.id);
  } else {
    // Switching between root messages
    await jobChatRepo.setActiveRoot(input.threadId, target.id);
  }

  // Return the updated active path
  return listMessages({
    jobId: input.jobId,
    threadId: input.threadId,
  });
}

export async function switchBranchForJob(input: {
  jobId: string;
  messageId: string;
}): Promise<{ messages: JobChatMessage[]; branches: BranchInfo[] }> {
  const thread = await ensureJobThread(input.jobId);
  return switchBranch({
    jobId: input.jobId,
    threadId: thread.id,
    messageId: input.messageId,
  });
}

export async function cancelRun(input: {
  jobId: string;
  threadId: string;
  runId: string;
}): Promise<{ cancelled: boolean; alreadyFinished: boolean }> {
  const run = await jobChatRepo.getRunById(input.runId);
  if (!run || run.threadId !== input.threadId || run.jobId !== input.jobId) {
    throw notFound("Run not found for this thread");
  }

  if (run.status !== "running") {
    return {
      cancelled: false,
      alreadyFinished: true,
    };
  }

  const controller = abortControllers.get(input.runId);
  if (controller) {
    controller.abort();
  }

  const runAfterCancel = await jobChatRepo.completeRunIfRunning(input.runId, {
    status: "cancelled",
    errorCode: "REQUEST_TIMEOUT",
    errorMessage: "Generation cancelled by user",
  });

  if (!runAfterCancel || runAfterCancel.status !== "cancelled") {
    return {
      cancelled: false,
      alreadyFinished: true,
    };
  }

  return {
    cancelled: true,
    alreadyFinished: false,
  };
}

export async function resetConversationForJob(input: {
  jobId: string;
}): Promise<{ deletedMessages: number; deletedRuns: number }> {
  const thread = await ensureJobThread(input.jobId);

  const activeRun = await jobChatRepo.getActiveRunForThread(thread.id);
  if (activeRun) {
    const controller = abortControllers.get(activeRun.id);
    if (controller) {
      controller.abort();
    }
    await jobChatRepo.completeRunIfRunning(activeRun.id, {
      status: "cancelled",
      errorCode: "REQUEST_TIMEOUT",
      errorMessage: "Conversation reset by user",
    });
  }

  const deletedMessages = await jobChatRepo.deleteAllMessagesForThread(
    thread.id,
  );
  const deletedRuns = await jobChatRepo.deleteAllRunsForThread(thread.id);

  logger.info("Ghostwriter conversation reset", {
    jobId: input.jobId,
    threadId: thread.id,
    deletedMessages,
    deletedRuns,
  });

  return { deletedMessages, deletedRuns };
}

export async function cancelRunForJob(input: {
  jobId: string;
  runId: string;
}): Promise<{ cancelled: boolean; alreadyFinished: boolean }> {
  const thread = await ensureJobThread(input.jobId);
  return cancelRun({
    jobId: input.jobId,
    threadId: thread.id,
    runId: input.runId,
  });
}
