// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extractSegments } from "./extract-segments";
import { extractStoryText } from "./extract-text";
import { normalizeStoryPart } from "./normalize-runs";
import { type DocxPackage, parseDocx } from "./parse-docx";
import {
  ALTERNATE_PROBE,
  alternateContentDoc,
  DRAWING_BOX_TEXT,
  docxWithBody,
  drawingBoxDoc,
  FOOTER_TEXT,
  HEADER_TEXT,
  headerFooterDoc,
  hyperlinkDoc,
  p,
  run,
  simpleDoc,
  tableDoc,
  VML_BOX_TEXT,
  vmlBoxDoc,
} from "./test/fixture-builder";

function pkgOf(bytes: Uint8Array): DocxPackage {
  const pkg = parseDocx(bytes);
  for (const doc of pkg.storyParts.values()) normalizeStoryPart(doc);
  return pkg;
}

function segmentTexts(bytes: Uint8Array): string[] {
  const pkg = pkgOf(bytes);
  return extractSegments(pkg.storyParts, pkg.storyPartOrder).segments.map(
    (s) => s.text,
  );
}

describe("extractSegments", () => {
  it("yields one segment per non-empty paragraph, in document order", () => {
    expect(segmentTexts(simpleDoc())).toEqual([
      "Jane Q. Applicant",
      "Vienna, Austria · jane@example.com",
      "Led migration of the rendering fleet to a queue-based architecture.",
      "Cut PDF generation latency by 60% through template precompilation.",
    ]);
  });

  it("walks table cells in document order and skips empty paragraphs", () => {
    expect(segmentTexts(tableDoc())).toEqual([
      "Skills",
      "Python",
      "Experience",
      "Data Engineer, Beispiel AG",
    ]);
  });

  it("includes DrawingML text-box paragraphs as their own segments", () => {
    const texts = segmentTexts(drawingBoxDoc());
    expect(texts).toContain(DRAWING_BOX_TEXT);
    expect(texts).toContain("Main column body text.");
  });

  it("includes VML text-box paragraphs as their own segments", () => {
    const texts = segmentTexts(vmlBoxDoc());
    expect(texts).toContain(VML_BOX_TEXT);
  });

  it("extracts AlternateContent text exactly once (Choice taken, Fallback skipped)", () => {
    const texts = segmentTexts(alternateContentDoc());
    expect(texts.filter((t) => t.includes(ALTERNATE_PROBE))).toHaveLength(1);
  });

  it("covers header and footer parts after the document body", () => {
    const pkg = pkgOf(headerFooterDoc());
    const { segments } = extractSegments(pkg.storyParts, pkg.storyPartOrder);
    const byPart = segments.map((s) => [s.partName, s.text]);
    expect(byPart).toEqual([
      ["word/document.xml", "Body content."],
      ["word/header1.xml", HEADER_TEXT],
      ["word/footer1.xml", `${FOOTER_TEXT}1`],
    ]);
  });

  it("reads through hyperlink wrappers", () => {
    expect(segmentTexts(hyperlinkDoc())).toEqual([
      "See my portfolio for details.",
    ]);
  });

  it("maps tabs and breaks to placeholder characters", () => {
    const doc = docxWithBody(
      p(
        run("col1") +
          "<w:r><w:tab/></w:r>" +
          run("col2") +
          "<w:r><w:br/></w:r>" +
          run("line2"),
      ),
    );
    expect(segmentTexts(doc)).toEqual(["col1\tcol2\nline2"]);
  });

  it("agrees with extract-text on every non-empty line", () => {
    for (const build of [simpleDoc, tableDoc, drawingBoxDoc, headerFooterDoc]) {
      const pkg = pkgOf(build());
      const { segments } = extractSegments(pkg.storyParts, pkg.storyPartOrder);
      const fullText = extractStoryText(pkg.storyParts, pkg.storyPartOrder);
      for (const [partName, text] of fullText) {
        const nonEmptyLines = text.split("\n").filter((l) => l.length > 0);
        const partSegments = segments
          .filter((s) => s.partName === partName)
          .flatMap((s) => s.text.split("\n"))
          .filter((l) => l.length > 0);
        expect(partSegments).toEqual(nonEmptyLines);
      }
    }
  });
});
