import { createAppSettings, createJob } from "@shared/testing/factories.js";
import { describe, expect, it } from "vitest";
import { getEnabledSources, getJobCounts } from "./utils";

describe("orchestrator utils", () => {
  it("enables startupjobs without credentials", () => {
    expect(getEnabledSources(createAppSettings())).toContain("startupjobs");
  });

  it("enables workingnomads without credentials", () => {
    expect(getEnabledSources(createAppSettings())).toContain("workingnomads");
  });

  it("groups jobs by tab including the `discovered` alias and `stale` bucket", () => {
    const jobs = [
      createJob({ id: "ready", status: "ready", closedAt: null }),
      createJob({ id: "processing", status: "processing", closedAt: null }),
      createJob({ id: "discovered", status: "discovered", closedAt: null }),
      createJob({ id: "selected", status: "selected", closedAt: null }),
      createJob({ id: "applied", status: "applied", closedAt: null }),
      createJob({ id: "in_progress", status: "in_progress", closedAt: null }),
      createJob({ id: "backlog", status: "backlog", closedAt: null }),
      createJob({ id: "stale", status: "stale", closedAt: null }),
      createJob({ id: "skipped", status: "skipped", closedAt: null }),
      createJob({ id: "closed", status: "closed", closedAt: 1700000000 }),
    ];

    expect(getJobCounts(jobs)).toEqual({
      inbox: 1,
      tailoring: 2, // processing + ready
      live: 1, // applied
      interviewing: 1, // in_progress
      backlog: 1,
      stale: 1,
      closed: 2, // skipped + closed
      all: 10, // a stray legacy `selected` row counts only here
      discovered: 1, // legacy alias for inbox
    });
  });
});
