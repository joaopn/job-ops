export interface ApiMeta {
  requestId: string;
  simulated?: boolean;
  blockedReason?: string;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResponse<T> =
  | {
      ok: true;
      data: T;
      meta?: ApiMeta;
    }
  | {
      ok: false;
      error: ApiErrorPayload;
      meta: ApiMeta;
    };

export type ExtractorHealthStatus = "healthy" | "unhealthy";

export interface ExtractorHealthResponse {
  source: import("../extractors").ExtractorSourceId;
  manifestId: string;
  capabilities?: import("./extractors").ExtractorCapabilities;
  status: ExtractorHealthStatus;
  checkedAt: string;
  durationMs: number;
  cacheAgeMs: number;
  jobsValidated: number;
  jobsReturned: number;
  searchTerm: string;
  cached: boolean;
  message: string;
}
