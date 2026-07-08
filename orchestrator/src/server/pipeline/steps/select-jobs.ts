import { matchJobLocationIntent } from "@shared/job-matching.js";
import { createLocationIntentFromLegacyInputs } from "@shared/location-domain.js";
import { type PipelineConfig, SUITABILITY_CATEGORY_RANK } from "@shared/types";
import type { ScoredJob } from "./types";

function resolveLocationIntent(
  mergedConfig: PipelineConfig,
): NonNullable<PipelineConfig["locationIntent"]> {
  return (
    mergedConfig.locationIntent ?? createLocationIntentFromLegacyInputs({})
  );
}

export async function selectJobsStep(args: {
  scoredJobs: ScoredJob[];
  mergedConfig: PipelineConfig;
}): Promise<ScoredJob[]> {
  const locationIntent = resolveLocationIntent(args.mergedConfig);
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
