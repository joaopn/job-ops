import type { ProviderActorTemplate } from "../../types";
import { borderlineIndeedTemplate } from "./borderline-indeed";
import { cheapScraperLinkedinTemplate } from "./cheap-scraper-linkedin";
import { linkedinJobsScraperTemplate } from "./linkedin-jobs-scraper";

export const APIFY_TEMPLATES: readonly ProviderActorTemplate[] = [
  linkedinJobsScraperTemplate,
  cheapScraperLinkedinTemplate,
  borderlineIndeedTemplate,
];

export function findApifyTemplate(
  id: string,
): ProviderActorTemplate | undefined {
  return APIFY_TEMPLATES.find((template) => template.id === id);
}
