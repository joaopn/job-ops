import { describe, expect, it } from "vitest";
import { normalizeDuplicateKey } from "./duplicate-key";

describe("normalizeDuplicateKey", () => {
  it("collapses case, punctuation, and whitespace differences", () => {
    expect(normalizeDuplicateKey("Senior Data Engineer", "Acme Corp")).toBe(
      normalizeDuplicateKey("senior   data engineer", "ACME  corp"),
    );
    expect(normalizeDuplicateKey("Sr. Eng.", "Globex, Inc.")).toBe(
      normalizeDuplicateKey("Sr Eng", "Globex Inc"),
    );
  });

  it("keeps distinct title or company apart", () => {
    expect(normalizeDuplicateKey("Backend Engineer", "Acme")).not.toBe(
      normalizeDuplicateKey("Frontend Engineer", "Acme"),
    );
    expect(normalizeDuplicateKey("Backend Engineer", "Acme")).not.toBe(
      normalizeDuplicateKey("Backend Engineer", "Globex"),
    );
  });

  it("returns an empty key when both fields normalize away", () => {
    expect(normalizeDuplicateKey("", "")).toBe("");
    expect(normalizeDuplicateKey("  ", "—")).toBe("");
  });

  it("does not collapse abbreviations to their expansions", () => {
    // Intentionally exact-after-normalization: 'Sr' != 'Senior'.
    expect(normalizeDuplicateKey("Sr Engineer", "Acme")).not.toBe(
      normalizeDuplicateKey("Senior Engineer", "Acme"),
    );
  });
});
