// @vitest-environment node
import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { extractSegments } from "./extract-segments";
import { extractStoryText } from "./extract-text";
import { normalizeStoryPart } from "./normalize-runs";
import { type DocxPackage, parseDocx } from "./parse-docx";
import { renderDocx } from "./render-docx";
import {
  type DocxFieldSpan,
  SpliceError,
  spliceMarkers,
} from "./splice-markers";
import {
  ALTERNATE_PROBE,
  alternateContentDoc,
  differingRPrDoc,
  docxWithBody,
  fragmentedRunsDoc,
  hyperlinkDoc,
  MULTI_FIELD_TEXT,
  multiFieldSegmentDoc,
  para,
  simpleDoc,
} from "./test/fixture-builder";

function pkgOf(bytes: Uint8Array): DocxPackage {
  const pkg = parseDocx(bytes);
  for (const doc of pkg.storyParts.values()) normalizeStoryPart(doc);
  return pkg;
}

function segmentIdOf(pkg: DocxPackage, includes: string): number {
  const { segments } = extractSegments(pkg.storyParts, pkg.storyPartOrder);
  const hit = segments.find((s) => s.text.includes(includes));
  if (!hit)
    throw new Error(`no segment containing ${JSON.stringify(includes)}`);
  return hit.segmentId;
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof SpliceError) return error.code;
    throw error;
  }
  throw new Error("expected SpliceError, got success");
}

describe("spliceMarkers", () => {
  it("replaces a whole-paragraph span with a single marker run", () => {
    const pkg = pkgOf(simpleDoc());
    const fields: DocxFieldSpan[] = [
      {
        id: "name",
        value: "Jane Q. Applicant",
        segmentId: segmentIdOf(pkg, "Jane Q."),
      },
    ];
    const parts = spliceMarkers(pkg.storyParts, pkg.storyPartOrder, fields);
    expect(parts.get("word/document.xml")).toContain("⟦name⟧");
    expect(parts.get("word/document.xml")).not.toContain("Jane Q. Applicant");
  });

  it("splits runs to hit mid-run boundaries", () => {
    const pkg = pkgOf(multiFieldSegmentDoc());
    const fields: DocxFieldSpan[] = [
      {
        id: "company",
        value: "Acme GmbH",
        segmentId: segmentIdOf(pkg, "Acme"),
      },
    ];
    const xml = spliceMarkers(pkg.storyParts, pkg.storyPartOrder, fields).get(
      "word/document.xml",
    );
    expect(xml).toContain("Senior Engineer at ");
    expect(xml).toContain("⟦company⟧");
    expect(xml).toContain(" since 2021");
  });

  it("splices a span that crossed fragmented runs (post-normalization)", () => {
    const pkg = pkgOf(fragmentedRunsDoc());
    const fields: DocxFieldSpan[] = [
      {
        id: "bullet",
        value: "migration of the rendering",
        segmentId: segmentIdOf(pkg, "migration"),
      },
    ];
    const xml = spliceMarkers(pkg.storyParts, pkg.storyPartOrder, fields).get(
      "word/document.xml",
    );
    expect(xml).toContain("⟦bullet⟧");
  });

  it("carries the first covered run's formatting onto the marker run", () => {
    const pkg = pkgOf(differingRPrDoc());
    const fields: DocxFieldSpan[] = [
      {
        id: "role",
        value: "Senior Engineer",
        segmentId: segmentIdOf(pkg, "Senior"),
      },
    ];
    const xml = spliceMarkers(pkg.storyParts, pkg.storyPartOrder, fields).get(
      "word/document.xml",
    );
    expect(xml).toMatch(
      /<w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">⟦role⟧/,
    );
  });

  it("handles multiple non-overlapping fields in one segment", () => {
    const pkg = pkgOf(multiFieldSegmentDoc());
    const segmentId = segmentIdOf(pkg, MULTI_FIELD_TEXT);
    const fields: DocxFieldSpan[] = [
      { id: "role", value: "Senior Engineer", segmentId },
      { id: "company", value: "Acme GmbH", segmentId },
    ];
    const xml = spliceMarkers(pkg.storyParts, pkg.storyPartOrder, fields).get(
      "word/document.xml",
    );
    expect(xml).toContain("⟦role⟧");
    expect(xml).toContain("⟦company⟧");
    expect(xml).toContain(" at ");
  });

  it("substituting the original values back reproduces the original text", () => {
    const original = multiFieldSegmentDoc();
    const pkg = pkgOf(original);
    const before = extractStoryText(pkg.storyParts, pkg.storyPartOrder);
    const segmentId = segmentIdOf(pkg, MULTI_FIELD_TEXT);
    const fields: DocxFieldSpan[] = [
      { id: "role", value: "Senior Engineer", segmentId },
      { id: "company", value: "Acme GmbH", segmentId },
    ];
    const templated = spliceMarkers(pkg.storyParts, pkg.storyPartOrder, fields);
    const rendered = renderDocx({
      originalArchive: original,
      templatedParts: templated,
      effectiveValues: { role: "Senior Engineer", company: "Acme GmbH" },
    });
    const pkg2 = parseDocx(rendered);
    const after = extractStoryText(pkg2.storyParts, pkg2.storyPartOrder);
    expect(Object.fromEntries(after)).toEqual(Object.fromEntries(before));
  });

  it("leaves NO stale text anywhere when a dual-encoded (AlternateContent) span is tailored", () => {
    const original = alternateContentDoc();
    const pkg = pkgOf(original);
    const fields: DocxFieldSpan[] = [
      {
        id: "probe",
        value: ALTERNATE_PROBE,
        segmentId: segmentIdOf(pkg, ALTERNATE_PROBE),
      },
    ];
    const templated = spliceMarkers(pkg.storyParts, pkg.storyPartOrder, fields);
    expect(templated.get("word/document.xml")).not.toContain("Fallback");
    const rendered = renderDocx({
      originalArchive: original,
      templatedParts: templated,
      effectiveValues: { probe: "TAILORED-REPLACEMENT-TEXT" },
    });
    const raw = new AdmZip(Buffer.from(rendered))
      .getEntry("word/document.xml")
      ?.getData()
      .toString("utf8");
    expect(raw).toBeTruthy();
    expect(raw).not.toContain(ALTERNATE_PROBE);
    expect(raw?.match(/TAILORED-REPLACEMENT-TEXT/g)).toHaveLength(1);
  });

  it("SPAN_NOT_FOUND when the value is absent", () => {
    const pkg = pkgOf(simpleDoc());
    expect(
      codeOf(() =>
        spliceMarkers(pkg.storyParts, pkg.storyPartOrder, [
          { id: "x", value: "not in the document", segmentId: 0 },
        ]),
      ),
    ).toBe("SPAN_NOT_FOUND");
  });

  it("SPAN_AMBIGUOUS when the value occurs twice in the segment", () => {
    const pkg = pkgOf(docxWithBody(para("Python and Python again")));
    expect(
      codeOf(() =>
        spliceMarkers(pkg.storyParts, pkg.storyPartOrder, [
          { id: "skill", value: "Python", segmentId: 0 },
        ]),
      ),
    ).toBe("SPAN_AMBIGUOUS");
  });

  it("OVERLAPPING_SPANS when two fields intersect", () => {
    const pkg = pkgOf(multiFieldSegmentDoc());
    const segmentId = segmentIdOf(pkg, MULTI_FIELD_TEXT);
    expect(
      codeOf(() =>
        spliceMarkers(pkg.storyParts, pkg.storyPartOrder, [
          { id: "a", value: "Senior Engineer at", segmentId },
          { id: "b", value: "at Acme GmbH", segmentId },
        ]),
      ),
    ).toBe("OVERLAPPING_SPANS");
  });

  it("rejects spans crossing a hyperlink boundary with a retryable code", () => {
    const pkg = pkgOf(hyperlinkDoc());
    expect(
      codeOf(() =>
        spliceMarkers(pkg.storyParts, pkg.storyPartOrder, [
          { id: "x", value: "See my", segmentId: 0 },
        ]),
      ),
    ).toBe("SPAN_NOT_FOUND");
  });
});
