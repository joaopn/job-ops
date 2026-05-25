import type { ProviderActorTemplate } from "../../types";
import { linkedinJobsScraperTemplate } from "./linkedin-jobs-scraper";

export const APIFY_TEMPLATES: readonly ProviderActorTemplate[] = [
  linkedinJobsScraperTemplate,
];

export function findApifyTemplate(
  id: string,
): ProviderActorTemplate | undefined {
  return APIFY_TEMPLATES.find((template) => template.id === id);
}
