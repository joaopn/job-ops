import type { CreateJobInput, JobSource } from "@shared/types";
import type { ProviderActorTemplate } from "../../types";

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
    "curious_coder/linkedin-jobs-scraper expects pre-built LinkedIn jobs-search URLs (build your search on linkedin.com/jobs and paste the address-bar URL here). The {{maxJobsPerTerm}} placeholder caps result count (the actor enforces a minimum of 10, so smaller values are bumped up to 10). Set scrapeCompany=true if you want company-side fields populated (costs more CUs).",
  defaultInputTemplate: JSON.stringify(
    {
      urls: [
        "https://www.linkedin.com/jobs/search/?keywords=engineer&location=United%20Kingdom&pageNum=0",
      ],
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
