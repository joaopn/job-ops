import { parseSearchCitiesSetting } from "@shared/search-cities.js";
import type { CreateJobInput, JobSource } from "@shared/types";
import type { ProviderActorTemplate, ProviderRunContext } from "../../types";

/**
 * Build the LinkedIn jobs-search URLs the curious_coder actor scrapes, from
 * the live run context. Search terms are OR-joined into a single quoted
 * keyword query (mirroring the jobspy query composition); one URL is emitted
 * per configured location (each city, else the country) so LinkedIn's
 * single-place `location` param is respected. Values are URL-encoded.
 */
function buildLinkedInSearchUrls(context: ProviderRunContext): string[] {
  const terms = context.searchTerms
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  const keywords = terms.map((term) => `"${term}"`).join(" OR ");

  const cities = parseSearchCitiesSetting(context.runGlobals.city);
  const country = (context.runGlobals.country ?? "").trim();
  const locations = cities.length > 0 ? cities : country ? [country] : [];
  const locationList = locations.length > 0 ? locations : [""];

  const urls: string[] = [];
  const seen = new Set<string>();
  for (const location of locationList) {
    const params: string[] = [];
    if (keywords) params.push(`keywords=${encodeURIComponent(keywords)}`);
    if (location) params.push(`location=${encodeURIComponent(location)}`);
    params.push("pageNum=0");
    const url = `https://www.linkedin.com/jobs/search/?${params.join("&")}`;
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }

  return urls.length > 0
    ? urls
    : ["https://www.linkedin.com/jobs/search/?pageNum=0"];
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

function joinSalary(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  if (parts.length === 0) return undefined;
  return parts.join(" – ");
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const linkedinJobsScraperTemplate: ProviderActorTemplate = {
  id: "linkedin-jobs-scraper",
  providerId: "apify",
  actorRef: "curious_coder/linkedin-jobs-scraper",
  displayName: "LinkedIn Jobs Scraper (curious_coder)",
  description:
    "curious_coder/linkedin-jobs-scraper. Search URLs are built automatically from your configured search terms + location (one URL per city, else the country) — you no longer paste LinkedIn URLs here, and any `urls` you set are ignored/overridden. The {{maxJobsPerTerm}} placeholder caps result count (the actor enforces a minimum of 10, so smaller values are bumped up to 10). Set scrapeCompany=true if you want company-side fields populated (costs more CUs).",
  defaultInputTemplate: JSON.stringify(
    {
      scrapeCompany: false,
      count: "{{maxJobsPerTerm}}",
    },
    null,
    2,
  ),
  defaultMappings: {
    maxJobsPerTerm: true,
  },
  placeholderMinimums: {
    maxJobsPerTerm: 10,
  },
  buildInput(context, base) {
    // Honor the configured location/terms by computing the search URLs here;
    // preserve per-instance knobs (scrapeCompany, count) from the substituted
    // stored input and override only `urls`. Self-heals instances created
    // from the old location-pinned default template.
    const baseObj =
      base && typeof base === "object" && !Array.isArray(base)
        ? (base as Record<string, unknown>)
        : {};
    return {
      ...baseObj,
      urls: buildLinkedInSearchUrls(context),
    };
  },
  mapItem(item, context): CreateJobInput | null {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const obj = item as Record<string, unknown>;

    const jobUrl = pickString(obj, ["link", "url", "job_url", "jobUrl"]);
    const title = pickString(obj, ["title", "job_title", "name"]);
    if (!jobUrl || !title) return null;

    const employer =
      pickString(obj, ["companyName", "company_name", "company", "employer"]) ??
      "Unknown";

    const result: CreateJobInput = {
      source: context.sourceId as JobSource,
      title,
      employer,
      jobUrl,
    };

    const sourceJobId = pickString(obj, ["id", "jobId"]);
    if (sourceJobId) result.sourceJobId = sourceJobId;

    const employerUrl = pickString(obj, [
      "companyLinkedinUrl",
      "companyUrl",
      "company_url",
    ]);
    if (employerUrl) result.employerUrl = employerUrl;

    const location = pickString(obj, ["location", "job_location"]);
    if (location) result.location = location;

    const description = pickString(obj, [
      "descriptionText",
      "description_text",
      "description",
      "job_description",
    ]);
    if (description) {
      result.jobDescription = description;
    } else {
      // Fall back to HTML if the actor only returned the rich variant.
      const htmlDescription = pickString(obj, [
        "descriptionHtml",
        "description_html",
      ]);
      if (htmlDescription) {
        const stripped = stripHtml(htmlDescription);
        if (stripped.length > 0) result.jobDescription = stripped;
      }
    }

    const datePosted = pickString(obj, [
      "postedAt",
      "posted_date",
      "date_posted",
    ]);
    if (datePosted) result.datePosted = datePosted;

    const jobType = pickString(obj, ["employmentType", "employment_type"]);
    if (jobType) result.jobType = jobType;

    const jobLevel = pickString(obj, ["seniorityLevel", "level", "seniority"]);
    if (jobLevel) result.jobLevel = jobLevel;

    const jobFunction = pickString(obj, ["jobFunction", "job_function"]);
    if (jobFunction) result.jobFunction = jobFunction;

    const companyIndustry = pickString(obj, ["industries", "industry"]);
    if (companyIndustry) result.companyIndustry = companyIndustry;

    const companyLogo = pickString(obj, ["companyLogo", "company_logo"]);
    if (companyLogo) result.companyLogo = companyLogo;

    const companyDescription = pickString(obj, [
      "companyDescription",
      "company_description",
    ]);
    if (companyDescription) result.companyDescription = companyDescription;

    const salary = joinSalary(obj.salaryInfo ?? obj.salary);
    if (salary) result.salary = salary;

    const applyUrl = pickString(obj, ["applyUrl", "apply_url"]);
    if (applyUrl && applyUrl !== jobUrl) result.applicationLink = applyUrl;

    return result;
  },
};
