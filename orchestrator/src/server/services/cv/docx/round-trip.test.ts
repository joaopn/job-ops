// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ParseDocxError } from "./parse-docx";
import { roundTripCheck } from "./round-trip";
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
  trackedChangesDoc,
  vmlBoxDoc,
} from "./test/fixture-builder";

describe("roundTripCheck", () => {
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
    ["embedded image", imageDoc],
    ["multi-field segment", multiFieldSegmentDoc],
  ];

  for (const [name, build] of fixtures) {
    it(`round-trips ${name} with text preserved`, () => {
      const result = roundTripCheck(build());
      expect(result).toEqual({ ok: true });
    });
  }

  it("propagates parse rejects (tracked changes)", () => {
    expect(() => roundTripCheck(trackedChangesDoc())).toThrowError(
      ParseDocxError,
    );
  });
});
