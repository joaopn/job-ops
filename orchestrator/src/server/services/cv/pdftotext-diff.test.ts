// @vitest-environment node
import { describe, expect, it } from "vitest";
import { comparePdftotextOutput } from "./pdftotext-diff";

/**
 * `pdftotextDiff` itself spawns the poppler binary; that's covered by the
 * runtime smoke test, not vitest. These cases pin the pure normalise +
 * diff comparison the gate relies on.
 */
describe("comparePdftotextOutput", () => {
  it("reports ok when both inputs normalise to the same lines", () => {
    const result = comparePdftotextOutput(
      "Hello   world\n\n\nLine two",
      "  Hello world\nLine two\n",
    );
    expect(result.ok).toBe(true);
    expect(result.diff).toBe("");
    expect(result.divergentLines).toBe(0);
  });

  it("ignores blank lines and leading/trailing whitespace", () => {
    const result = comparePdftotextOutput(
      "\n\n  Alpha   beta  \n  \n",
      "Alpha beta",
    );
    expect(result.ok).toBe(true);
  });

  it("flags divergence when content differs", () => {
    const result = comparePdftotextOutput(
      "Alpha\nBeta\nGamma",
      "Alpha\nBETA\nGamma",
    );
    expect(result.ok).toBe(false);
    expect(result.diff).toContain("- Beta");
    expect(result.diff).toContain("+ BETA");
    expect(result.divergentLines).toBeGreaterThan(0);
  });

  it("reports added lines when candidate is longer", () => {
    const result = comparePdftotextOutput("A\nB", "A\nB\nC");
    expect(result.ok).toBe(false);
    expect(result.diff).toContain("+ C");
  });

  it("reports removed lines when candidate is shorter", () => {
    const result = comparePdftotextOutput("A\nB\nC", "A\nB");
    expect(result.ok).toBe(false);
    expect(result.diff).toContain("- C");
  });

  it("collapses runs of internal whitespace before comparing", () => {
    // PDF text extraction often emits weird mid-line whitespace. The
    // gate must treat 'Alpha     beta' and 'Alpha beta' as identical.
    const result = comparePdftotextOutput(
      "Alpha     beta\tgamma",
      "Alpha beta gamma",
    );
    expect(result.ok).toBe(true);
  });
});
