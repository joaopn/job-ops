/**
 * Normalize `date_posted` ingestion values to ISO 8601.
 *
 * Historical context (see CLAUDE.md "Raw `date_posted` cannot be compared
 * lexically in SQL"): jobspy stores Unix-ms numeric strings, every other
 * extractor stores ISO. Mixed-format text makes SQL comparisons unreliable
 * and produces silent bugs (every Unix-ms row sorts lexically before any
 * '2026-...' ISO string).
 *
 * This helper is the single ingestion-time gate. It accepts either ISO 8601
 * or all-digit Unix-ms strings, normalises both to ISO, and throws loudly
 * for anything else — callers must catch and decide whether to drop the row
 * or escalate.
 */

const ALL_DIGITS = /^\d+$/;
const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}/;

export class DateNormalizationError extends Error {
  readonly rawValue: string;
  constructor(rawValue: string, message: string) {
    super(message);
    this.name = "DateNormalizationError";
    this.rawValue = rawValue;
  }
}

export function normalizeDatePosted(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      throw new DateNormalizationError(
        String(value),
        `numeric date_posted out of range: ${value}`,
      );
    }
    return fromUnixMs(value);
  }
  if (typeof value !== "string") {
    throw new DateNormalizationError(
      String(value),
      `expected string | number | null, got ${typeof value}`,
    );
  }

  const trimmed = value.trim();
  if (trimmed === "") return null;

  if (ALL_DIGITS.test(trimmed)) {
    const ms = Number(trimmed);
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new DateNormalizationError(
        trimmed,
        `unix-ms value out of range: ${trimmed}`,
      );
    }
    return fromUnixMs(ms);
  }

  if (ISO_PREFIX.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new DateNormalizationError(
        trimmed,
        `ISO-shaped string failed to parse: ${trimmed}`,
      );
    }
    return parsed.toISOString();
  }

  throw new DateNormalizationError(
    trimmed,
    `unrecognised date_posted format: ${trimmed}`,
  );
}

function fromUnixMs(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    throw new DateNormalizationError(
      String(ms),
      `unix-ms produced Invalid Date: ${ms}`,
    );
  }
  return date.toISOString();
}
