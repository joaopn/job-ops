// borderline/indeed-scraper requires an ISO-3166 alpha-2 country code (it
// scrapes the country-specific indeed.com domain). Our run globals carry a
// country display name, so map the names the actor supports to their codes.
// Keys are lowercased/space-collapsed; the code itself is also accepted so a
// user who already stored "us"/"de" resolves cleanly.
const NAME_TO_CODE: Record<string, string> = {
  argentina: "ar",
  australia: "au",
  austria: "at",
  bahrain: "bh",
  belgium: "be",
  brazil: "br",
  canada: "ca",
  chile: "cl",
  china: "cn",
  colombia: "co",
  "costa rica": "cr",
  czechia: "cz",
  "czech republic": "cz",
  denmark: "dk",
  ecuador: "ec",
  egypt: "eg",
  finland: "fi",
  france: "fr",
  germany: "de",
  greece: "gr",
  "hong kong": "hk",
  hungary: "hu",
  india: "in",
  indonesia: "id",
  ireland: "ie",
  israel: "il",
  italy: "it",
  japan: "jp",
  kuwait: "kw",
  luxembourg: "lu",
  malaysia: "my",
  mexico: "mx",
  morocco: "ma",
  netherlands: "nl",
  "new zealand": "nz",
  nigeria: "ng",
  norway: "no",
  oman: "om",
  pakistan: "pk",
  panama: "pa",
  peru: "pe",
  philippines: "ph",
  poland: "pl",
  portugal: "pt",
  qatar: "qa",
  romania: "ro",
  "saudi arabia": "sa",
  singapore: "sg",
  "south africa": "za",
  "south korea": "kr",
  korea: "kr",
  spain: "es",
  sweden: "se",
  switzerland: "ch",
  taiwan: "tw",
  thailand: "th",
  turkey: "tr",
  turkiye: "tr",
  türkiye: "tr",
  ukraine: "ua",
  "united arab emirates": "ae",
  uae: "ae",
  "united kingdom": "uk",
  "great britain": "uk",
  britain: "uk",
  england: "uk",
  scotland: "uk",
  wales: "uk",
  gb: "uk",
  "united states": "us",
  "united states of america": "us",
  usa: "us",
  uruguay: "uy",
  venezuela: "ve",
  vietnam: "vn",
};

// The alpha-2 codes the actor's `country` enum accepts verbatim.
const SUPPORTED_CODES = new Set(Object.values(NAME_TO_CODE));

export function toIndeedCountryCode(
  country: string | undefined,
): string | undefined {
  const normalized = country?.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return undefined;
  if (SUPPORTED_CODES.has(normalized)) return normalized;
  return NAME_TO_CODE[normalized];
}
