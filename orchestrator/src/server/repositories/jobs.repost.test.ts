// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe.sequential("jobs repository repost detection", () => {
  let tempDir: string;
  let db: Awaited<typeof import("../db/index")>["db"];
  let schema: Awaited<typeof import("../db/index")>["schema"];
  let jobsRepo: Awaited<typeof import("./jobs")>;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-jobs-repost-"));
    process.env.DATA_DIR = tempDir;
    process.env.NODE_ENV = "test";

    await import("../db/migrate");
    ({ db, schema } = await import("../db/index"));
    jobsRepo = await import("./jobs");
  });

  afterEach(async () => {
    const { closeDb } = await import("../db/index");
    closeDb();
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("bumps repost_count and reposted_at when datePosted shifts forward", async () => {
    const url = "https://example.com/jobs/repost-1";
    await jobsRepo.createJobs([
      {
        source: "linkedin",
        title: "Backend Engineer",
        employer: "Acme",
        jobUrl: url,
        datePosted: "2026-04-01",
      },
    ]);

    const result = await jobsRepo.createJobs([
      {
        source: "linkedin",
        title: "Backend Engineer",
        employer: "Acme",
        jobUrl: url,
        datePosted: "2026-04-15",
      },
    ]);

    expect(result).toEqual({ created: 0, skipped: 0, reposted: 1 });

    const refreshed = await jobsRepo.getJobByUrl(url);
    expect(refreshed?.datePosted).toBe("2026-04-15");
    expect(refreshed?.repostCount).toBe(1);
    expect(refreshed?.repostedAt).not.toBeNull();
    expect(refreshed?.status).toBe("discovered");
  });

  it("skips when datePosted is unchanged or older", async () => {
    const url = "https://example.com/jobs/repost-2";
    await jobsRepo.createJobs([
      {
        source: "linkedin",
        title: "Backend Engineer",
        employer: "Acme",
        jobUrl: url,
        datePosted: "2026-04-15",
      },
    ]);

    const sameDay = await jobsRepo.createJobs([
      {
        source: "linkedin",
        title: "Backend Engineer",
        employer: "Acme",
        jobUrl: url,
        datePosted: "2026-04-15",
      },
    ]);
    expect(sameDay).toEqual({ created: 0, skipped: 1, reposted: 0 });

    const older = await jobsRepo.createJobs([
      {
        source: "linkedin",
        title: "Backend Engineer",
        employer: "Acme",
        jobUrl: url,
        datePosted: "2026-04-01",
      },
    ]);
    expect(older).toEqual({ created: 0, skipped: 1, reposted: 0 });

    const refreshed = await jobsRepo.getJobByUrl(url);
    expect(refreshed?.datePosted).toBe("2026-04-15");
    expect(refreshed?.repostCount).toBe(0);
    expect(refreshed?.repostedAt).toBeNull();
  });

  it("re-promotes a backlog row to discovered on a forward repost", async () => {
    const url = "https://example.com/jobs/repost-3";
    const [first] = await db
      .insert(schema.jobs)
      .values({
        id: "backlog-job-1",
        source: "linkedin",
        title: "Backend Engineer",
        employer: "Acme",
        jobUrl: url,
        datePosted: "2026-04-01",
        status: "backlog",
      })
      .returning();
    expect(first?.status).toBe("backlog");

    const result = await jobsRepo.createJobs([
      {
        source: "linkedin",
        title: "Backend Engineer",
        employer: "Acme",
        jobUrl: url,
        datePosted: "2026-04-15",
      },
    ]);
    expect(result.reposted).toBe(1);

    const refreshed = await jobsRepo.getJobByUrl(url);
    expect(refreshed?.status).toBe("discovered");
    expect(refreshed?.repostCount).toBe(1);
  });

  it("preserves user-driven status (selected/skipped/closed) on a repost", async () => {
    const fixtures: Array<{ id: string; url: string; status: string }> = [
      {
        id: "selected-job",
        url: "https://example.com/jobs/repost-selected",
        status: "selected",
      },
      {
        id: "skipped-job",
        url: "https://example.com/jobs/repost-skipped",
        status: "skipped",
      },
      {
        id: "closed-job",
        url: "https://example.com/jobs/repost-closed",
        status: "closed",
      },
    ];

    for (const fixture of fixtures) {
      await db.insert(schema.jobs).values({
        id: fixture.id,
        source: "linkedin",
        title: "Backend Engineer",
        employer: "Acme",
        jobUrl: fixture.url,
        datePosted: "2026-04-01",
        status: fixture.status as "selected" | "skipped" | "closed",
      });
    }

    for (const fixture of fixtures) {
      await jobsRepo.createJobs([
        {
          source: "linkedin",
          title: "Backend Engineer",
          employer: "Acme",
          jobUrl: fixture.url,
          datePosted: "2026-04-15",
        },
      ]);
    }

    for (const fixture of fixtures) {
      const refreshed = await jobsRepo.getJobByUrl(fixture.url);
      expect(refreshed?.status).toBe(fixture.status);
      expect(refreshed?.repostCount).toBe(1);
    }
  });

  it("does not flag as repost when datePosted is missing on either side", async () => {
    const url = "https://example.com/jobs/repost-nulldate";
    await jobsRepo.createJobs([
      {
        source: "linkedin",
        title: "Backend Engineer",
        employer: "Acme",
        jobUrl: url,
      },
    ]);

    const result = await jobsRepo.createJobs([
      {
        source: "linkedin",
        title: "Backend Engineer",
        employer: "Acme",
        jobUrl: url,
        datePosted: "2026-04-15",
      },
    ]);
    expect(result).toEqual({ created: 0, skipped: 1, reposted: 0 });

    const refreshed = await jobsRepo.getJobByUrl(url);
    expect(refreshed?.datePosted).toBeNull();
    expect(refreshed?.repostCount).toBe(0);
  });
});
