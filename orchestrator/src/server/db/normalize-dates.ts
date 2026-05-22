/**
 * One-off DB normalization for `jobs.date_posted`.
 *
 * Walks every job with a non-null `date_posted` and rewrites the column to
 * ISO 8601 via `shared/src/date-normalize.ts`. Values that fail to
 * normalize (neither ISO 8601 nor an all-digit Unix-ms string) are NULLed
 * out and logged loudly.
 *
 * Idempotent: already-ISO rows are no-ops.
 *
 * Usage: `npm --workspace orchestrator run db:normalize-dates`.
 */

import { isMainThread } from "node:worker_threads";
import {
  DateNormalizationError,
  normalizeDatePosted,
} from "@shared/date-normalize";
import { eq, isNotNull } from "drizzle-orm";
import { closeDb, db, schema } from "./index";

const { jobs } = schema;

interface RowSummary {
  scanned: number;
  alreadyIso: number;
  converted: number;
  nulled: number;
}

interface FailureReport {
  id: string;
  jobUrl: string;
  source: string;
  rawValue: string;
  reason: string;
}

async function normalizeDatePostedColumn(): Promise<{
  summary: RowSummary;
  failures: FailureReport[];
}> {
  const summary: RowSummary = {
    scanned: 0,
    alreadyIso: 0,
    converted: 0,
    nulled: 0,
  };
  const failures: FailureReport[] = [];

  const rows = await db
    .select({
      id: jobs.id,
      jobUrl: jobs.jobUrl,
      source: jobs.source,
      datePosted: jobs.datePosted,
    })
    .from(jobs)
    .where(isNotNull(jobs.datePosted));

  for (const row of rows) {
    summary.scanned += 1;
    const raw = row.datePosted ?? "";

    let normalized: string | null;
    try {
      normalized = normalizeDatePosted(raw);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown normalize error";
      const rawValue =
        error instanceof DateNormalizationError ? error.rawValue : raw;
      failures.push({
        id: row.id,
        jobUrl: row.jobUrl,
        source: row.source,
        rawValue,
        reason: message,
      });
      await db
        .update(jobs)
        .set({ datePosted: null })
        .where(eq(jobs.id, row.id));
      summary.nulled += 1;
      continue;
    }

    if (normalized === raw) {
      summary.alreadyIso += 1;
      continue;
    }

    await db
      .update(jobs)
      .set({ datePosted: normalized })
      .where(eq(jobs.id, row.id));
    summary.converted += 1;
  }

  return { summary, failures };
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  console.log("[normalize-dates] scanning jobs.date_posted…");
  const { summary, failures } = await normalizeDatePostedColumn();
  const elapsedMs = Date.now() - startedAt;

  console.log("[normalize-dates] summary", {
    ...summary,
    failed: failures.length,
    elapsedMs,
  });

  if (failures.length > 0) {
    console.warn(
      `[normalize-dates] ${failures.length} row(s) had unparseable date_posted; column NULLed:`,
    );
    for (const failure of failures) {
      console.warn(`  - ${failure.id}`, {
        source: failure.source,
        jobUrl: failure.jobUrl,
        rawValue: failure.rawValue,
        reason: failure.reason,
      });
    }
  }

  closeDb();
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

if (isMainThread) {
  void main().catch((error) => {
    console.error("[normalize-dates] fatal error", error);
    closeDb();
    process.exitCode = 2;
  });
}
