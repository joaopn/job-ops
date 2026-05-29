import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("startup-jobs-scraper", () => ({
  scrapeStartupJobsViaAlgolia: vi.fn(),
}));

describe("runStartupJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to the default max jobs per term when options.maxJobsPerTerm is NaN", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock.mockResolvedValueOnce([]);

    const { runStartupJobs } = await import("../src/run");

    await runStartupJobs({
      searchTerms: ["backend engineer"],
      locations: ["UK"],
      maxJobsPerTerm: Number.NaN,
    });

    expect(scrapeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedCount: 50,
      }),
    );
  });

  it("skips the scrape (no jobs, no error) when no concrete location resolves", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);

    const { runStartupJobs } = await import("../src/run");

    const result = await runStartupJobs({
      searchTerms: ["platform engineer"],
      selectedCountry: "worldwide",
      locations: ["Worldwide"],
    });

    expect(scrapeMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.jobs).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it("normalizes explicit city-country aliases before passing location to the scraper", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock.mockResolvedValueOnce([]);

    const { runStartupJobs } = await import("../src/run");

    await runStartupJobs({
      searchTerms: ["software engineer"],
      locations: ["UK"],
    });

    expect(scrapeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        location: "United Kingdom",
      }),
    );
  });

  it("passes workplaceType to the scraper", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock.mockResolvedValueOnce([]);

    const { runStartupJobs } = await import("../src/run");

    await runStartupJobs({
      searchTerms: ["software engineer"],
      locations: ["UK"],
      workplaceTypes: ["remote", "hybrid"],
    });

    expect(scrapeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workplaceType: ["remote", "hybrid"],
      }),
    );
  });

  it("maps onsite workplaceType to the scraper's on-site value", async () => {
    const { scrapeStartupJobsViaAlgolia } = await import(
      "startup-jobs-scraper"
    );
    const scrapeMock = vi.mocked(scrapeStartupJobsViaAlgolia);
    scrapeMock.mockResolvedValueOnce([]);

    const { runStartupJobs } = await import("../src/run");

    await runStartupJobs({
      searchTerms: ["software engineer"],
      locations: ["UK"],
      workplaceTypes: ["onsite"],
    });

    expect(scrapeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workplaceType: ["on-site"],
      }),
    );
  });
});
