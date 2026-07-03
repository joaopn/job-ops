import type { CreateJobInput, JobSource } from "@shared/types";
import type { ProviderActorTemplate } from "../../types";
import { toIndeedCountryCode } from "./indeed-country-codes";
import {
  getSearchTerms,
  joinSalary,
  pickNestedString,
  pickString,
  resolveCities,
  resolveDerivedMaxJobs,
  resolveMaxAgeDays,
  stripHtml,
} from "./mapper-helpers";

// The actor's `fromDays` filter is an enum of relative windows. Bucket the
// resolved max-age-in-days into the tightest window that still covers it,
// rounding UP so nothing in range is excluded (14 days is the widest bucket).
function toFromDays(maxAgeDays: number | undefined): string | undefined {
  if (typeof maxAgeDays !== "number" || maxAgeDays <= 0) return undefined;
  if (maxAgeDays <= 1) return "1";
  if (maxAgeDays <= 3) return "3";
  if (maxAgeDays <= 7) return "7";
  return "14";
}

export const borderlineIndeedTemplate: ProviderActorTemplate = {
  id: "borderline-indeed",
  providerId: "apify",
  actorRef: "borderline/indeed-scraper",
  displayName: "Indeed Jobs Scraper (borderline)",
  description:
    "borderline/indeed-scraper. Search query, location and country are built automatically from your configured search terms + location — no Indeed URLs to paste. Your search terms are OR-joined into one query, and the configured country name is mapped to Indeed's country domain (an unsupported country fails the run rather than silently defaulting to the US). Only the first configured city is used (this actor searches one location per run). The global \"Max job age to scrape\" setting is bucketed into Indeed's date filter (1 / 3 / 7 / 14 days, rounded up). Pay-per-result; duplicates are skipped.",
  defaultInputTemplate: JSON.stringify(
    {
      sort: "date",
      enableUniqueJobs: true,
      includeSimilarJobs: false,
    },
    null,
    2,
  ),
  defaultMappings: {
    maxJobsPerTerm: true,
    maxAgeDays: true,
  },
  buildInput(context, base) {
    const baseObj =
      base && typeof base === "object" && !Array.isArray(base)
        ? (base as Record<string, unknown>)
        : {};
    const terms = getSearchTerms(context);
    const query = terms.map((term) => `"${term}"`).join(" OR ");

    const country = (context.runGlobals.country ?? "").trim();
    const countryCode = toIndeedCountryCode(country);
    if (country && !countryCode) {
      throw new Error(
        `Indeed actor: unsupported country "${country}". Add it to the Indeed country-code map or clear the country setting.`,
      );
    }

    const cities = resolveCities(context.runGlobals);
    const location = cities[0] ?? "";
    const maxAgeDays = resolveMaxAgeDays(
      context.runGlobals,
      context.instance.maxAgeDays,
    );
    const fromDays = toFromDays(maxAgeDays);

    const input: Record<string, unknown> = {
      ...baseObj,
      query,
      maxRows: Math.max(
        1,
        resolveDerivedMaxJobs(
          context.runGlobals,
          terms.length,
          context.instance.maxJobs,
        ),
      ),
    };
    if (countryCode) input.country = countryCode;
    if (location) input.location = location;
    if (fromDays) input.fromDays = fromDays;
    return input;
  },
  mapItem(item, context): CreateJobInput | null {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const obj = item as Record<string, unknown>;

    const jobUrl = pickString(obj, ["jobUrl", "url", "job_url"]);
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

    const sourceJobId = pickString(obj, ["jobKey", "id", "jobId"]);
    if (sourceJobId) result.sourceJobId = sourceJobId;

    const employerUrl = pickString(obj, ["companyUrl", "company_url"]);
    if (employerUrl) result.employerUrl = employerUrl;

    // `location` is a nested object on this actor; fall back to a plain string
    // in case the shape ever changes.
    const location =
      pickNestedString(obj, "location", [
        "formattedAddressShort",
        "formattedAddressLong",
        "fullAddress",
        "city",
      ]) ?? pickString(obj, ["location", "job_location"]);
    if (location) result.location = location;

    const description = pickString(obj, [
      "descriptionText",
      "description_text",
      "description",
    ]);
    if (description) {
      result.jobDescription = description;
    } else {
      const htmlDescription = pickString(obj, [
        "descriptionHtml",
        "description_html",
      ]);
      if (htmlDescription) {
        const stripped = stripHtml(htmlDescription);
        if (stripped.length > 0) result.jobDescription = stripped;
      }
    }

    const datePosted = pickString(obj, ["datePublished", "postedAt", "date"]);
    if (datePosted) result.datePosted = datePosted;

    const jobType = pickString(obj, ["jobType", "employment_type"]);
    if (jobType) result.jobType = jobType;

    const companyIndustry = pickString(obj, ["companyIndustry", "industry"]);
    if (companyIndustry) result.companyIndustry = companyIndustry;

    const companyDescription = pickString(obj, [
      "companyDescription",
      "companyBriefDescription",
    ]);
    if (companyDescription) result.companyDescription = companyDescription;

    const companyLogo = pickString(obj, ["companyLogoUrl", "companyLogo"]);
    if (companyLogo) result.companyLogo = companyLogo;

    // `salary` is a nested object on this actor; fall back to string/array.
    const salary =
      pickNestedString(obj, "salary", ["salaryText"]) ?? joinSalary(obj.salary);
    if (salary) result.salary = salary;

    const applyUrl = pickString(obj, ["applyUrl", "apply_url"]);
    if (applyUrl && applyUrl !== jobUrl) result.applicationLink = applyUrl;

    return result;
  },
};
