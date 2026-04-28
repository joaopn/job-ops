// @vitest-environment node
import type { CvField } from "@shared/types";
import { describe, expect, it } from "vitest";
import { findUnreachableField, renderCv, RenderCvError } from "./render";

const SOURCE = `\\documentclass{article}
\\name{Ada Lovelace}
\\position{Engineer at ACME}
\\experience{Engineer at ACME}{2020 -- 2022}
\\experience{Engineer at Globex}{2022 -- 2024}
`;

const FIELDS: CvField[] = [
  { id: "basics.name", role: "name", value: "Ada Lovelace" },
  { id: "basics.position", role: "title", value: "Engineer at ACME" },
  { id: "experience.0.title", role: "title", value: "Engineer at ACME" },
  { id: "experience.0.dates", role: "date", value: "2020 -- 2022" },
  { id: "experience.1.title", role: "title", value: "Engineer at Globex" },
  { id: "experience.1.dates", role: "date", value: "2022 -- 2024" },
];

describe("renderCv", () => {
  it("returns the source byte-for-byte when no overrides are applied", () => {
    expect(renderCv(SOURCE, FIELDS, {})).toBe(SOURCE);
  });

  it("substitutes a single field's override into the source", () => {
    const result = renderCv(SOURCE, FIELDS, {
      "basics.name": "Ada L. Byron",
    });
    expect(result).toContain("\\name{Ada L. Byron}");
    expect(result).not.toContain("Ada Lovelace");
  });

  it("walks the cursor forward so repeated values resolve to distinct occurrences", () => {
    // Both "Engineer at ACME" instances live in the source. The first one
    // (basics.position) is overridden; the second one (experience.0.title)
    // is left alone because the cursor advanced past the first.
    const result = renderCv(SOURCE, FIELDS, {
      "basics.position": "Senior Engineer at ACME",
    });
    expect(result).toContain("\\position{Senior Engineer at ACME}");
    expect(result).toContain("\\experience{Engineer at ACME}");
  });

  it("preserves LaTeX-escaped chars verbatim in field values", () => {
    const source = "\\name{Ada \\& Co.}\n\\position{Engineer}";
    const fields: CvField[] = [
      { id: "basics.name", role: "name", value: "Ada \\& Co." },
      { id: "basics.position", role: "title", value: "Engineer" },
    ];
    const result = renderCv(source, fields, {
      "basics.name": "Ada \\& Co. Ltd.",
    });
    expect(result).toBe("\\name{Ada \\& Co. Ltd.}\n\\position{Engineer}");
  });

  it("throws when an override contains a forbidden pattern", () => {
    expect(() =>
      renderCv(SOURCE, FIELDS, {
        "basics.name": "Evil\\write18{rm -rf /}",
      }),
    ).toThrow(RenderCvError);
  });
});

describe("findUnreachableField", () => {
  it("returns null when every field is in document order", () => {
    expect(findUnreachableField(SOURCE, FIELDS)).toBeNull();
  });

  it("returns the index of the first out-of-order field", () => {
    const reordered = [...FIELDS];
    [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
    // After the swap, basics.position ("Engineer at ACME") is checked
    // first and found, advancing the cursor past "Ada Lovelace". The
    // subsequent "Ada Lovelace" lookup fails.
    expect(findUnreachableField(SOURCE, reordered)).toBe(1);
  });

  it("returns the index of a field whose value is absent from the source", () => {
    const fields: CvField[] = [
      ...FIELDS,
      { id: "extra", role: "other", value: "DOES_NOT_EXIST" },
    ];
    expect(findUnreachableField(SOURCE, fields)).toBe(FIELDS.length);
  });
});
