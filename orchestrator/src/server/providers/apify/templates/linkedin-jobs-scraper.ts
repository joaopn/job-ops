import type { CreateJobInput, JobSource } from "@shared/types";
import type { ProviderActorTemplate } from "../../types";

interface ScraperItem {
  // The curious_coder/linkedin-jobs-scraper actor returns an array of
  // job objects roughly shaped like the LinkedIn job-posting JSON.
  // Field names below mirror the actor's documented output; missing
  // values produce null/undefined and gracefully degrade.
  id?: string;
  job_url?: string;
  jobUrl?: string;
  applyUrl?: string;
  title?: string;
  job_title?: string;
  company_name?: string;
  companyName?: string;
  location?: string;
  description?: string;
  job_description?: string;
  posted_date?: string;
  postedAt?: string;
  date_posted?: string;
  is_remote?: boolean;
  employment_type?: string;
  job_type?: string;
  level?: string;
  seniority?: string;
}

function pickString(
  obj: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) return trimmed;
    }
  }
  return undefined;
}

function pickBoolean(
  obj: Record<string, unknown>,
  keys: readonly string[],
): boolean | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const lower = value.trim().toLowerCase();
      if (lower === "true" || lower === "remote") return true;
      if (lower === "false" || lower === "onsite") return false;
    }
  }
  return undefined;
}

export const linkedinJobsScraperTemplate: ProviderActorTemplate = {
  id: "linkedin-jobs-scraper",
  providerId: "apify",
  actorRef: "curious_coder/linkedin-jobs-scraper",
  displayName: "LinkedIn Jobs Scraper (curious_coder)",
  description:
    "Apify's curious_coder/linkedin-jobs-scraper. Searches LinkedIn jobs by keyword and location. Requires a personal Apify API token. See https://apify.com/curious_coder/linkedin-jobs-scraper/api for input options.",
  defaultInputTemplate: JSON.stringify(
    {
      keywords: "{{searchTerms}}",
      location: "{{city}}",
      rows: "{{maxJobsPerTerm}}",
    },
    null,
    2,
  ),
  defaultMappings: {
    searchTerms: true,
    city: true,
    maxJobsPerTerm: true,
  },
  mapItem(item, context): CreateJobInput | null {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const obj = item as Record<string, unknown>;
    const _typed = obj as unknown as ScraperItem;
    void _typed;

    const jobUrl = pickString(obj, ["job_url", "jobUrl", "applyUrl", "url"]);
    const title = pickString(obj, ["title", "job_title", "name"]);
    if (!jobUrl || !title) return null;

    const employer =
      pickString(obj, ["company_name", "companyName", "company", "employer"]) ??
      "Unknown";

    const result: CreateJobInput = {
      source: context.sourceId as JobSource,
      title,
      employer,
      jobUrl,
    };

    const location = pickString(obj, ["location", "job_location"]);
    if (location) result.location = location;

    const description = pickString(obj, [
      "description",
      "job_description",
      "descriptionText",
    ]);
    if (description) result.jobDescription = description;

    const datePosted = pickString(obj, [
      "posted_date",
      "postedAt",
      "date_posted",
      "postedTimeAgo",
    ]);
    if (datePosted) result.datePosted = datePosted;

    const isRemote = pickBoolean(obj, ["is_remote", "isRemote", "remote"]);
    if (isRemote !== undefined) result.isRemote = isRemote;

    const jobType = pickString(obj, ["employment_type", "job_type", "jobType"]);
    if (jobType) result.jobType = jobType;

    const jobLevel = pickString(obj, ["level", "seniority", "experienceLevel"]);
    if (jobLevel) result.jobLevel = jobLevel;

    const applyUrl = pickString(obj, ["applyUrl", "apply_url"]);
    if (applyUrl && applyUrl !== jobUrl) result.applicationLink = applyUrl;

    return result;
  },
};
