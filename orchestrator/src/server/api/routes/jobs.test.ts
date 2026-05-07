// @vitest-environment node
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("POST /api/jobs/actions — 5g action variants", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  async function seedJob(overrides: {
    id: string;
    status: string;
    outcome?: string | null;
    closedAt?: number | null;
  }) {
    const { db, schema } = await import("@server/db/index");
    await db.insert(schema.jobs).values({
      id: overrides.id,
      source: "linkedin",
      title: "Backend Engineer",
      employer: "Acme",
      jobUrl: `https://example.com/${overrides.id}`,
      status: overrides.status as
        | "discovered"
        | "selected"
        | "ready"
        | "applied"
        | "in_progress"
        | "backlog"
        | "skipped"
        | "closed",
      outcome:
        (overrides.outcome ?? null) as
          | "rejected"
          | "withdrawn"
          | "ghosted"
          | "other"
          | null,
      closedAt: overrides.closedAt ?? null,
    });
  }

  async function postAction(body: unknown) {
    const res = await fetch(`${baseUrl}/api/jobs/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  it("move_to_selected promotes a discovered row to selected", async () => {
    await seedJob({ id: "job-1", status: "discovered" });

    const { status, body } = await postAction({
      action: "move_to_selected",
      jobIds: ["job-1"],
    });

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.succeeded).toBe(1);
    expect(body.data.results[0].job.status).toBe("selected");
  });

  it("move_to_selected from backlog also works (re-engagement)", async () => {
    await seedJob({ id: "job-2", status: "backlog" });

    const { body } = await postAction({
      action: "move_to_selected",
      jobIds: ["job-2"],
    });

    expect(body.data.results[0].job.status).toBe("selected");
  });

  it("move_to_selected demotes a ready row back to selected for re-tailoring", async () => {
    await seedJob({ id: "job-3", status: "ready" });

    const { body } = await postAction({
      action: "move_to_selected",
      jobIds: ["job-3"],
    });

    expect(body.data.results[0].job.status).toBe("selected");
  });

  it("move_to_selected rejects from non-promotable statuses", async () => {
    await seedJob({ id: "job-3b", status: "applied" });

    const { body } = await postAction({
      action: "move_to_selected",
      jobIds: ["job-3b"],
    });

    expect(body.data.failed).toBe(1);
    expect(body.data.results[0].error.code).toBe("INVALID_REQUEST");
  });

  it("unselect demotes selected back to discovered", async () => {
    await seedJob({ id: "job-4", status: "selected" });

    const { body } = await postAction({
      action: "unselect",
      jobIds: ["job-4"],
    });

    expect(body.data.results[0].job.status).toBe("discovered");
  });

  it("move_to_backlog accepts discovered + selected", async () => {
    await seedJob({ id: "job-5a", status: "discovered" });
    await seedJob({ id: "job-5b", status: "selected" });

    const { body } = await postAction({
      action: "move_to_backlog",
      jobIds: ["job-5a", "job-5b"],
    });

    expect(body.data.succeeded).toBe(2);
    for (const result of body.data.results) {
      expect(result.job.status).toBe("backlog");
    }
  });

  it("mark_closed sets status, outcome, closedAt", async () => {
    await seedJob({ id: "job-6", status: "applied" });

    const { body } = await postAction({
      action: "mark_closed",
      jobIds: ["job-6"],
      options: { outcome: "rejected" },
    });

    expect(body.data.results[0].job.status).toBe("closed");
    expect(body.data.results[0].job.outcome).toBe("rejected");
    expect(body.data.results[0].job.closedAt).toBeGreaterThan(0);
  });

  it("mark_closed rejects without an outcome", async () => {
    await seedJob({ id: "job-7", status: "applied" });

    const res = await fetch(`${baseUrl}/api/jobs/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "mark_closed",
        jobIds: ["job-7"],
      }),
    });
    expect(res.status).toBe(400);
  });

  it("mark_closed rejects pre-applied statuses", async () => {
    await seedJob({ id: "job-8", status: "ready" });

    const { body } = await postAction({
      action: "mark_closed",
      jobIds: ["job-8"],
      options: { outcome: "withdrawn" },
    });

    expect(body.data.failed).toBe(1);
  });

  it("reopen rotates skipped/closed back to selected and clears outcome", async () => {
    await seedJob({
      id: "job-9a",
      status: "closed",
      outcome: "rejected",
      closedAt: 1700000000,
    });
    await seedJob({ id: "job-9b", status: "skipped" });

    const { body } = await postAction({
      action: "reopen",
      jobIds: ["job-9a", "job-9b"],
    });

    expect(body.data.succeeded).toBe(2);
    for (const result of body.data.results) {
      expect(result.job.status).toBe("selected");
      expect(result.job.outcome).toBeNull();
      expect(result.job.closedAt).toBeNull();
    }
  });

  it("skip is now allowed from selected and backlog (not just discovered/ready)", async () => {
    await seedJob({ id: "job-10a", status: "selected" });
    await seedJob({ id: "job-10b", status: "backlog" });

    const { body } = await postAction({
      action: "skip",
      jobIds: ["job-10a", "job-10b"],
    });

    expect(body.data.succeeded).toBe(2);
    for (const result of body.data.results) {
      expect(result.job.status).toBe("skipped");
    }
  });
});
