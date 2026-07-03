import { parseSearchCitiesSetting } from "@shared/search-cities.js";
import type { ProviderRunContext } from "../../types";

export function getSearchTerms(context: ProviderRunContext): string[] {
  return context.searchTerms
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
}

export function resolveCities(
  runGlobals: ProviderRunContext["runGlobals"],
): string[] {
  return parseSearchCitiesSetting(runGlobals.city);
}

// Effective max job age in days: the per-instance override when set, else the
// global "Max job age to scrape" setting (runGlobals), else undefined (no
// recency filter).
export function resolveMaxAgeDays(
  runGlobals: ProviderRunContext["runGlobals"],
  instanceMaxAgeDays?: number,
): number | undefined {
  if (typeof instanceMaxAgeDays === "number" && instanceMaxAgeDays > 0) {
    return Math.floor(instanceMaxAgeDays);
  }
  const parsed = Number(runGlobals.maxAgeDays);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

// Resolve a jobs cap: the per-instance `maxJobs` verbatim when set (the exposed
// override), else the budget-derived value. `maxJobsPerTerm` is a per-(term ×
// source) budget; these actors take a single joined query per run, so the
// budget is multiplied by the term count. Each actor clamps this to its own
// schema minimum at the call site.
export function resolveDerivedMaxJobs(
  runGlobals: ProviderRunContext["runGlobals"],
  termCount: number,
  instanceMaxJobs?: number,
): number {
  if (typeof instanceMaxJobs === "number" && instanceMaxJobs > 0) {
    return Math.floor(instanceMaxJobs);
  }
  const parsed = Number(runGlobals.maxJobsPerTerm);
  const perTerm = Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
  return perTerm * Math.max(1, termCount);
}

export function pickString(
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

// Read a string leaf from a nested object node (e.g. Indeed's `location` and
// `salary` objects). Returns undefined when the node is missing/not an object
// or none of the keys hold a non-empty string.
export function pickNestedString(
  obj: Record<string, unknown>,
  parentKey: string,
  keys: readonly string[],
): string | undefined {
  const parent = obj[parentKey];
  if (!parent || typeof parent !== "object" || Array.isArray(parent)) {
    return undefined;
  }
  return pickString(parent as Record<string, unknown>, keys);
}

export function joinSalary(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  if (parts.length === 0) return undefined;
  return parts.join(" – ");
}

export function stripHtml(html: string): string {
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
