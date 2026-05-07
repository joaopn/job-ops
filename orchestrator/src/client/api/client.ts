/**
 * API client for the orchestrator backend.
 */

import { redirectToSignIn } from "@client/lib/auth-navigation";
import type { UpdateSettingsInput } from "@shared/settings-schema";
import type {
  ApiResponse,
  AppSettings,
  BatchUrlImportStreamEvent,
  BranchInfo,
  CreateJobNoteInput,
  CoverLetterDocument,
  CoverLetterDocumentSummary,
  CoverLetterUploadTemplateResponse,
  CvDocument,
  CvDocumentSummary,
  CvUploadTemplateResponse,
  Job,
  JobActionRequest,
  JobActionResponse,
  JobActionStreamEvent,
  JobChatMessage,
  JobChatStreamEvent,
  JobChatThread,
  JobListItem,
  JobNote,
  JobOutcome,
  JobSource,
  JobsListResponse,
  JobsRevisionResponse,
  LocationMatchStrictness,
  LocationSearchScope,
  ManualJobDraft,
  ManualJobFetchResponse,
  ManualJobInferenceResponse,
  PipelineRun,
  PipelineRunInsights,
  PipelineStatusResponse,
  SearchTermsSuggestionResponse,
  SuitabilityCategory,
  UpdateJobNoteInput,
  ValidationResult,
} from "@shared/types";

const API_BASE = "/api";

export class ApiClientError extends Error {
  requestId?: string;
  status?: number;
  code?: string;
  /** Server-supplied `error.details` payload from `{ ok: false }` responses. */
  details?: unknown;

  constructor(
    message: string,
    options?: {
      requestId?: string;
      status?: number;
      code?: string;
      details?: unknown;
    },
  ) {
    const requestId = options?.requestId;
    super(requestId ? `${message} (requestId: ${requestId})` : message);
    this.name = "ApiClientError";
    this.requestId = requestId;
    this.status = options?.status;
    this.code = options?.code;
    this.details = options?.details;
  }
}

type LegacyApiResponse<T> =
  | {
      success: true;
      data?: T;
      message?: string;
    }
  | {
      success: false;
      error?: string;
      message?: string;
      details?: unknown;
    };

type StreamSseInput =
  | JobActionRequest
  | { content: string; stream: true }
  | { stream: true }
  | { urls: string[] };

export type CodexAuthStatusResponse = {
  authenticated: boolean;
  username: string | null;
  validationMessage: string | null;
  flowStatus: string;
  loginInProgress: boolean;
  verificationUrl: string | null;
  userCode: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  flowMessage: string | null;
};

export type AuthCredentials = {
  username: string;
  password: string;
};

type StoredLegacyAuthCredentials = AuthCredentials & {
  storedAt?: number;
};

const LEGACY_SESSION_AUTH_KEY = "jobops.basicAuthCredentials";
const LEGACY_SESSION_JWT_KEY = "jobops.jwtToken";
const SESSION_AUTH_TOKEN_KEY = "jobops.authToken";
const LEGACY_SESSION_AUTH_TTL_MS = 5 * 60 * 1000;

function loadStoredLegacyCredentials(): AuthCredentials | null {
  try {
    const stored = sessionStorage.getItem(LEGACY_SESSION_AUTH_KEY);
    if (!stored) return null;
    // Migration credentials are one-shot: remove them from storage as soon as
    // we read them, then keep them only in memory for the upgrade attempt.
    sessionStorage.removeItem(LEGACY_SESSION_AUTH_KEY);

    const parsed = JSON.parse(stored) as StoredLegacyAuthCredentials;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.username !== "string" ||
      typeof parsed.password !== "string"
    ) {
      return null;
    }

    if (
      typeof parsed.storedAt === "number" &&
      Date.now() - parsed.storedAt > LEGACY_SESSION_AUTH_TTL_MS
    ) {
      return null;
    }

    return {
      username: parsed.username,
      password: parsed.password,
    };
  } catch {
    return null;
  }
}

function storeLegacyCredentials(credentials: AuthCredentials | null): void {
  try {
    if (credentials) {
      sessionStorage.setItem(
        LEGACY_SESSION_AUTH_KEY,
        JSON.stringify({
          ...credentials,
          storedAt: Date.now(),
        } satisfies StoredLegacyAuthCredentials),
      );
    } else {
      sessionStorage.removeItem(LEGACY_SESSION_AUTH_KEY);
    }
  } catch {
    // Ignore storage errors in restricted browser contexts.
  }
}

function loadStoredAuthToken(): string | null {
  try {
    return (
      sessionStorage.getItem(SESSION_AUTH_TOKEN_KEY) ??
      sessionStorage.getItem(LEGACY_SESSION_JWT_KEY)
    );
  } catch {
    return null;
  }
}

function storeAuthToken(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(SESSION_AUTH_TOKEN_KEY, token);
      sessionStorage.removeItem(LEGACY_SESSION_JWT_KEY);
    } else {
      sessionStorage.removeItem(SESSION_AUTH_TOKEN_KEY);
      sessionStorage.removeItem(LEGACY_SESSION_JWT_KEY);
    }
  } catch {
    // Ignore storage errors in restricted browser contexts.
  }
}

let cachedLegacyCredentials: AuthCredentials | null =
  loadStoredLegacyCredentials();
let cachedAuthToken: string | null = loadStoredAuthToken();
let authMigrationInFlight: Promise<boolean> | null = null;

export function clearAuthSession(): void {
  cachedLegacyCredentials = null;
  cachedAuthToken = null;
  storeLegacyCredentials(null);
  storeAuthToken(null);
}

function setAuthenticatedSession(token: string): void {
  cachedAuthToken = token;
  storeAuthToken(token);
  cachedLegacyCredentials = null;
  storeLegacyCredentials(null);
}

async function readAuthResponse<T>(
  response: Response,
): Promise<ApiResponse<T> | LegacyApiResponse<T>> {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ApiClientError(
      `Server error (${response.status}): Expected JSON but received HTML. Is the backend server running?`,
      { status: response.status },
    );
  }

  return normalizeApiResponse<T>(payload);
}

export async function signInWithCredentials(
  username: string,
  password: string,
): Promise<void> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const parsed = await readAuthResponse<{ token: string }>(res);
  if ("ok" in parsed) {
    if (!parsed.ok) {
      throw toApiError(res, parsed);
    }
  } else if (!parsed.success) {
    throw toApiError(res, parsed);
  }

  const token =
    "ok" in parsed
      ? parsed.data?.token
      : (parsed.data as { token?: string } | undefined)?.token;
  if (!token) {
    throw new Error("No token returned");
  }
  setAuthenticatedSession(token);
}

export async function restoreAuthSessionFromLegacyCredentials(): Promise<boolean> {
  if (cachedAuthToken) return true;
  if (!cachedLegacyCredentials) return false;
  if (!authMigrationInFlight) {
    const credentials = cachedLegacyCredentials;
    cachedLegacyCredentials = null;
    storeLegacyCredentials(null);
    authMigrationInFlight = (async () => {
      try {
        await signInWithCredentials(credentials.username, credentials.password);
        return true;
      } catch {
        return false;
      } finally {
        authMigrationInFlight = null;
      }
    })();
  }
  return authMigrationInFlight;
}

async function recoverAuthSessionFromUnauthorized(): Promise<string | null> {
  cachedAuthToken = null;
  storeAuthToken(null);

  const restored = await restoreAuthSessionFromLegacyCredentials();
  if (restored && cachedAuthToken) {
    return `Bearer ${cachedAuthToken}`;
  }

  clearAuthSession();
  redirectToSignIn();
  return null;
}

export async function recoverAuthHeaderAfterUnauthorized(): Promise<
  string | null
> {
  return recoverAuthSessionFromUnauthorized();
}

export async function logout(): Promise<void> {
  if (cachedAuthToken) {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${cachedAuthToken}` },
      });
    } catch {
      // Best-effort server-side invalidation.
    }
  }
  clearAuthSession();
  redirectToSignIn();
}

export function getCachedAuthHeader(): string | undefined {
  return cachedAuthToken ? `Bearer ${cachedAuthToken}` : undefined;
}

export function hasAuthenticatedSession(): boolean {
  return Boolean(cachedAuthToken);
}

export function __resetApiClientAuthForTests(): void {
  cachedLegacyCredentials = null;
  cachedAuthToken = null;
  authMigrationInFlight = null;
  storeLegacyCredentials(null);
  storeAuthToken(null);
}

export function __setLegacyAuthCredentialsForTests(
  credentials: AuthCredentials | null,
): void {
  cachedLegacyCredentials = credentials;
  storeLegacyCredentials(credentials);
}

export function __setAuthTokenForTests(token: string | null): void {
  cachedAuthToken = token;
  storeAuthToken(token);
}

function normalizeApiResponse<T>(
  payload: unknown,
): ApiResponse<T> | LegacyApiResponse<T> {
  if (!payload || typeof payload !== "object") {
    throw new ApiClientError("API request failed: malformed JSON response");
  }
  const response = payload as Record<string, unknown>;
  if (typeof response.ok === "boolean") {
    return payload as ApiResponse<T>;
  }
  if (typeof response.success === "boolean") {
    return payload as LegacyApiResponse<T>;
  }
  throw new ApiClientError("API request failed: unexpected response shape");
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const next: Record<string, string> = {};
    headers.forEach((value, key) => {
      next[key] = value;
    });
    return next;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}

function isUnauthorizedResponse<T>(
  response: Response,
  parsed: ApiResponse<T> | LegacyApiResponse<T>,
): boolean {
  if (response.status !== 401) return false;
  if ("ok" in parsed) {
    return parsed.ok ? false : parsed.error.code === "UNAUTHORIZED";
  }
  return !parsed.success;
}

function toApiError<T>(
  response: Response,
  parsed: ApiResponse<T> | LegacyApiResponse<T>,
): ApiClientError {
  if ("ok" in parsed) {
    if (!parsed.ok) {
      return new ApiClientError(parsed.error.message || "API request failed", {
        requestId: parsed.meta?.requestId,
        status: response.status,
        code: parsed.error.code,
        details: parsed.error.details,
      });
    }
    return new ApiClientError("API request failed", {
      requestId: parsed.meta?.requestId,
      status: response.status,
    });
  }
  if (parsed.success) {
    return new ApiClientError(parsed.message || "API request failed", {
      status: response.status,
    });
  }
  return new ApiClientError(
    parsed.error || parsed.message || "API request failed",
    {
      status: response.status,
      details: parsed.details,
    },
  );
}

async function fetchAndParse<T>(
  endpoint: string,
  options: RequestInit | undefined,
  authHeader?: string,
): Promise<{
  response: Response;
  parsed: ApiResponse<T> | LegacyApiResponse<T>;
}> {
  const isFormData =
    typeof FormData !== "undefined" && options?.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...normalizeHeaders(options?.headers),
  };
  if (authHeader) headers.Authorization = authHeader;
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const text = await response.text();

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    // If the response is not JSON, it's likely an HTML error page.
    throw new ApiClientError(
      `Server error (${response.status}): Expected JSON but received HTML. Is the backend server running?`,
      { status: response.status },
    );
  }
  const parsed = normalizeApiResponse<T>(payload);
  return { response, parsed };
}

function getAuthHeader(): string | undefined {
  return getCachedAuthHeader();
}

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  let authHeader = getAuthHeader();
  let authAttempt = 0;

  while (true) {
    const { response, parsed } = await fetchAndParse(
      endpoint,
      options,
      authHeader,
    );

    if (isUnauthorizedResponse(response, parsed) && authAttempt < 1) {
      const recoveredAuthHeader = await recoverAuthSessionFromUnauthorized();
      if (!recoveredAuthHeader) {
        throw toApiError(response, parsed);
      }
      authHeader = recoveredAuthHeader;
      authAttempt += 1;
      continue;
    }

    if ("ok" in parsed) {
      if (!parsed.ok) {
        if (parsed.error.code === "UNAUTHORIZED") {
          clearAuthSession();
          redirectToSignIn();
        }
        throw toApiError(response, parsed);
      }
      return parsed.data as T;
    }

    if (!parsed.success) {
      if (response.status === 401) {
        clearAuthSession();
        redirectToSignIn();
      }
      throw toApiError(response, parsed);
    }

    const data = parsed.data;
    if (data !== undefined) return data as T;
    if (parsed.message !== undefined) return { message: parsed.message } as T;
    return null as T;
  }
}

// Jobs API
export function getJobs(): Promise<JobsListResponse<JobListItem>>;
export function getJobs(options: {
  statuses?: string[];
  view?: "list";
}): Promise<JobsListResponse<JobListItem>>;
export function getJobs(options?: {
  statuses?: string[];
  view: "full";
}): Promise<JobsListResponse<Job>>;
export async function getJobs(options?: {
  statuses?: string[];
  view?: "full" | "list";
}): Promise<JobsListResponse<Job> | JobsListResponse<JobListItem>> {
  const params = new URLSearchParams();
  if (options?.statuses?.length)
    params.set("status", options.statuses.join(","));
  if (options?.view) params.set("view", options.view);
  const query = params.toString();
  return fetchApi<JobsListResponse<Job> | JobsListResponse<JobListItem>>(
    `/jobs${query ? `?${query}` : ""}`,
  );
}

export async function getJobsRevision(options?: {
  statuses?: string[];
}): Promise<JobsRevisionResponse> {
  const params = new URLSearchParams();
  if (options?.statuses?.length)
    params.set("status", options.statuses.join(","));
  const query = params.toString();
  return fetchApi<JobsRevisionResponse>(
    `/jobs/revision${query ? `?${query}` : ""}`,
  );
}

export async function getJob(id: string): Promise<Job> {
  return fetchApi<Job>(`/jobs/${id}?t=${Date.now()}`);
}

export async function updateJob(
  id: string,
  update: Partial<Job>,
): Promise<Job> {
  return fetchApi<Job>(`/jobs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(update),
  });
}

export async function getJobNotes(id: string): Promise<JobNote[]> {
  return fetchApi<JobNote[]>(`/jobs/${id}/notes?t=${Date.now()}`);
}

export async function createJobNote(
  jobId: string,
  input: CreateJobNoteInput,
): Promise<JobNote> {
  return fetchApi<JobNote>(`/jobs/${jobId}/notes`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateJobNote(
  jobId: string,
  noteId: string,
  input: UpdateJobNoteInput,
): Promise<JobNote> {
  return fetchApi<JobNote>(`/jobs/${jobId}/notes/${noteId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteJobNote(
  jobId: string,
  noteId: string,
): Promise<void> {
  await fetchApi<void>(`/jobs/${jobId}/notes/${noteId}`, {
    method: "DELETE",
  });
}

async function streamSseEvents<TEvent>(
  endpoint: string,
  input: StreamSseInput,
  handlers: {
    onEvent: (event: TEvent) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const streamAuth = getAuthHeader();
  if (streamAuth) {
    headers.Authorization = streamAuth;
  }

  let response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
    signal: handlers.signal,
  });

  if (response.status === 401) {
    const recoveredAuthHeader = await recoverAuthSessionFromUnauthorized();
    if (recoveredAuthHeader) {
      response = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: {
          ...headers,
          Authorization: recoveredAuthHeader,
        },
        body: JSON.stringify(input),
        signal: handlers.signal,
      });
    }
  }

  if (!response.ok) {
    let errorMessage = `Stream request failed with status ${response.status}`;
    try {
      const payload = await response.json();
      const parsed = normalizeApiResponse(payload);
      if ("ok" in parsed && !parsed.ok) {
        errorMessage = parsed.error.message || errorMessage;
      }
    } catch {
      // ignore parse errors; keep status-based message
    }
    throw new ApiClientError(errorMessage, {
      status: response.status,
    });
  }

  if (!response.body) {
    throw new ApiClientError("Streaming not supported by this browser");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex !== -1) {
        const frame = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const dataLines = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .filter(Boolean);

        for (const line of dataLines) {
          let parsedEvent: TEvent;
          try {
            parsedEvent = JSON.parse(line) as TEvent;
          } catch {
            // Ignore malformed events to keep stream resilient
            continue;
          }
          handlers.onEvent(parsedEvent);
        }
        separatorIndex = buffer.indexOf("\n\n");
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore cancellation errors when stream is already closed
    }
  }
}

export async function listJobChatThreads(jobId: string): Promise<{
  threads: JobChatThread[];
}> {
  return fetchApi<{ threads: JobChatThread[] }>(`/jobs/${jobId}/chat/threads`);
}

export async function listJobGhostwriterMessages(
  jobId: string,
  options?: { limit?: number; offset?: number },
): Promise<{ messages: JobChatMessage[]; branches: BranchInfo[] }> {
  const params = new URLSearchParams();
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  if (typeof options?.offset === "number") {
    params.set("offset", String(options.offset));
  }
  const query = params.toString();
  return fetchApi<{ messages: JobChatMessage[]; branches: BranchInfo[] }>(
    `/jobs/${jobId}/chat/messages${query ? `?${query}` : ""}`,
  );
}

export async function createJobChatThread(
  jobId: string,
  input?: { title?: string | null },
): Promise<{ thread: JobChatThread }> {
  return fetchApi<{ thread: JobChatThread }>(`/jobs/${jobId}/chat/threads`, {
    method: "POST",
    body: JSON.stringify({
      title: input?.title ?? null,
    }),
  });
}

export async function listJobChatMessages(
  jobId: string,
  threadId: string,
  options?: { limit?: number; offset?: number },
): Promise<{ messages: JobChatMessage[] }> {
  const params = new URLSearchParams();
  if (typeof options?.limit === "number") {
    params.set("limit", String(options.limit));
  }
  if (typeof options?.offset === "number") {
    params.set("offset", String(options.offset));
  }
  const query = params.toString();
  return fetchApi<{ messages: JobChatMessage[] }>(
    `/jobs/${jobId}/chat/threads/${threadId}/messages${query ? `?${query}` : ""}`,
  );
}

export async function sendJobChatMessage(
  jobId: string,
  threadId: string,
  input: { content: string },
): Promise<{
  userMessage: JobChatMessage;
  assistantMessage: JobChatMessage | null;
  runId: string;
}> {
  return fetchApi<{
    userMessage: JobChatMessage;
    assistantMessage: JobChatMessage | null;
    runId: string;
  }>(`/jobs/${jobId}/chat/threads/${threadId}/messages`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function streamJobChatMessage(
  jobId: string,
  threadId: string,
  input: { content: string; signal?: AbortSignal },
  handlers: {
    onEvent: (event: JobChatStreamEvent) => void;
  },
): Promise<void> {
  return streamSseEvents(
    `/jobs/${jobId}/chat/threads/${threadId}/messages`,
    { content: input.content, stream: true },
    {
      onEvent: handlers.onEvent,
      signal: input.signal,
    },
  );
}

export async function streamJobGhostwriterMessage(
  jobId: string,
  input: { content: string; signal?: AbortSignal },
  handlers: {
    onEvent: (event: JobChatStreamEvent) => void;
  },
): Promise<void> {
  return streamSseEvents(
    `/jobs/${jobId}/chat/messages`,
    { content: input.content, stream: true },
    {
      onEvent: handlers.onEvent,
      signal: input.signal,
    },
  );
}

export async function cancelJobChatRun(
  jobId: string,
  threadId: string,
  runId: string,
): Promise<{ cancelled: boolean; alreadyFinished: boolean }> {
  return fetchApi<{ cancelled: boolean; alreadyFinished: boolean }>(
    `/jobs/${jobId}/chat/threads/${threadId}/runs/${runId}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function resetJobGhostwriterConversation(
  jobId: string,
): Promise<{ deletedMessages: number; deletedRuns: number }> {
  return fetchApi<{ deletedMessages: number; deletedRuns: number }>(
    `/jobs/${jobId}/chat/reset`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function cancelJobGhostwriterRun(
  jobId: string,
  runId: string,
): Promise<{ cancelled: boolean; alreadyFinished: boolean }> {
  return fetchApi<{ cancelled: boolean; alreadyFinished: boolean }>(
    `/jobs/${jobId}/chat/runs/${runId}/cancel`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function regenerateJobChatMessage(
  jobId: string,
  threadId: string,
  assistantMessageId: string,
): Promise<{ runId: string; assistantMessage: JobChatMessage | null }> {
  return fetchApi<{ runId: string; assistantMessage: JobChatMessage | null }>(
    `/jobs/${jobId}/chat/threads/${threadId}/messages/${assistantMessageId}/regenerate`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function streamRegenerateJobChatMessage(
  jobId: string,
  threadId: string,
  assistantMessageId: string,
  input: { signal?: AbortSignal },
  handlers: {
    onEvent: (event: JobChatStreamEvent) => void;
  },
): Promise<void> {
  return streamSseEvents(
    `/jobs/${jobId}/chat/threads/${threadId}/messages/${assistantMessageId}/regenerate`,
    { stream: true },
    {
      onEvent: handlers.onEvent,
      signal: input.signal,
    },
  );
}

export async function streamRegenerateJobGhostwriterMessage(
  jobId: string,
  assistantMessageId: string,
  input: { signal?: AbortSignal },
  handlers: {
    onEvent: (event: JobChatStreamEvent) => void;
  },
): Promise<void> {
  return streamSseEvents(
    `/jobs/${jobId}/chat/messages/${assistantMessageId}/regenerate`,
    { stream: true },
    {
      onEvent: handlers.onEvent,
      signal: input.signal,
    },
  );
}

export async function editJobGhostwriterMessage(
  jobId: string,
  messageId: string,
  input: { content: string; signal?: AbortSignal },
  handlers: {
    onEvent: (event: JobChatStreamEvent) => void;
  },
): Promise<void> {
  return streamSseEvents(
    `/jobs/${jobId}/chat/messages/${messageId}/edit`,
    { content: input.content, stream: true },
    {
      onEvent: handlers.onEvent,
      signal: input.signal,
    },
  );
}

export async function switchJobGhostwriterBranch(
  jobId: string,
  messageId: string,
): Promise<{ messages: JobChatMessage[]; branches: BranchInfo[] }> {
  return fetchApi<{ messages: JobChatMessage[]; branches: BranchInfo[] }>(
    `/jobs/${jobId}/chat/messages/${messageId}/switch-branch`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

function toJobIdList(idOrIds: string | string[]): string[] {
  return Array.isArray(idOrIds) ? idOrIds : [idOrIds];
}

export async function processJob(
  ids: string[],
  options?: { force?: boolean },
): Promise<JobActionResponse>;
export async function processJob(
  id: string,
  options?: { force?: boolean },
): Promise<Job>;
export async function processJob(
  idOrIds: string | string[],
  options?: { force?: boolean },
): Promise<Job | JobActionResponse> {
  const jobIds = toJobIdList(idOrIds);
  const result = await runJobAction({
    action: "move_to_ready",
    jobIds,
    ...(options?.force ? { options: { force: true } } : {}),
  });

  if (Array.isArray(idOrIds)) return result;
  return getSingleJobFromActionResult(result, idOrIds);
}

export async function rescoreJob(ids: string[]): Promise<JobActionResponse>;
export async function rescoreJob(id: string): Promise<Job>;
export async function rescoreJob(
  idOrIds: string | string[],
): Promise<Job | JobActionResponse> {
  const jobIds = toJobIdList(idOrIds);
  const result = await runJobAction({
    action: "rescore",
    jobIds,
  });
  if (Array.isArray(idOrIds)) return result;
  return getSingleJobFromActionResult(result, idOrIds);
}

export async function summarizeJob(
  id: string,
  options?: { force?: boolean },
): Promise<Job> {
  const query = options?.force ? "?force=1" : "";
  return fetchApi<Job>(`/jobs/${id}/summarize${query}`, {
    method: "POST",
  });
}

export async function generateJobPdf(id: string): Promise<Job> {
  return fetchApi<Job>(`/jobs/${id}/generate-pdf`, {
    method: "POST",
  });
}

export async function reTailorJob(id: string): Promise<Job> {
  return fetchApi<Job>(`/jobs/${id}/re-tailor`, {
    method: "POST",
  });
}

export async function generateCoverLetter(id: string): Promise<Job> {
  return fetchApi<Job>(`/jobs/${id}/generate-cover-letter`, {
    method: "POST",
  });
}

export async function renderCoverLetterPdf(id: string): Promise<Job> {
  return fetchApi<Job>(`/jobs/${id}/render-cover-letter`, {
    method: "POST",
  });
}

export type AcceptEditResponse =
  | { kind: "cv-edit"; message: JobChatMessage; job: Job }
  | { kind: "brief-edit"; message: JobChatMessage; cv: CvDocument };

export async function acceptJobChatEdit(
  jobId: string,
  messageId: string,
): Promise<AcceptEditResponse> {
  return fetchApi<AcceptEditResponse>(
    `/jobs/${jobId}/chat/messages/${messageId}/accept-edit`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function rejectJobChatEdit(
  jobId: string,
  messageId: string,
): Promise<{ message: JobChatMessage }> {
  return fetchApi<{ message: JobChatMessage }>(
    `/jobs/${jobId}/chat/messages/${messageId}/reject-edit`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
  );
}

export async function markAsApplied(id: string): Promise<Job> {
  return fetchApi<Job>(`/jobs/${id}/apply`, {
    method: "POST",
  });
}

export async function skipJob(ids: string[]): Promise<JobActionResponse>;
export async function skipJob(id: string): Promise<Job>;
export async function skipJob(
  idOrIds: string | string[],
): Promise<Job | JobActionResponse> {
  const jobIds = toJobIdList(idOrIds);
  const result = await runJobAction({
    action: "skip",
    jobIds,
  });
  if (Array.isArray(idOrIds)) return result;
  return getSingleJobFromActionResult(result, idOrIds);
}

export async function runJobAction(
  input: JobActionRequest,
): Promise<JobActionResponse> {
  return fetchApi<JobActionResponse>("/jobs/actions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

function getSingleJobFromActionResult(
  response: JobActionResponse,
  jobId: string,
): Job {
  const result = response.results.find((entry) => entry.jobId === jobId);
  if (!result) {
    throw new ApiClientError("Job action did not return a result for the job");
  }
  if (!result.ok) {
    throw new ApiClientError(result.error.message, {
      code: result.error.code,
    });
  }
  return result.job;
}

export async function streamJobAction(
  input: JobActionRequest,
  handlers: {
    onEvent: (event: JobActionStreamEvent) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  return streamSseEvents<JobActionStreamEvent>(
    "/jobs/actions/stream",
    input,
    handlers,
  );
}

export async function updateJobOutcome(
  id: string,
  input: { outcome: JobOutcome | null; closedAt?: number | null },
): Promise<Job> {
  return fetchApi<Job>(`/jobs/${id}/outcome`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

// Pipeline API
export async function getPipelineStatus(): Promise<PipelineStatusResponse> {
  return fetchApi<PipelineStatusResponse>("/pipeline/status");
}

export async function getPipelineRuns(): Promise<PipelineRun[]> {
  return fetchApi<PipelineRun[]>("/pipeline/runs");
}

export async function getPipelineRunInsights(
  id: string,
): Promise<PipelineRunInsights> {
  return fetchApi<PipelineRunInsights>(
    `/pipeline/runs/${encodeURIComponent(id)}/insights`,
  );
}

export async function runPipeline(config?: {
  topN?: number;
  minSuitabilityCategory?: SuitabilityCategory;
  sources?: JobSource[];
  runBudget?: number;
  searchTerms?: string[];
  country?: string;
  cityLocations?: string[];
  workplaceTypes?: Array<"remote" | "hybrid" | "onsite">;
  searchScope?: LocationSearchScope;
  matchStrictness?: LocationMatchStrictness;
}): Promise<{ message: string }> {
  return fetchApi<{ message: string }>("/pipeline/run", {
    method: "POST",
    body: JSON.stringify(config || {}),
  });
}

export async function cancelPipeline(): Promise<{
  message: string;
  pipelineRunId: string | null;
  alreadyRequested: boolean;
}> {
  return fetchApi<{
    message: string;
    pipelineRunId: string | null;
    alreadyRequested: boolean;
  }>("/pipeline/cancel", {
    method: "POST",
  });
}

// Manual Job Import API
export async function fetchJobFromUrl(input: {
  url: string;
}): Promise<ManualJobFetchResponse> {
  return fetchApi<ManualJobFetchResponse>("/manual-jobs/fetch", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function inferManualJob(input: {
  jobDescription: string;
}): Promise<ManualJobInferenceResponse> {
  return fetchApi<ManualJobInferenceResponse>("/manual-jobs/infer", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function importManualJob(input: {
  job: ManualJobDraft;
}): Promise<Job> {
  return fetchApi<Job>("/manual-jobs/import", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function streamBatchUrlImport(
  input: { urls: string[] },
  handlers: {
    onEvent: (event: BatchUrlImportStreamEvent) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  return streamSseEvents<BatchUrlImportStreamEvent>(
    "/manual-jobs/import-batch/stream",
    input,
    handlers,
  );
}

// Settings & Profile API
let settingsPromise: Promise<AppSettings> | null = null;

export async function getSettings(): Promise<AppSettings> {
  if (settingsPromise) return settingsPromise;

  settingsPromise = fetchApi<AppSettings>("/settings").finally(() => {
    // Clear the promise after a short delay to allow subsequent fresh fetches
    // but coalesce simultaneous requests.
    setTimeout(() => {
      settingsPromise = null;
    }, 100);
  });

  return settingsPromise;
}

export async function listCvDocuments(): Promise<CvDocumentSummary[]> {
  return fetchApi<CvDocumentSummary[]>("/cv");
}

export async function getCvDocument(id: string): Promise<CvDocument> {
  return fetchApi<CvDocument>(`/cv/${id}`);
}

export async function uploadCvDocument(args: {
  file: Blob;
  filename: string;
  name?: string;
}): Promise<CvDocument> {
  const form = new FormData();
  form.append("file", args.file, args.filename);
  if (args.name) form.append("name", args.name);
  return fetchApi<CvDocument>("/cv", { method: "POST", body: form });
}

export async function updateCvDocument(
  id: string,
  input: Partial<{
    name: string;
    personalBrief: string;
    extractionPrompt: string;
  }>,
): Promise<CvDocument> {
  return fetchApi<CvDocument>(`/cv/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteCvDocument(
  id: string,
): Promise<{ deleted: number }> {
  return fetchApi<{ deleted: number }>(`/cv/${id}`, { method: "DELETE" });
}

export async function reExtractCvDocument(id: string): Promise<CvDocument> {
  return fetchApi<CvDocument>(`/cv/${id}/re-extract`, { method: "POST" });
}

/**
 * 5e gated upload: POSTs the file to /api/cv/upload-template, which runs
 * the templated-tex pipeline (compile original → LLM extract loop →
 * compile substituted → pdftotext diff) and only persists if every gate
 * passes. Returns the persisted CV + per-attempt log on success; rejects
 * with the per-attempt log in `details.attempts` on failure.
 */
export async function uploadCvDocumentTemplate(args: {
  file: Blob;
  filename: string;
  name?: string;
  maxRetries?: number;
  extractionPrompt?: string;
}): Promise<CvUploadTemplateResponse> {
  const form = new FormData();
  form.append("file", args.file, args.filename);
  if (args.name) form.append("name", args.name);
  if (args.maxRetries !== undefined) {
    form.append("maxRetries", String(args.maxRetries));
  }
  if (args.extractionPrompt !== undefined) {
    form.append("extractionPrompt", args.extractionPrompt);
  }
  return fetchApi<CvUploadTemplateResponse>("/cv/upload-template", {
    method: "POST",
    body: form,
  });
}

export async function reExtractCvDocumentTemplate(
  id: string,
  options?: { maxRetries?: number; extractionPrompt?: string },
): Promise<CvUploadTemplateResponse> {
  return fetchApi<CvUploadTemplateResponse>(
    `/cv/${id}/re-extract-template`,
    {
      method: "POST",
      body: JSON.stringify(options ?? {}),
    },
  );
}

/**
 * 5e.3a: returns the server's default extraction system prompt. Used by
 * the CV page to pre-fill the per-CV prompt textarea.
 */
export async function fetchExtractionPromptDefault(): Promise<string> {
  const result = await fetchApi<{ prompt: string }>(
    "/cv/extraction-prompt-default",
  );
  return result.prompt;
}

export async function listCoverLetters(): Promise<CoverLetterDocumentSummary[]> {
  return fetchApi<CoverLetterDocumentSummary[]>("/coverletter");
}

export async function getCoverLetter(id: string): Promise<CoverLetterDocument> {
  return fetchApi<CoverLetterDocument>(`/coverletter/${id}`);
}

export async function updateCoverLetter(
  id: string,
  input: Partial<{ name: string; extractionPrompt: string }>,
): Promise<CoverLetterDocument> {
  return fetchApi<CoverLetterDocument>(`/coverletter/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteCoverLetter(
  id: string,
): Promise<{ deleted: number }> {
  return fetchApi<{ deleted: number }>(`/coverletter/${id}`, {
    method: "DELETE",
  });
}

/**
 * 5h gated upload: POSTs the file to /api/coverletter/upload-template,
 * which runs the templated-tex pipeline (compile original → LLM extract
 * loop with body-field-count check → compile substituted → pdftotext
 * diff) and only persists if every gate passes.
 */
export async function uploadCoverLetterTemplate(args: {
  file: Blob;
  filename: string;
  name?: string;
  maxRetries?: number;
  extractionPrompt?: string;
}): Promise<CoverLetterUploadTemplateResponse> {
  const form = new FormData();
  form.append("file", args.file, args.filename);
  if (args.name) form.append("name", args.name);
  if (args.maxRetries !== undefined) {
    form.append("maxRetries", String(args.maxRetries));
  }
  if (args.extractionPrompt !== undefined) {
    form.append("extractionPrompt", args.extractionPrompt);
  }
  return fetchApi<CoverLetterUploadTemplateResponse>(
    "/coverletter/upload-template",
    {
      method: "POST",
      body: form,
    },
  );
}

export async function reExtractCoverLetterTemplate(
  id: string,
  options?: { maxRetries?: number; extractionPrompt?: string },
): Promise<CoverLetterUploadTemplateResponse> {
  return fetchApi<CoverLetterUploadTemplateResponse>(
    `/coverletter/${id}/re-extract-template`,
    {
      method: "POST",
      body: JSON.stringify(options ?? {}),
    },
  );
}

export async function fetchCoverLetterExtractionPromptDefault(): Promise<string> {
  const result = await fetchApi<{ prompt: string }>(
    "/coverletter/extraction-prompt-default",
  );
  return result.prompt;
}

export async function validateLlm(input: {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<ValidationResult> {
  return fetchApi<ValidationResult>("/onboarding/validate/llm", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getLlmModels(input?: {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
}): Promise<string[]> {
  const data = await fetchApi<{ models: string[] }>("/settings/llm-models", {
    method: "POST",
    body: JSON.stringify(input ?? {}),
  });
  return data.models;
}

export async function getCodexAuthStatus(): Promise<CodexAuthStatusResponse> {
  return fetchApi<CodexAuthStatusResponse>("/settings/codex-auth");
}

export async function startCodexAuth(input?: {
  forceRestart?: boolean;
}): Promise<CodexAuthStatusResponse> {
  return fetchApi<CodexAuthStatusResponse>("/settings/codex-auth/start", {
    method: "POST",
    body: JSON.stringify({
      forceRestart: input?.forceRestart ?? false,
    }),
  });
}

export async function disconnectCodexAuth(): Promise<CodexAuthStatusResponse> {
  return fetchApi<CodexAuthStatusResponse>("/settings/codex-auth/disconnect", {
    method: "POST",
  });
}

export async function suggestOnboardingSearchTerms(): Promise<SearchTermsSuggestionResponse> {
  return fetchApi<SearchTermsSuggestionResponse>(
    "/onboarding/search-terms/suggest",
    {
      method: "POST",
    },
  );
}

export async function updateSettings(
  update: Partial<UpdateSettingsInput>,
): Promise<AppSettings> {
  return fetchApi<AppSettings>("/settings", {
    method: "PATCH",
    body: JSON.stringify(update),
  });
}

// Prompts API
export interface PromptDescriptor {
  name: string;
  path: string;
  description: string;
  modifiedAt: string;
}

export async function listPrompts(): Promise<PromptDescriptor[]> {
  const result = await fetchApi<{ prompts: PromptDescriptor[] }>("/prompts");
  return result.prompts;
}

export async function reloadPrompt(name?: string): Promise<{ reloaded: string }> {
  return fetchApi<{ reloaded: string }>("/prompts/reload", {
    method: "POST",
    body: JSON.stringify(name ? { name } : {}),
  });
}

// Database API
export async function clearDatabase(): Promise<{
  message: string;
  jobsDeleted: number;
  runsDeleted: number;
}> {
  return fetchApi<{
    message: string;
    jobsDeleted: number;
    runsDeleted: number;
  }>("/database", {
    method: "DELETE",
  });
}

export async function deleteJobsByStatus(status: string): Promise<{
  message: string;
  count: number;
}> {
  return fetchApi<{
    message: string;
    count: number;
  }>(`/jobs/status/${status}`, {
    method: "DELETE",
  });
}

export async function deleteJobsByCategory(
  category: SuitabilityCategory,
): Promise<{
  message: string;
  count: number;
  category: SuitabilityCategory;
}> {
  return fetchApi<{
    message: string;
    count: number;
    category: SuitabilityCategory;
  }>(`/jobs/category/${encodeURIComponent(category)}`, {
    method: "DELETE",
  });
}

// Multi-job operations (intentionally none - processing is manual)
