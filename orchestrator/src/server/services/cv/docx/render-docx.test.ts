// @vitest-environment node
import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { extractStoryText } from "./extract-text";
import { parseDocx } from "./parse-docx";
import { extractMarkerIds, RenderDocxError, renderDocx } from "./render-docx";
import {
  documentXml,
  docxWithBody,
  imageDoc,
  para,
  simpleDoc,
} from "./test/fixture-builder";

function templatedWith(body: string): Map<string, string> {
  return new Map([["word/document.xml", documentXml(body)]]);
}

function renderedText(
  templated: Map<string, string>,
  values: Record<string, string>,
): string {
  const rendered = renderDocx({
    originalArchive: simpleDoc(),
    templatedParts: templated,
    effectiveValues: values,
  });
  const pkg = parseDocx(rendered);
  return extractStoryText(pkg.storyParts, pkg.storyPartOrder).get(
    "word/document.xml",
  ) as string;
}

describe("renderDocx", () => {
  it("XML-escapes substituted values", () => {
    const text = renderedText(templatedWith(para("Hello ⟦name⟧!")), {
      name: `A&B <C> "D" 'E'`,
    });
    expect(text).toBe(`Hello A&B <C> "D" 'E'!`);
  });

  it("turns newlines into w:br and tabs into w:tab", () => {
    const templated = templatedWith(para("⟦block⟧"));
    const rendered = renderDocx({
      originalArchive: simpleDoc(),
      templatedParts: templated,
      effectiveValues: { block: "line1\nline2\tend" },
    });
    const raw = new AdmZip(Buffer.from(rendered))
      .getEntry("word/document.xml")
      ?.getData()
      .toString("utf8") as string;
    expect(raw).toContain("<w:br/>");
    expect(raw).toContain("<w:tab/>");
    expect(renderedText(templated, { block: "line1\nline2\tend" })).toBe(
      "line1\nline2\tend",
    );
  });

  it("substitutes ids that prefix each other correctly", () => {
    const text = renderedText(templatedWith(para("⟦exp⟧ / ⟦exp.title⟧")), {
      exp: "SHORT",
      "exp.title": "LONG",
    });
    expect(text).toBe("SHORT / LONG");
  });

  it("hard-fails on a leftover marker", () => {
    expect(() =>
      renderDocx({
        originalArchive: simpleDoc(),
        templatedParts: templatedWith(para("⟦ghost⟧")),
        effectiveValues: {},
      }),
    ).toThrowError(RenderDocxError);
    try {
      renderDocx({
        originalArchive: simpleDoc(),
        templatedParts: templatedWith(para("⟦ghost⟧")),
        effectiveValues: {},
      });
    } catch (error) {
      expect((error as RenderDocxError).code).toBe("MISSING_FIELD");
    }
  });

  it("hard-fails when a templated part has no matching archive entry", () => {
    try {
      renderDocx({
        originalArchive: simpleDoc(),
        templatedParts: new Map([["word/nonexistent.xml", "<x/>"]]),
        effectiveValues: {},
      });
      throw new Error("expected RenderDocxError");
    } catch (error) {
      expect((error as RenderDocxError).code).toBe("MISSING_PART");
    }
  });

  it("preserves untouched zip entries byte-for-byte", () => {
    const original = imageDoc();
    const originalZip = new AdmZip(Buffer.from(original));
    const documentBefore = originalZip
      .getEntry("word/document.xml")
      ?.getData()
      .toString("utf8") as string;
    const rendered = renderDocx({
      originalArchive: original,
      templatedParts: new Map([["word/document.xml", documentBefore]]),
      effectiveValues: {},
    });
    const renderedZip = new AdmZip(Buffer.from(rendered));
    for (const name of ["word/media/image1.png", "[Content_Types].xml"]) {
      expect(renderedZip.getEntry(name)?.getData()).toEqual(
        originalZip.getEntry(name)?.getData(),
      );
    }
  });

  it("extractMarkerIds lists every referenced fieldId", () => {
    const xml = documentXml(para("⟦a⟧ mid ⟦b.c⟧") + para("⟦a⟧ again"));
    expect([...extractMarkerIds(xml)].sort()).toEqual(["a", "b.c"]);
  });
});

describe("renderDocx round-trips a docx built from fixtures", () => {
  it("renders a no-op template to a package that still parses", () => {
    const original = docxWithBody(para("Stable content."));
    const raw = new AdmZip(Buffer.from(original))
      .getEntry("word/document.xml")
      ?.getData()
      .toString("utf8") as string;
    const rendered = renderDocx({
      originalArchive: original,
      templatedParts: new Map([["word/document.xml", raw]]),
      effectiveValues: {},
    });
    const pkg = parseDocx(rendered);
    expect(
      extractStoryText(pkg.storyParts, pkg.storyPartOrder).get(
        "word/document.xml",
      ),
    ).toBe("Stable content.");
  });
});
