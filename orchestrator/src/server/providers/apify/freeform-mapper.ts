import type { CreateJobInput, JobSource } from "@shared/types";

export interface FreeformMappingSpec {
  // Required fields:
  jobUrl: string;
  title: string;
  // Optional fields — empty path means "skip":
  employer?: string;
  location?: string;
  jobDescription?: string;
  datePosted?: string;
  isRemote?: string;
  applicationLink?: string;
  salary?: string;
  jobLevel?: string;
  jobType?: string;
}

export class FreeformMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FreeformMappingError";
  }
}

const REQUIRED_KEYS: ReadonlyArray<keyof FreeformMappingSpec> = [
  "jobUrl",
  "title",
];

export function parseMappingSpec(raw: string): FreeformMappingSpec {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch (error) {
    throw new FreeformMappingError(
      `Output mapping is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FreeformMappingError("Output mapping must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  for (const key of REQUIRED_KEYS) {
    const value = obj[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new FreeformMappingError(
        `Output mapping is missing required path for "${key}"`,
      );
    }
  }
  const spec: FreeformMappingSpec = { jobUrl: "", title: "" };
  const writable = spec as unknown as Record<string, string>;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && value.length > 0) {
      writable[key] = value;
    }
  }
  return spec;
}

function readPath(item: unknown, path: string): unknown {
  const segments = path.split(".").map((s) => s.trim()).filter(Boolean);
  let cursor: unknown = item;
  for (const segment of segments) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true" || lower === "yes" || lower === "remote") return true;
    if (lower === "false" || lower === "no" || lower === "onsite") return false;
  }
  return undefined;
}

export interface ApplyMappingArgs {
  spec: FreeformMappingSpec;
  item: unknown;
  sourceId: JobSource;
}

export function applyFreeformMapping(
  args: ApplyMappingArgs,
): CreateJobInput | null {
  const { spec, item, sourceId } = args;
  if (!item || typeof item !== "object") return null;

  const jobUrl = asNonEmptyString(readPath(item, spec.jobUrl));
  const title = asNonEmptyString(readPath(item, spec.title));
  if (!jobUrl || !title) return null;

  const employer =
    asNonEmptyString(spec.employer ? readPath(item, spec.employer) : undefined) ??
    "Unknown";

  const result: CreateJobInput = {
    source: sourceId,
    title,
    employer,
    jobUrl,
  };

  if (spec.location) {
    const v = asNonEmptyString(readPath(item, spec.location));
    if (v) result.location = v;
  }
  if (spec.jobDescription) {
    const v = asNonEmptyString(readPath(item, spec.jobDescription));
    if (v) result.jobDescription = v;
  }
  if (spec.datePosted) {
    const v = asNonEmptyString(readPath(item, spec.datePosted));
    if (v) result.datePosted = v;
  }
  if (spec.isRemote) {
    const v = asBoolean(readPath(item, spec.isRemote));
    if (v !== undefined) result.isRemote = v;
  }
  if (spec.applicationLink) {
    const v = asNonEmptyString(readPath(item, spec.applicationLink));
    if (v) result.applicationLink = v;
  }
  if (spec.salary) {
    const v = asNonEmptyString(readPath(item, spec.salary));
    if (v) result.salary = v;
  }
  if (spec.jobLevel) {
    const v = asNonEmptyString(readPath(item, spec.jobLevel));
    if (v) result.jobLevel = v;
  }
  if (spec.jobType) {
    const v = asNonEmptyString(readPath(item, spec.jobType));
    if (v) result.jobType = v;
  }

  return result;
}
