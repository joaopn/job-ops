import { describe, expect, it } from "vitest";
import { DateNormalizationError, normalizeDatePosted } from "./date-normalize";

describe("normalizeDatePosted", () => {
  it("returns null for null/undefined/empty", () => {
    expect(normalizeDatePosted(null)).toBeNull();
    expect(normalizeDatePosted(undefined)).toBeNull();
    expect(normalizeDatePosted("")).toBeNull();
    expect(normalizeDatePosted("   ")).toBeNull();
  });

  it("converts Unix-ms numeric strings to ISO", () => {
    // 2026-04-25T00:00:00.000Z
    expect(normalizeDatePosted("1777075200000")).toBe("2026-04-25T00:00:00.000Z");
  });

  it("converts numeric Unix-ms inputs to ISO", () => {
    expect(normalizeDatePosted(1777075200000)).toBe("2026-04-25T00:00:00.000Z");
  });

  it("normalises a date-only ISO string to full ISO", () => {
    expect(normalizeDatePosted("2026-04-23")).toBe("2026-04-23T00:00:00.000Z");
  });

  it("passes a full ISO string through unchanged", () => {
    expect(normalizeDatePosted("2026-04-23T12:34:56.000Z")).toBe(
      "2026-04-23T12:34:56.000Z",
    );
  });

  it("throws DateNormalizationError on unrecognised text", () => {
    expect(() => normalizeDatePosted("not a date")).toThrow(
      DateNormalizationError,
    );
  });

  it("throws DateNormalizationError on negative numeric input", () => {
    expect(() => normalizeDatePosted(-1)).toThrow(DateNormalizationError);
  });

  it("throws DateNormalizationError on non-finite numeric input", () => {
    expect(() => normalizeDatePosted(Number.NaN)).toThrow(
      DateNormalizationError,
    );
  });

  it("surfaces the raw value on the error instance", () => {
    try {
      normalizeDatePosted("not a date");
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DateNormalizationError);
      expect((error as DateNormalizationError).rawValue).toBe("not a date");
    }
  });
});
