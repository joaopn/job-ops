// @vitest-environment node
import { describe, expect, it } from "vitest";
import { extractStoryText } from "./extract-text";
import { normalizeStoryPart } from "./normalize-runs";
import { type DocxPackage, parseDocx } from "./parse-docx";
import {
  alternateContentDoc,
  differingRPrDoc,
  drawingBoxDoc,
  fragmentedRunsDoc,
  headerFooterDoc,
  hyperlinkDoc,
  imageDoc,
  multiFieldSegmentDoc,
  reorderedRPrDoc,
  simpleDoc,
  tableDoc,
  vmlBoxDoc,
} from "./test/fixture-builder";
import { collectRuns, walkParagraphs } from "./traverse";
import { serializeXml, type XmlElement } from "./xml";

function normalized(bytes: Uint8Array): DocxPackage {
  const pkg = parseDocx(bytes);
  for (const doc of pkg.storyParts.values()) normalizeStoryPart(doc);
  return pkg;
}

function firstParagraphRuns(pkg: DocxPackage): XmlElement[] {
  const root = pkg.storyParts.get("word/document.xml")?.documentElement;
  if (!root) throw new Error("missing document root");
  const paragraphs: XmlElement[] = [];
  walkParagraphs(root, (p) => paragraphs.push(p));
  return collectRuns(paragraphs[0]);
}

describe("normalizeStoryPart", () => {
  it("merges rsid-fragmented runs with identical formatting into one", () => {
    const pkg = normalized(fragmentedRunsDoc());
    const runs = firstParagraphRuns(pkg);
    expect(runs).toHaveLength(1);
  });

  it("strips proofErr and rsid attributes", () => {
    const pkg = normalized(fragmentedRunsDoc());
    const root = pkg.storyParts.get("word/document.xml")?.documentElement;
    if (!root) throw new Error("missing document root");
    const xml = serializeXml(root);
    expect(xml).not.toContain("proofErr");
    expect(xml).not.toContain("rsid");
  });

  it("does not merge runs with different formatting", () => {
    const pkg = normalized(differingRPrDoc());
    expect(firstParagraphRuns(pkg)).toHaveLength(2);
  });

  it("does not merge runs whose rPr children are reordered (documented, accepted)", () => {
    const pkg = normalized(reorderedRPrDoc());
    expect(firstParagraphRuns(pkg)).toHaveLength(2);
  });

  it("removes mc:Fallback when a Choice exists (stale-branch impossibility)", () => {
    const pkg = normalized(alternateContentDoc());
    const root = pkg.storyParts.get("word/document.xml")?.documentElement;
    if (!root) throw new Error("missing document root");
    const xml = serializeXml(root);
    expect(xml).not.toContain("Fallback");
    expect(xml).toContain("Choice");
  });

  const fixtures: Array<[string, () => Uint8Array]> = [
    ["simple", simpleDoc],
    ["fragmented runs", fragmentedRunsDoc],
    ["differing rPr", differingRPrDoc],
    ["reordered rPr", reorderedRPrDoc],
    ["table layout", tableDoc],
    ["DrawingML text box", drawingBoxDoc],
    ["VML text box", vmlBoxDoc],
    ["AlternateContent", alternateContentDoc],
    ["hyperlink", hyperlinkDoc],
    ["header/footer", headerFooterDoc],
    ["image", imageDoc],
    ["multi-field segment", multiFieldSegmentDoc],
  ];

  for (const [name, build] of fixtures) {
    it(`never changes extracted text (${name})`, () => {
      const pkg = parseDocx(build());
      const before = extractStoryText(pkg.storyParts, pkg.storyPartOrder);
      for (const doc of pkg.storyParts.values()) normalizeStoryPart(doc);
      const after = extractStoryText(pkg.storyParts, pkg.storyPartOrder);
      expect(Object.fromEntries(after)).toEqual(Object.fromEntries(before));
    });
  }
});
