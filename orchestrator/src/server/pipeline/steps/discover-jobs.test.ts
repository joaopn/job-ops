import { createLocationIntentFromLegacyInputs } from "@shared/location-domain.js";
import type { PipelineConfig } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProgress, resetProgress } from "../progress";
import { discoverJobsStep } from "./discover-jobs";

vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

vi.mock("@server/repositories/jobs", () => ({
  getAllJobUrls: vi.fn().mockResolvedValue([]),
}));

vi.mock("@server/repositories/source-configs", () => ({
  getAllSourceConfigs: vi.fn().mockResolvedValue([
    {
      extractorId: "jobspy",
      enabled: true,
      config: {},
      mappings: {},
      updatedAt: "",
    },
    {
      extractorId: "hiringcafe",
      enabled: true,
      config: {},
      mappings: {},
      updatedAt: "",
    },
    {
      extractorId: "startupjobs",
      enabled: true,
      config: {},
      mappings: {},
      updatedAt: "",
    },
    {
      extractorId: "workingnomads",
      enabled: true,
      config: {},
      mappings: {},
      updatedAt: "",
    },
  ]),
}));

vi.mock("@server/repositories/provider-instances", () => ({
  getEnabledProviderInstances: vi.fn().mockResolvedValue([]),
}));

vi.mock("@server/extractors/registry", () => ({
  getExtractorRegistry: vi.fn(),
}));

const baseConfig: PipelineConfig = {
  topN: 10,
  minSuitabilityCategory: "good_fit",
  sources: ["indeed", "linkedin", "hiringcafe"],
  outputDir: "./tmp",
  enableCrawling: true,
  enableScoring: true,
  enableImporting: true,
  enableAutoTailoring: true,
  searchTerms: ["engineer"],
  locationIntent: createLocationIntentFromLegacyInputs({
    selectedCountry: "united kingdom",
  }),
};

describe("discoverJobsStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProgress();
  });

  it("aggregates source errors for enabled sources", async () => {
    const registryModule = await import("@server/extractors/registry");

    const jobspyManifest = {
      id: "jobspy",
      displayName: "JobSpy",
      providesSources: ["indeed", "linkedin", "glassdoor"],
      run: vi.fn().mockResolvedValue({
        success: true,
        jobs: [
          {
            source: "linkedin",
            title: "Engineer",
            employer: "ACME",
            jobUrl: "https://example.com/job",
            location: "London, United Kingdom",
            locationEvidence: {
              location: "London, United Kingdom",
              country: "united kingdom",
              city: "London",
              source: "location",
            },
          },
        ],
      }),
    };
    const ukvisaManifest = {
      id: "hiringcafe",
      displayName: "Hiring Cafe",
      providesSources: ["hiringcafe"],
      run: vi.fn().mockResolvedValue({
        success: false,
        jobs: [],
        error: "login failed",
      }),
    };

    vi.mocked(registryModule.getExtractorRegistry).mockResolvedValue({
      manifests: new Map([
        ["jobspy", jobspyManifest as any],
        ["hiringcafe", ukvisaManifest as any],
      ]),
      manifestBySource: new Map([
        ["indeed", jobspyManifest as any],
        ["linkedin", jobspyManifest as any],
        ["glassdoor", jobspyManifest as any],
        ["hiringcafe", ukvisaManifest as any],
      ]),
      availableSources: ["indeed", "linkedin", "glassdoor", "hiringcafe"],
    } as any);

    const result = await discoverJobsStep({ mergedConfig: baseConfig });

    expect(result.discoveredJobs).toHaveLength(1);
    expect(result.sourceErrors).toEqual([
      "Hiring Cafe: login failed (sources: hiringcafe)",
    ]);
    expect(jobspyManifest.run).toHaveBeenCalledWith(
      expect.objectContaining({ selectedSources: ["indeed", "linkedin"] }),
    );
  });

  it("throws when all enabled sources fail", async () => {
    const registryModule = await import("@server/extractors/registry");

    const ukvisaManifest = {
      id: "hiringcafe",
      displayName: "Hiring Cafe",
      providesSources: ["hiringcafe"],
      run: vi.fn().mockResolvedValue({
        success: false,
        jobs: [],
        error: "boom",
      }),
    };

    vi.mocked(registryModule.getExtractorRegistry).mockResolvedValue({
      manifests: new Map([["hiringcafe", ukvisaManifest as any]]),
      manifestBySource: new Map([["hiringcafe", ukvisaManifest as any]]),
      availableSources: ["hiringcafe"],
    } as any);

    await expect(
      discoverJobsStep({
        mergedConfig: {
          ...baseConfig,
          sources: ["hiringcafe"],
        },
      }),
    ).rejects.toThrow(
      "All sources failed: Hiring Cafe: boom (sources: hiringcafe)",
    );
  });

  it("throws when all requested sources are incompatible for country", async () => {
    const registryModule = await import("@server/extractors/registry");

    vi.mocked(registryModule.getExtractorRegistry).mockResolvedValue({
      manifests: new Map(),
      manifestBySource: new Map(),
      availableSources: [],
    } as any);

    // Glassdoor is the only kept source with country restrictions; pick a
    // country it does not support so the country-compat filter rejects it.
    await expect(
      discoverJobsStep({
        mergedConfig: {
          ...baseConfig,
          sources: ["glassdoor"],
          locationIntent: createLocationIntentFromLegacyInputs({
            selectedCountry: "croatia",
          }),
        },
      }),
    ).rejects.toThrow("No compatible sources for selected country: Croatia");
  });

  it("does not throw when no sources are requested", async () => {
    const registryModule = await import("@server/extractors/registry");

    vi.mocked(registryModule.getExtractorRegistry).mockResolvedValue({
      manifests: new Map(),
      manifestBySource: new Map(),
      availableSources: [],
    } as any);

    const result = await discoverJobsStep({
      mergedConfig: {
        ...baseConfig,
        sources: [],
        locationIntent: createLocationIntentFromLegacyInputs({
          selectedCountry: "united states",
        }),
      },
    });

    expect(result.discoveredJobs).toEqual([]);
    expect(result.sourceErrors).toEqual([]);
  });

  it("drops discovered jobs when employer matches blocked company keywords", async () => {
    const registryModule = await import("@server/extractors/registry");

    const jobspyManifest = {
      id: "jobspy",
      displayName: "JobSpy",
      providesSources: ["indeed", "linkedin", "glassdoor"],
      run: vi.fn().mockResolvedValue({
        success: true,
        jobs: [
          {
            source: "linkedin",
            title: "Engineer",
            employer: "Acme Staffing",
            jobUrl: "https://example.com/job-1",
          },
          {
            source: "linkedin",
            title: "Engineer II",
            employer: "Contoso",
            jobUrl: "https://example.com/job-2",
          },
        ],
      }),
    };

    vi.mocked(registryModule.getExtractorRegistry).mockResolvedValue({
      manifests: new Map([["jobspy", jobspyManifest as any]]),
      manifestBySource: new Map([
        ["indeed", jobspyManifest as any],
        ["linkedin", jobspyManifest as any],
        ["glassdoor", jobspyManifest as any],
      ]),
      availableSources: ["indeed", "linkedin", "glassdoor"],
    } as any);

    const result = await discoverJobsStep({
      mergedConfig: {
        ...baseConfig,
        sources: ["linkedin"],
        blockedCompanyKeywords: ["recruit", "staffing"],
        locationIntent: createLocationIntentFromLegacyInputs({}),
      },
    });

    expect(result.discoveredJobs).toHaveLength(1);
    expect(result.discoveredJobs[0]?.employer).toBe("Contoso");
  });

  it("applies shared city filtering for sources without native city filtering", async () => {
    const registryModule = await import("@server/extractors/registry");

    const workingnomadsManifest = {
      id: "workingnomads",
      displayName: "Working Nomads",
      providesSources: ["workingnomads"],
      run: vi.fn().mockResolvedValue({
        success: true,
        jobs: [
          {
            source: "workingnomads",
            title: "Engineer - Leeds",
            employer: "ACME",
            location: "Leeds, England, UK",
            jobUrl: "https://example.com/wn-1",
          },
          {
            source: "workingnomads",
            title: "Engineer - London",
            employer: "ACME",
            location: "London, England, UK",
            jobUrl: "https://example.com/wn-2",
          },
        ],
      }),
    };
    const ukvisaManifest = {
      id: "hiringcafe",
      displayName: "Hiring Cafe",
      providesSources: ["hiringcafe"],
      run: vi.fn().mockResolvedValue({
        success: true,
        jobs: [
          {
            source: "hiringcafe",
            title: "Developer - Leeds",
            employer: "Contoso",
            location: "Leeds, England, UK",
            jobUrl: "https://example.com/ukv-1",
          },
        ],
      }),
    };

    vi.mocked(registryModule.getExtractorRegistry).mockResolvedValue({
      manifests: new Map([
        ["workingnomads", workingnomadsManifest as any],
        ["hiringcafe", ukvisaManifest as any],
      ]),
      manifestBySource: new Map([
        ["workingnomads", workingnomadsManifest as any],
        ["hiringcafe", ukvisaManifest as any],
      ]),
      availableSources: ["workingnomads", "hiringcafe"],
    } as any);

    const result = await discoverJobsStep({
      mergedConfig: {
        ...baseConfig,
        sources: ["workingnomads", "hiringcafe"],
        locationIntent: createLocationIntentFromLegacyInputs({
          selectedCountry: "united kingdom",
          searchCities: "Leeds",
        }),
      },
    });

    expect(result.discoveredJobs).toHaveLength(2);
    expect(
      result.discoveredJobs.every((job) => job.location?.includes("Leeds")),
    ).toBe(true);
  });

  it("drops discovered jobs outside the selected country when no cities are set", async () => {
    const registryModule = await import("@server/extractors/registry");

    const jobspyManifest = {
      id: "jobspy",
      displayName: "JobSpy",
      providesSources: ["indeed", "linkedin", "glassdoor"],
      run: vi.fn().mockResolvedValue({
        success: true,
        jobs: [
          {
            source: "linkedin",
            title: "Engineer - Zagreb",
            employer: "ACME Croatia",
            location: "Zagreb, Croatia",
            jobUrl: "https://example.com/hr-1",
          },
          {
            source: "linkedin",
            title: "Engineer - Bengaluru",
            employer: "ACME India",
            location: "Bengaluru, Karnataka, India",
            jobUrl: "https://example.com/in-1",
          },
          {
            source: "linkedin",
            title: "Engineer - Unknown",
            employer: "Unknown Co",
            location: null,
            jobUrl: "https://example.com/unknown-1",
          },
        ],
      }),
    };

    vi.mocked(registryModule.getExtractorRegistry).mockResolvedValue({
      manifests: new Map([["jobspy", jobspyManifest as any]]),
      manifestBySource: new Map([
        ["indeed", jobspyManifest as any],
        ["linkedin", jobspyManifest as any],
        ["glassdoor", jobspyManifest as any],
      ]),
      availableSources: ["indeed", "linkedin", "glassdoor"],
    } as any);

    const result = await discoverJobsStep({
      mergedConfig: {
        ...baseConfig,
        sources: ["linkedin"],
        locationIntent: createLocationIntentFromLegacyInputs({
          selectedCountry: "croatia",
        }),
      },
    });

    expect(result.discoveredJobs).toHaveLength(1);
    expect(result.discoveredJobs[0]?.location).toBe("Zagreb, Croatia");
  });

  it("keeps jobs that only expose structured location evidence", async () => {
    const registryModule = await import("@server/extractors/registry");

    const jobspyManifest = {
      id: "jobspy",
      displayName: "JobSpy",
      providesSources: ["indeed", "linkedin", "glassdoor"],
      run: vi.fn().mockResolvedValue({
        success: true,
        jobs: [
          {
            source: "linkedin",
            title: "Engineer - Zagreb",
            employer: "ACME Croatia",
            location: null,
            locationEvidence: {
              location: "Zagreb, Croatia",
              country: "croatia",
            },
            jobUrl: "https://example.com/hr-1",
          },
        ],
      }),
    };

    vi.mocked(registryModule.getExtractorRegistry).mockResolvedValue({
      manifests: new Map([["jobspy", jobspyManifest as any]]),
      manifestBySource: new Map([
        ["indeed", jobspyManifest as any],
        ["linkedin", jobspyManifest as any],
        ["glassdoor", jobspyManifest as any],
      ]),
      availableSources: ["indeed", "linkedin", "glassdoor"],
    } as any);

    const result = await discoverJobsStep({
      mergedConfig: {
        ...baseConfig,
        sources: ["linkedin"],
        locationIntent: createLocationIntentFromLegacyInputs({
          selectedCountry: "croatia",
        }),
      },
    });

    expect(result.discoveredJobs).toHaveLength(1);
    expect(result.discoveredJobs[0]?.locationEvidence).toEqual(
      expect.objectContaining({
        location: "Zagreb, Croatia",
        country: "croatia",
      }),
    );
  });

  it("keeps remote jobs worldwide when scope allows them", async () => {
    const registryModule = await import("@server/extractors/registry");

    const jobspyManifest = {
      id: "jobspy",
      displayName: "JobSpy",
      providesSources: ["indeed", "linkedin", "glassdoor"],
      run: vi.fn().mockResolvedValue({
        success: true,
        jobs: [
          {
            source: "linkedin",
            title: "Engineer - Zagreb",
            employer: "ACME Croatia",
            location: "Zagreb, Croatia",
            isRemote: false,
            jobUrl: "https://example.com/hr-1",
          },
          {
            source: "linkedin",
            title: "Engineer - Anywhere",
            employer: "Remote Co",
            location: "Bengaluru, Karnataka, India",
            isRemote: true,
            jobUrl: "https://example.com/in-remote-1",
          },
        ],
      }),
    };

    vi.mocked(registryModule.getExtractorRegistry).mockResolvedValue({
      manifests: new Map([["jobspy", jobspyManifest as any]]),
      manifestBySource: new Map([
        ["indeed", jobspyManifest as any],
        ["linkedin", jobspyManifest as any],
        ["glassdoor", jobspyManifest as any],
      ]),
      availableSources: ["indeed", "linkedin", "glassdoor"],
    } as any);

    const result = await discoverJobsStep({
      mergedConfig: {
        ...baseConfig,
        sources: ["linkedin"],
        locationIntent: createLocationIntentFromLegacyInputs({
          selectedCountry: "croatia",
          workplaceTypes: ["remote", "hybrid"],
          searchScope: "selected_plus_remote_worldwide",
        }),
      },
    });

    expect(result.discoveredJobs).toHaveLength(2);
    expect(result.discoveredJobs.map((job) => job.jobUrl)).toEqual([
      "https://example.com/hr-1",
      "https://example.com/in-remote-1",
    ]);
  });

  it("keeps country matches when strictness is flexible and city metadata disagrees", async () => {
    const registryModule = await import("@server/extractors/registry");

    const jobspyManifest = {
      id: "jobspy",
      displayName: "JobSpy",
      providesSources: ["indeed", "linkedin", "glassdoor"],
      run: vi.fn().mockResolvedValue({
        success: true,
        jobs: [
          {
            source: "linkedin",
            title: "Engineer - Split",
            employer: "ACME Croatia",
            location: "Split, Croatia",
            jobUrl: "https://example.com/hr-1",
          },
        ],
      }),
    };

    vi.mocked(registryModule.getExtractorRegistry).mockResolvedValue({
      manifests: new Map([["jobspy", jobspyManifest as any]]),
      manifestBySource: new Map([
        ["indeed", jobspyManifest as any],
        ["linkedin", jobspyManifest as any],
        ["glassdoor", jobspyManifest as any],
      ]),
      availableSources: ["indeed", "linkedin", "glassdoor"],
    } as any);

    const result = await discoverJobsStep({
      mergedConfig: {
        ...baseConfig,
        sources: ["linkedin"],
        locationIntent: createLocationIntentFromLegacyInputs({
          selectedCountry: "croatia",
          searchCities: "Zagreb",
          matchStrictness: "flexible",
        }),
      },
    });

    expect(result.discoveredJobs).toHaveLength(1);
    expect(result.discoveredJobs[0]?.location).toBe("Split, Croatia");
  });

  it("tracks source completion counters across source transitions", async () => {
    const jobsRepo = await import("@server/repositories/jobs");
    const registryModule = await import("@server/extractors/registry");

    const jobspyManifest = {
      id: "jobspy",
      displayName: "JobSpy",
      providesSources: ["indeed", "linkedin", "glassdoor"],
      run: vi.fn().mockResolvedValue({ success: true, jobs: [] }),
    };
    const workingnomadsManifest = {
      id: "workingnomads",
      displayName: "Working Nomads",
      providesSources: ["workingnomads"],
      run: vi.fn().mockResolvedValue({ success: true, jobs: [] }),
    };
    const ukvisaManifest = {
      id: "hiringcafe",
      displayName: "Hiring Cafe",
      providesSources: ["hiringcafe"],
      run: vi.fn().mockResolvedValue({ success: true, jobs: [] }),
    };

    vi.mocked(jobsRepo.getAllJobUrls).mockResolvedValue([
      "https://example.com/existing",
    ]);

    vi.mocked(registryModule.getExtractorRegistry).mockResolvedValue({
      manifests: new Map([
        ["jobspy", jobspyManifest as any],
        ["workingnomads", workingnomadsManifest as any],
        ["hiringcafe", ukvisaManifest as any],
      ]),
      manifestBySource: new Map([
        ["indeed", jobspyManifest as any],
        ["linkedin", jobspyManifest as any],
        ["glassdoor", jobspyManifest as any],
        ["workingnomads", workingnomadsManifest as any],
        ["hiringcafe", ukvisaManifest as any],
      ]),
      availableSources: [
        "indeed",
        "linkedin",
        "glassdoor",
        "workingnomads",
        "hiringcafe",
      ],
    } as any);

    await discoverJobsStep({
      mergedConfig: {
        ...baseConfig,
        sources: ["linkedin", "workingnomads", "hiringcafe"],
      },
    });

    const progress = getProgress();
    expect(progress.crawlingSourcesTotal).toBe(3);
    expect(progress.crawlingSourcesCompleted).toBe(3);
    expect(workingnomadsManifest.run).toHaveBeenCalledWith(
      expect.objectContaining({
        getExistingJobUrls: expect.any(Function),
      }),
    );

    const [{ getExistingJobUrls }] = workingnomadsManifest.run.mock
      .calls[0] as [{ getExistingJobUrls: () => Promise<string[]> }];
    await expect(getExistingJobUrls()).resolves.toEqual([
      "https://example.com/existing",
    ]);
  });

  it("passes mergedConfig.searchTerms to the extractor run", async () => {
    const registryModule = await import("@server/extractors/registry");

    const jobspyManifest = {
      id: "jobspy",
      displayName: "JobSpy",
      providesSources: ["indeed", "linkedin", "glassdoor"],
      run: vi.fn().mockResolvedValue({ success: true, jobs: [] }),
    };

    vi.mocked(registryModule.getExtractorRegistry).mockResolvedValue({
      manifests: new Map([["jobspy", jobspyManifest as any]]),
      manifestBySource: new Map([
        ["indeed", jobspyManifest as any],
        ["linkedin", jobspyManifest as any],
        ["glassdoor", jobspyManifest as any],
      ]),
      availableSources: ["indeed", "linkedin", "glassdoor"],
    } as any);

    await discoverJobsStep({
      mergedConfig: {
        ...baseConfig,
        sources: ["linkedin"],
        searchTerms: ["rust developer"],
      },
    });

    expect(jobspyManifest.run).toHaveBeenCalledWith(
      expect.objectContaining({ searchTerms: ["rust developer"] }),
    );
  });
});
