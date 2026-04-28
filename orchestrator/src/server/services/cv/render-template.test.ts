// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  extractMarkerIds,
  markerFor,
  renderTemplate,
  RenderTemplateError,
} from "./render-template";

describe("markerFor", () => {
  it("wraps a fieldId in guillemets", () => {
    expect(markerFor("basics.name")).toBe("«basics.name»");
  });
});

describe("renderTemplate", () => {
  it("substitutes a single marker", () => {
    const out = renderTemplate("Hello «basics.name»!", {
      "basics.name": "Ada",
    });
    expect(out).toBe("Hello Ada!");
  });

  it("substitutes every occurrence of a repeated marker", () => {
    const out = renderTemplate("«x» and «x» again", { x: "Y" });
    expect(out).toBe("Y and Y again");
  });

  it("renders multiple distinct markers", () => {
    const out = renderTemplate(
      "\\textbf{«basics.name»} \\textit{«basics.title»}",
      {
        "basics.name": "Ada",
        "basics.title": "Engineer",
      },
    );
    expect(out).toBe("\\textbf{Ada} \\textit{Engineer}");
  });

  it("replaces longer fieldIds before shorter prefixes", () => {
    // If we replaced "x.0" first, "x.0.title" would lose its stem.
    // The renderer must replace longest-first.
    const out = renderTemplate("«x.0.title» — «x.0»", {
      "x.0": "Outer",
      "x.0.title": "Inner",
    });
    expect(out).toBe("Inner — Outer");
  });

  it("preserves verbatim LaTeX commands inside override values", () => {
    const out = renderTemplate("«bullet»", {
      bullet: "Built \\textbf{foo} \\& \\textit{bar}",
    });
    expect(out).toBe("Built \\textbf{foo} \\& \\textit{bar}");
  });

  it("throws MISSING_FIELD when a marker has no override", () => {
    expect(() =>
      renderTemplate("Hello «basics.name» — «basics.title»", {
        "basics.name": "Ada",
      }),
    ).toThrow(RenderTemplateError);
    try {
      renderTemplate("«unmapped»", {});
    } catch (error) {
      expect(error).toBeInstanceOf(RenderTemplateError);
      if (error instanceof RenderTemplateError) {
        expect(error.code).toBe("MISSING_FIELD");
        expect(error.message).toContain("unmapped");
      }
    }
  });

  it("rejects forbidden patterns introduced via override values", () => {
    expect(() =>
      renderTemplate("Inject: «evil»", { evil: "\\write18{rm -rf /}" }),
    ).toThrow(/forbidden pattern/i);
    expect(() =>
      renderTemplate("Inject: «evil»", { evil: "\\input{/etc/passwd}" }),
    ).toThrow(/forbidden pattern/i);
  });

  it("returns the template unchanged when there are no markers", () => {
    const tex = "\\documentclass{article}\\begin{document}Hi\\end{document}";
    expect(renderTemplate(tex, {})).toBe(tex);
  });
});

describe("extractMarkerIds", () => {
  it("returns the set of distinct fieldIds referenced", () => {
    const ids = extractMarkerIds(
      "«basics.name» — «basics.title»\\\\ «experience.0.bullet.0» «basics.name»",
    );
    expect(ids).toEqual(
      new Set(["basics.name", "basics.title", "experience.0.bullet.0"]),
    );
  });

  it("returns an empty set when no markers are present", () => {
    expect(extractMarkerIds("plain LaTeX, no markers")).toEqual(new Set());
  });
});
