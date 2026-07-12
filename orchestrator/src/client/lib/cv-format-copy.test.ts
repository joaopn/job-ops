import { describe, expect, it } from "vitest";
import { getCvFormatCopy } from "./cv-format-copy";

describe("getCvFormatCopy", () => {
  it("accepts .tex and .zip on a latex profile", () => {
    expect(getCvFormatCopy("latex").acceptedExtensions).toEqual([
      ".tex",
      ".zip",
    ]);
  });

  it("accepts only .docx on a word profile", () => {
    expect(getCvFormatCopy("docx").acceptedExtensions).toEqual([".docx"]);
  });

  it("never mentions LaTeX or tectonic in the word copy", () => {
    const copy = getCvFormatCopy("docx");
    const prose = [
      copy.dropHint,
      copy.uploadSubtitle,
      copy.uploadDescription,
      copy.uploadingLabel,
      copy.sourceStderrLabel,
      copy.fieldsDescription,
      copy.compileLogTitle,
      copy.compileLogDescription,
    ].join(" ");

    expect(prose).not.toMatch(/latex|tectonic|\.tex|\.zip/i);
  });

  it("keeps the latex copy on the latex substrate", () => {
    const copy = getCvFormatCopy("latex");
    expect(copy.dropHint).toContain(".tex");
    expect(copy.sourceStderrLabel).toContain("Tectonic");
    expect(copy.compileLogTitle).toBe("Compile log");
  });

  it("returns a distinct copy table per format", () => {
    expect(getCvFormatCopy("docx")).not.toEqual(getCvFormatCopy("latex"));
  });
});
