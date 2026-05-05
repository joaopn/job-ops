import * as settingsRepo from "@server/repositories/settings";
import { matchJobLocationIntent } from "@shared/job-matching.js";
import { createLocationIntentFromLegacyInputs } from "@shared/location-domain.js";
import { resolveSearchCities } from "@shared/search-cities.js";
import {
  SUITABILITY_CATEGORY_RANK,
  type PipelineConfig,
} from "@shared/types";
import type { ScoredJob } from "./types";

function parseWorkplaceTypes(
  raw: string | undefined,
): Array<"remote" | "hybrid" | "onsite"> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is "remote" | "hybrid" | "onsite" =>
        value === "remote" || value === "hybrid" || value === "onsite",
    );
  } catch {
    return [];
  }
}

async function resolveLocationIntent(
  mergedConfig: PipelineConfig,
): Promise<NonNullable<PipelineConfig["locationIntent"]>> {
  if (mergedConfig.locationIntent) return mergedConfig.locationIntent;

  const settings = await settingsRepo.getAllSettings();
  return createLocationIntentFromLegacyInputs({
    selectedCountry: settings.jobspyCountryIndeed ?? "",
    cityLocations: resolveSearchCities({
      single: settings.searchCities ?? settings.jobspyLocation ?? null,
    }),
    workplaceTypes: parseWorkplaceTypes(settings.workplaceTypes),
    geoScope: settings.locationSearchScope ?? null,
    matchStrictness: settings.locationMatchStrictness ?? null,
  });
}

export async function selectJobsStep(args: {
  scoredJobs: ScoredJob[];
  mergedConfig: PipelineConfig;
}): Promise<ScoredJob[]> {
  const locationIntent = await resolveLocationIntent(args.mergedConfig);
  const prioritizeSelectedLocations =
    locationIntent.geoScope === "remote_worldwide_prioritize_selected";

  const minRank =
    SUITABILITY_CATEGORY_RANK[args.mergedConfig.minSuitabilityCategory];

  const ranked = args.scoredJobs
    .filter(
      (job) => SUITABILITY_CATEGORY_RANK[job.suitabilityCategory] >= minRank,
    )
    .sort((left, right) => {
      const rankDelta =
        SUITABILITY_CATEGORY_RANK[right.suitabilityCategory] -
        SUITABILITY_CATEGORY_RANK[left.suitabilityCategory];
      if (rankDelta !== 0) return rankDelta;

      if (prioritizeSelectedLocations) {
        const leftPriority = matchJobLocationIntent(
          left,
          locationIntent,
        ).priority;
        const rightPriority = matchJobLocationIntent(
          right,
          locationIntent,
        ).priority;
        const priorityDelta = rightPriority - leftPriority;
        if (priorityDelta !== 0) return priorityDelta;
      }

      // Final tiebreaker: most recently discovered first.
      return right.discoveredAt.localeCompare(left.discoveredAt);
    });

  // topN caps the auto-tailor budget. When auto-tailoring is off the user
  // picks from the full ranked list manually, so the cap doesn't apply.
  if (!args.mergedConfig.enableAutoTailoring) return ranked;
  return ranked.slice(0, args.mergedConfig.topN);
}
