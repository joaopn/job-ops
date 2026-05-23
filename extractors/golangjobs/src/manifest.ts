import { resolveSearchCities } from "job-ops-shared/search-cities";
import type {
  ExtractorManifest,
  ExtractorProgressEvent,
  SourceConfigSchema,
} from "job-ops-shared/types";
import { runGolangJobs } from "./run";

const golangjobsConfigSchema: SourceConfigSchema = {
  fields: [
    {
      key: "max_jobs_per_term",
      label: "Max jobs per term",
      type: "number",
      default: "50",
    },
    {
      key: "searchCities",
      label: "Search cities",
      type: "text",
      default: "",
      description:
        "Authoritative city fallback. Used when the Run modal's city mapping is disabled.",
    },
    {
      key: "workplaceTypes",
      label: "Workplace types",
      type: "text",
      default: "",
      description:
        'JSON-encoded array of "remote" | "hybrid" | "onsite". Used when the Run modal\'s workplace-types mapping is disabled.',
    },
  ],
  globalMappings: [
    {
      globalField: "city",
      sourceField: "searchCities",
      enabledByDefault: true,
    },
    {
      globalField: "workplaceTypes",
      sourceField: "workplaceTypes",
      enabledByDefault: true,
    },
    {
      globalField: "maxJobsPerTerm",
      sourceField: "max_jobs_per_term",
      enabledByDefault: true,
    },
  ],
};

function toProgress(event: {
  type: string;
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}): ExtractorProgressEvent {
  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `Golang Jobs: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
    };
  }

  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: event.searchTerm,
    jobPagesEnqueued: event.jobsFoundTerm ?? 0,
    jobPagesProcessed: event.jobsFoundTerm ?? 0,
    detail: `Golang Jobs: completed ${event.termIndex}/${event.termTotal} (${event.searchTerm}) with ${event.jobsFoundTerm ?? 0} jobs`,
  };
}

export const manifest: ExtractorManifest = {
  id: "golangjobs",
  displayName: "Golang Jobs",
  providesSources: ["golangjobs"],
  configSchema: golangjobsConfigSchema,
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    const parsedMaxJobsPerTerm = context.settings.max_jobs_per_term
      ? Number.parseInt(context.settings.max_jobs_per_term, 10)
      : Number.NaN;
    const maxJobsPerTerm = Number.isFinite(parsedMaxJobsPerTerm)
      ? Math.max(1, parsedMaxJobsPerTerm)
      : 50;

    const result = await runGolangJobs({
      selectedCountry: context.selectedCountry,
      searchTerms: context.searchTerms,
      locations: resolveSearchCities({
        single: context.settings.searchCities,
      }),
      workplaceTypes: context.settings.workplaceTypes
        ? JSON.parse(context.settings.workplaceTypes)
        : undefined,
      maxJobsPerTerm,
      shouldCancel: context.shouldCancel,
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.(toProgress(event));
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
