// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import {
  getProgress,
  progressHelpers,
  resetProgress,
  subscribeToProgress,
} from "./progress";

describe("pipeline progress source-stats tracking", () => {
  beforeEach(() => {
    resetProgress();
  });

  it("creates rows when a source starts with explicit platforms (jobspy split)", () => {
    progressHelpers.startCrawling(1);
    progressHelpers.startSource("jobspy", 0, 1, {
      platforms: ["linkedin", "indeed", "glassdoor"],
    });

    const stats = getProgress().sourceStats;
    expect(stats.map((row) => row.id)).toEqual([
      "indeed",
      "linkedin",
      "glassdoor",
    ]);
    // Multi-platform extractor: each row's label gets a `[<extractorId>]`
    // suffix so the banner shows the underlying extractor alongside the
    // platform.
    expect(stats.map((row) => row.label)).toEqual([
      "Indeed [jobspy]",
      "LinkedIn [jobspy]",
      "Glassdoor [jobspy]",
    ]);
    expect(stats.every((row) => row.status === "running")).toBe(true);
    expect(stats.every((row) => row.jobsScraped === 0)).toBe(true);
  });

  it("does not suffix the label for 1:1 extractors", () => {
    progressHelpers.startCrawling(1);
    progressHelpers.startSource("hiringcafe", 0, 1, {
      platforms: ["hiringcafe"],
    });

    const row = getProgress().sourceStats.find((r) => r.id === "hiringcafe");
    expect(row?.label).toBe("Hiring Cafe");
  });

  it("records scraped counts and marks the row completed", () => {
    progressHelpers.startCrawling(1);
    progressHelpers.startSource("hiringcafe", 0, 1, {
      platforms: ["hiringcafe"],
    });
    progressHelpers.recordSourceJobsCounts("hiringcafe", {
      scraped: 17,
    });
    progressHelpers.markSourceCompleted("hiringcafe");

    const row = getProgress().sourceStats.find((r) => r.id === "hiringcafe");
    expect(row?.status).toBe("completed");
    expect(row?.jobsScraped).toBe(17);
    expect(row?.completedAt).toBeDefined();
    expect(row?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("marks failed sources with the error message", () => {
    progressHelpers.startCrawling(1);
    progressHelpers.startSource("workingnomads", 0, 1, {
      platforms: ["workingnomads"],
    });
    progressHelpers.markSourceFailed("workingnomads", "boom: timeout");

    const row = getProgress().sourceStats.find(
      (r) => r.id === "workingnomads",
    );
    expect(row?.status).toBe("failed");
    expect(row?.error).toBe("boom: timeout");
    expect(row?.completedAt).toBeDefined();
  });

  it("attributes imports + reposts + duplicates + rejects per source", () => {
    progressHelpers.startCrawling(1);
    progressHelpers.startSource("hiringcafe", 0, 1, {
      platforms: ["hiringcafe"],
    });
    progressHelpers.recordSourceJobsImported("hiringcafe", {
      imported: 5,
      reposted: 2,
      duplicated: 9,
      rejected: 1,
    });

    const row = getProgress().sourceStats.find((r) => r.id === "hiringcafe");
    expect(row?.jobsImported).toBe(5);
    expect(row?.jobsReposted).toBe(2);
    expect(row?.jobsDuplicated).toBe(9);
    expect(row?.jobsRejected).toBe(1);
  });

  it("records per-source filtered (dropped-before-import) counts", () => {
    progressHelpers.startCrawling(1);
    progressHelpers.startSource("hiringcafe", 0, 1, {
      platforms: ["hiringcafe"],
    });
    progressHelpers.recordSourceJobsFiltered("hiringcafe", 4);

    const row = getProgress().sourceStats.find((r) => r.id === "hiringcafe");
    expect(row?.jobsFiltered).toBe(4);
  });

  it("recordSourceJobsCounts is a no-op when the row does not exist yet", () => {
    progressHelpers.startCrawling(1);
    // Notably no startSource call.
    progressHelpers.recordSourceJobsCounts("hiringcafe", { scraped: 99 });
    expect(getProgress().sourceStats).toEqual([]);
  });

  it("sweeps in-flight rows to failed when the pipeline is cancelled", () => {
    progressHelpers.startCrawling(1);
    progressHelpers.startSource("hiringcafe", 0, 1, {
      platforms: ["hiringcafe"],
    });
    progressHelpers.cancelled("user cancelled");

    const row = getProgress().sourceStats.find((r) => r.id === "hiringcafe");
    expect(row?.status).toBe("failed");
    expect(row?.error).toBe("user cancelled");
  });

  it("sweeps in-flight rows to completed when the pipeline succeeds", () => {
    progressHelpers.startCrawling(1);
    progressHelpers.startSource("hiringcafe", 0, 1, {
      platforms: ["hiringcafe"],
    });
    progressHelpers.complete(0, 0);

    const row = getProgress().sourceStats.find((r) => r.id === "hiringcafe");
    expect(row?.status).toBe("completed");
  });

  it("notifies subscribers when source-state mutations occur", () => {
    const received: number[] = [];
    const unsubscribe = subscribeToProgress((snapshot) => {
      received.push(snapshot.sourceStats.length);
    });

    progressHelpers.startCrawling(1);
    progressHelpers.startSource("hiringcafe", 0, 1, {
      platforms: ["hiringcafe"],
    });
    progressHelpers.markSourceCompleted("hiringcafe");

    unsubscribe();

    // At least one snapshot included the newly-created row.
    expect(Math.max(...received)).toBe(1);
  });
});
