import { describe, expect, it } from "vitest";
import {
  formatCountryLabel,
  getCompatibleSourcesForCountry,
  isGlassdoorCountry,
  isSourceAllowedForCountry,
  isUkCountry,
  normalizeCountryKey,
  SUPPORTED_COUNTRY_KEYS,
} from "./location-support";

describe("location-support", () => {
  it("normalizes country aliases", () => {
    expect(normalizeCountryKey("UK")).toBe("united kingdom");
    expect(normalizeCountryKey("us")).toBe("united states");
    expect(normalizeCountryKey("usa")).toBe("united states");
    expect(normalizeCountryKey("czech republic")).toBe("czechia");
  });

  it("formats country labels", () => {
    expect(formatCountryLabel("united kingdom")).toBe("United Kingdom");
    expect(formatCountryLabel("usa/ca")).toBe("USA/CA");
    expect(formatCountryLabel("south korea")).toBe("South Korea");
  });

  it("keeps supported country keys unique and canonical", () => {
    expect(SUPPORTED_COUNTRY_KEYS).toContain("united kingdom");
    expect(SUPPORTED_COUNTRY_KEYS).toContain("united states");
    expect(SUPPORTED_COUNTRY_KEYS).toContain("worldwide");
    expect(SUPPORTED_COUNTRY_KEYS).not.toContain("uk");
    expect(SUPPORTED_COUNTRY_KEYS).not.toContain("us");
  });

  it("treats only united kingdom as UK country", () => {
    expect(isUkCountry("united kingdom")).toBe(true);
    expect(isUkCountry("UK")).toBe(true);
    expect(isUkCountry("worldwide")).toBe(false);
    expect(isUkCountry("usa/ca")).toBe(false);
    expect(isUkCountry("united states")).toBe(false);
  });

  it("applies source compatibility rules by country", () => {
    expect(isSourceAllowedForCountry("indeed", "united states")).toBe(true);
    expect(isSourceAllowedForCountry("linkedin", "worldwide")).toBe(true);
    expect(isSourceAllowedForCountry("glassdoor", "united states")).toBe(true);
    expect(isSourceAllowedForCountry("glassdoor", "japan")).toBe(false);
    expect(isSourceAllowedForCountry("startupjobs", "united states")).toBe(
      true,
    );
    expect(isSourceAllowedForCountry("startupjobs", "worldwide")).toBe(true);
  });

  it("filters incompatible sources while preserving compatible order", () => {
    expect(
      getCompatibleSourcesForCountry(
        ["indeed", "glassdoor", "startupjobs", "linkedin"],
        "united states",
      ),
    ).toEqual(["indeed", "glassdoor", "startupjobs", "linkedin"]);
  });

  it("supports glassdoor only in explicitly supported countries", () => {
    expect(isGlassdoorCountry("united kingdom")).toBe(true);
    expect(isGlassdoorCountry("uk")).toBe(true);
    expect(isGlassdoorCountry("usa")).toBe(true);
    expect(isGlassdoorCountry("japan")).toBe(false);
    expect(isGlassdoorCountry("worldwide")).toBe(false);
  });
});
