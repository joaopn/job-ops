/**
 * Canonicalize a job posting URL for dedup + storage.
 *
 * Scrapers surface the SAME posting under links that differ only by tracking
 * query params (LinkedIn `refId` / `trackingId`, `utm_*`, ad-click ids, etc.).
 * Keying dedup on the raw URL then treats one job as many. We strip a denylist
 * of KNOWN tracking params while preserving every other param, because some
 * boards encode the job's identity in the query string (Indeed `jk`, LinkedIn
 * collection `currentJobId`, …) — a blanket "drop all query" would merge
 * genuinely different jobs. The fragment is never part of identity, so it goes.
 *
 * Conservative by design: when in doubt a param is KEPT. Returns the input
 * unchanged (trimmed) when it can't be parsed as an absolute URL.
 */
const TRACKING_PARAMS = new Set<string>([
  // LinkedIn
  "refid",
  "trackingid",
  "trk",
  "trkinfo",
  "originalsubdomain",
  "position",
  "pagenum",
  "eballotid",
  "lipi",
  // UTM / analytics
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  // Ad-click / share ids
  "gclid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  // Indeed-family tracking (identity lives in `jk` / `vjk`, which we keep)
  "from",
  "tk",
  "vjs",
  "advn",
  "adid",
]);

export function canonicalizeJobUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }

  const kept: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) continue;
    kept.push([key, value]);
  }

  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  url.hash = "";

  return url.toString();
}
