import type {
  ExtractorManifest,
  ExtractorRuntimeContext,
  SourceConfigSchema,
} from "@shared/types";
import { runJobSpy } from "./src/run";

const jobspyConfigSchema: SourceConfigSchema = {
  fields: [
    {
      key: "max_jobs_per_term",
      label: "Max jobs per term",
      type: "number",
      default: "20",
    },
    {
      key: "country_indeed",
      label: "Country (Indeed)",
      type: "text",
      default: "",
      description: "Region for Indeed sub-source.",
    },
    {
      key: "location_override",
      label: "Location override",
      type: "text",
      default: "",
      description: "Used when the Run modal's city mapping is disabled.",
    },
  ],
  globalMappings: [
    {
      globalField: "city",
      sourceField: "searchCities",
      enabledByDefault: true,
    },
    {
      globalField: "country",
      sourceField: "jobspyCountryIndeed",
      enabledByDefault: true,
    },
    {
      globalField: "workplaceTypes",
      sourceField: "workplaceTypes",
      enabledByDefault: true,
    },
  ],
};

type JobSpySite = NonNullable<Parameters<typeof runJobSpy>[0]["sites"]>[number];

const JOBSPY_SOURCES = new Set<JobSpySite>(["indeed", "linkedin", "glassdoor"]);

function isJobSpySite(source: string): source is JobSpySite {
  return JOBSPY_SOURCES.has(source as JobSpySite);
}

export const manifest: ExtractorManifest = {
  id: "jobspy",
  displayName: "JobSpy",
  providesSources: ["indeed", "linkedin", "glassdoor"],
  capabilities: { locationEvidence: true },
  configSchema: jobspyConfigSchema,
  async run(context: ExtractorRuntimeContext) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    const sites = context.selectedSources.filter(isJobSpySite);

    const result = await runJobSpy({
      sites,
      searchTerms: context.searchTerms,
      location:
        context.settings.searchCities ?? context.settings.jobspyLocation,
      resultsWanted: context.settings.jobspyResultsWanted
        ? parseInt(context.settings.jobspyResultsWanted, 10)
        : undefined,
      countryIndeed: context.settings.jobspyCountryIndeed,
      workplaceTypes: context.settings.workplaceTypes
        ? JSON.parse(context.settings.workplaceTypes)
        : undefined,
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;

        if (event.type === "term_start") {
          context.onProgress?.({
            phase: "list",
            termsProcessed: Math.max(event.termIndex - 1, 0),
            termsTotal: event.termTotal,
            currentUrl: event.searchTerm,
            detail: `JobSpy: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
          });
          return;
        }

        context.onProgress?.({
          phase: "list",
          termsProcessed: event.termIndex,
          termsTotal: event.termTotal,
          currentUrl: event.searchTerm,
          detail: `JobSpy: completed ${event.termIndex}/${event.termTotal} (${event.searchTerm}) with ${event.jobsFoundTerm} jobs`,
        });
      },
    });

    if (!result.success) {
      return {
        success: false,
        jobs: [],
        error: result.error,
      };
    }

    return {
      success: true,
      jobs: result.jobs,
    };
  },
};

export default manifest;
