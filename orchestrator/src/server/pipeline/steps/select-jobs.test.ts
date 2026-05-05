import type { PipelineConfig } from "@shared/types";
import { describe, expect, it, vi } from "vitest";
import { selectJobsStep } from "./select-jobs";

vi.mock("@server/repositories/settings", () => ({
  getAllSettings: vi.fn().mockResolvedValue({}),
}));

const baseConfig: PipelineConfig = {
  topN: 2,
  minSuitabilityCategory: "good_fit",
  sources: ["linkedin"],
  outputDir: "./tmp",
  enableCrawling: true,
  enableScoring: true,
  enableImporting: true,
  enableAutoTailoring: true,
};

describe("selectJobsStep", () => {
  it("filters by min category, ranks best-first, and respects topN", async () => {
    const jobs = [
      {
        id: "a",
        suitabilityCategory: "very_good_fit",
        suitabilityReason: "high",
        discoveredAt: "2026-05-01T00:00:00Z",
      },
      {
        id: "b",
        suitabilityCategory: "bad_fit",
        suitabilityReason: "low",
        discoveredAt: "2026-05-01T00:00:00Z",
      },
      {
        id: "c",
        suitabilityCategory: "very_good_fit",
        suitabilityReason: "med",
        discoveredAt: "2026-04-30T00:00:00Z",
      },
      {
        id: "d",
        suitabilityCategory: "good_fit",
        suitabilityReason: "ok",
        discoveredAt: "2026-05-02T00:00:00Z",
      },
    ] as any;

    const selected = await selectJobsStep({
      scoredJobs: jobs,
      mergedConfig: baseConfig,
    });

    expect(selected.map((job) => job.id)).toEqual(["a", "c"]);
  });

  it("does not apply topN cap when auto-tailoring is disabled", async () => {
    const jobs = [
      {
        id: "a",
        suitabilityCategory: "very_good_fit",
        suitabilityReason: "high",
        discoveredAt: "2026-05-03T00:00:00Z",
      },
      {
        id: "b",
        suitabilityCategory: "bad_fit",
        suitabilityReason: "low",
        discoveredAt: "2026-05-02T00:00:00Z",
      },
      {
        id: "c",
        suitabilityCategory: "very_good_fit",
        suitabilityReason: "med",
        discoveredAt: "2026-05-01T00:00:00Z",
      },
      {
        id: "d",
        suitabilityCategory: "good_fit",
        suitabilityReason: "ok",
        discoveredAt: "2026-04-30T00:00:00Z",
      },
    ] as any;

    const selected = await selectJobsStep({
      scoredJobs: jobs,
      mergedConfig: { ...baseConfig, enableAutoTailoring: false },
    });

    expect(selected.map((job) => job.id)).toEqual(["a", "c", "d"]);
  });

  it("breaks category ties toward selected locations when requested", async () => {
    const settingsRepo = await import("@server/repositories/settings");
    vi.mocked(settingsRepo.getAllSettings).mockResolvedValue({
      locationSearchScope: "remote_worldwide_prioritize_selected",
      jobspyCountryIndeed: "croatia",
      searchCities: "Zagreb",
    } as any);

    const jobs = [
      {
        id: "remote-anywhere",
        suitabilityCategory: "very_good_fit",
        suitabilityReason: "tie",
        location: "Remote - Worldwide",
        discoveredAt: "2026-05-01T00:00:00Z",
      },
      {
        id: "zagreb",
        suitabilityCategory: "very_good_fit",
        suitabilityReason: "tie",
        location: null,
        locationEvidence: {
          location: "Zagreb, Croatia",
          country: "croatia",
        },
        discoveredAt: "2026-05-01T00:00:00Z",
      },
    ] as any;

    const selected = await selectJobsStep({
      scoredJobs: jobs,
      mergedConfig: { ...baseConfig, topN: 1 },
    });

    expect(selected.map((job) => job.id)).toEqual(["zagreb"]);
  });
});
