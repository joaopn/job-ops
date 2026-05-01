// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe.sequential("ageJobsStep", () => {
  let tempDir: string;
  let db: Awaited<typeof import("../../db/index")>["db"];
  let schema: Awaited<typeof import("../../db/index")>["schema"];
  let ageJobsStep: Awaited<typeof import("./age-jobs")>["ageJobsStep"];

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-age-jobs-"));
    process.env.DATA_DIR = tempDir;
    process.env.NODE_ENV = "test";

    await import("../../db/migrate");
    ({ db, schema } = await import("../../db/index"));
    ({ ageJobsStep } = await import("./age-jobs"));
  });

  afterEach(async () => {
    const { closeDb } = await import("../../db/index");
    closeDb();
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  async function insertJob(
    overrides: Partial<typeof schema.jobs.$inferInsert>,
  ) {
    const id = overrides.id ?? `job-${Math.random().toString(36).slice(2)}`;
    await db.insert(schema.jobs).values({
      id,
      source: "linkedin",
      title: "Backend Engineer",
      employer: "Acme",
      jobUrl: `https://example.com/${id}`,
      ...overrides,
    });
    return id;
  }

  it("moves only old `discovered` rows to `backlog`", async () => {
    const oldDiscovered = await insertJob({
      datePosted: "2026-01-01",
      status: "discovered",
    });
    const recentDiscovered = await insertJob({
      datePosted: new Date().toISOString().slice(0, 10),
      status: "discovered",
    });
    const oldSelected = await insertJob({
      datePosted: "2026-01-01",
      status: "selected",
    });
    const oldReady = await insertJob({
      datePosted: "2026-01-01",
      status: "ready",
    });
    const oldApplied = await insertJob({
      datePosted: "2026-01-01",
      status: "applied",
    });

    const { moved } = await ageJobsStep({ ageoutDays: 14 });
    expect(moved).toBe(1);

    const after = await db.select().from(schema.jobs);
    const byId = new Map(after.map((row) => [row.id, row]));
    expect(byId.get(oldDiscovered)?.status).toBe("backlog");
    expect(byId.get(recentDiscovered)?.status).toBe("discovered");
    expect(byId.get(oldSelected)?.status).toBe("selected");
    expect(byId.get(oldReady)?.status).toBe("ready");
    expect(byId.get(oldApplied)?.status).toBe("applied");
  });

  it("falls back to discoveredAt when datePosted is null", async () => {
    const id = await insertJob({
      datePosted: null,
      status: "discovered",
      discoveredAt: "2026-01-01T00:00:00Z",
    });

    const { moved } = await ageJobsStep({ ageoutDays: 14 });
    expect(moved).toBe(1);

    const [row] = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, id));
    expect(row?.status).toBe("backlog");
  });

  it("is a no-op when ageoutDays is 0 or negative", async () => {
    const id = await insertJob({
      datePosted: "2026-01-01",
      status: "discovered",
    });

    const zero = await ageJobsStep({ ageoutDays: 0 });
    expect(zero.moved).toBe(0);
    const negative = await ageJobsStep({ ageoutDays: -5 });
    expect(negative.moved).toBe(0);

    const [row] = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, id));
    expect(row?.status).toBe("discovered");
  });
});
