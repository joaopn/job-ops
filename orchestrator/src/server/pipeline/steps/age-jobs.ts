import { logger } from "@infra/logger";
import { db, schema } from "@server/db/index";
import { and, eq, sql } from "drizzle-orm";

const { jobs } = schema;

/**
 * Auto-aging: move stale `discovered` rows into `backlog` so they stop
 * polluting the Inbox. Pipeline-bound (no background tick) — running only on
 * explicit pipeline triggers respects the user's autonomy. `selected`,
 * `ready`, and post-applied statuses are immune; we only touch `discovered`.
 *
 * `ageoutDays <= 0` disables the step (settings UI uses 0 to opt out).
 */
export async function ageJobsStep(args: {
  ageoutDays: number;
}): Promise<{ moved: number }> {
  const { ageoutDays } = args;
  if (!Number.isFinite(ageoutDays) || ageoutDays <= 0) {
    logger.info("Auto-aging skipped (threshold disabled)", { ageoutDays });
    return { moved: 0 };
  }

  const now = new Date().toISOString();
  const offset = `-${ageoutDays} days`;
  const result = await db
    .update(jobs)
    .set({ status: "backlog", updatedAt: now })
    .where(
      and(
        eq(jobs.status, "discovered"),
        sql`COALESCE(${jobs.datePosted}, ${jobs.discoveredAt}) < datetime('now', ${offset})`,
      ),
    )
    .run();

  const moved = result.changes;
  logger.info("Auto-aging step complete", { ageoutDays, moved });
  return { moved };
}
