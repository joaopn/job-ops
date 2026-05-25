import { logger } from "@infra/logger";

export interface RunActorArgs {
  token: string;
  actorRef: string;
  input: unknown;
  /** Apify sync-call max timeout: ~300s. Pass 0 to use the platform default. */
  timeoutSec?: number;
  signal?: AbortSignal;
}

export class ApifyApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "ApifyApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

const APIFY_BASE = "https://api.apify.com/v2";

function normalizeActorPath(actorRef: string): string {
  // Apify accepts both "username/actor-name" and "actorId". Tilde is the
  // URL-safe separator they document for usernames containing "/" in the
  // path. Replace / with ~ if present so we don't accidentally inject
  // sub-paths.
  return actorRef.replace(/\//g, "~");
}

export async function runApifyActor(
  args: RunActorArgs,
): Promise<unknown[]> {
  const { token, actorRef, input, timeoutSec, signal } = args;
  if (!token) {
    throw new ApifyApiError("Apify API token not configured", 401, false);
  }

  const actorPath = normalizeActorPath(actorRef);
  const url = new URL(
    `${APIFY_BASE}/acts/${actorPath}/run-sync-get-dataset-items`,
  );
  url.searchParams.set("token", token);
  if (timeoutSec && timeoutSec > 0) {
    url.searchParams.set("timeout", String(Math.min(timeoutSec, 300)));
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ApifyApiError(`Network error: ${message}`, 0, true);
  }

  if (!response.ok) {
    const status = response.status;
    let text = "";
    try {
      text = await response.text();
    } catch {
      // ignore body parse failure
    }
    const truncated = text.slice(0, 500);
    const retryable = status >= 500;
    logger.warn("Apify actor call failed", {
      actorRef,
      status,
      bodyPreview: truncated,
    });
    throw new ApifyApiError(
      `Apify ${status}: ${truncated || response.statusText}`,
      status,
      retryable,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new ApifyApiError(
      `Apify response was not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      response.status,
      false,
    );
  }

  if (!Array.isArray(body)) {
    throw new ApifyApiError(
      "Apify response was not a dataset array",
      response.status,
      false,
    );
  }

  return body;
}
