import * as settingsRepo from "@server/repositories/settings";

/**
 * Whether post-import / post-rescrape suitability scoring is enabled. Unset
 * defaults to on (matches the bulk-pipeline behavior). Shared by the batch-URL
 * importer and the per-job rescrape action so neither route imports the other.
 */
export async function isJobScoringEnabled(): Promise<boolean> {
  const raw = await settingsRepo.getSetting("enableJobScoring");
  if (raw === null) return true;
  return raw === "1" || raw === "true";
}
