// @vitest-environment node
import type { CvContent } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  RenderTemplateError,
  latexEscape,
  renderTemplate,
} from "./render-template";

function makeContent(overrides: Record<string, unknown> = {}): CvContent {
  return {
    basics: { name: "Ada Lovelace", profiles: [] },
    summary: undefined,
    experience: [],
    education: [],
    projects: [],
    skillGroups: [],
    custom: [],
    ...overrides,
  };
}

describe("latexEscape", () => {
  it.each([
    ["a & b", "a \\& b"],
    ["50%", "50\\%"],
    ["$5", "\\$5"],
    ["snake_case", "snake\\_case"],
    ["x^2", "x\\textasciicircum{}2"],
    ["~root", "\\textasciitilde{}root"],
    ["{a}", "\\{a\\}"],
    ["a\\b", "a\\textbackslash{}b"],
    ["c#", "c\\#"],
  ])("escapes %s", (input, expected) => {
    expect(latexEscape(input)).toBe(expected);
  });

  it("returns empty string for null/undefined", () => {
    expect(latexEscape(null)).toBe("");
    expect(latexEscape(undefined)).toBe("");
  });
});

describe("renderTemplate", () => {
  it("substitutes scalar fields via the e() filter", () => {
    const out = renderTemplate(
      "Name: <%= e(basics.name) %>\n",
      makeContent({ basics: { name: "Ada & Co.", profiles: [] } }),
    );
    expect(out).toBe("Name: Ada \\& Co.\n");
  });

  it("loops over experience entries", () => {
    const template = `<% for (const job of experience) { %>\\textbf{<%= e(job.position) %>} at <%= e(job.company) %>
<% } %>`;
    const out = renderTemplate(
      template,
      makeContent({
        experience: [
          {
            company: "ACME & Sons",
            position: "Engineer",
            bullets: [],
          },
          {
            company: "Globex",
            position: "Lead",
            bullets: [],
          },
        ],
      }),
    );
    expect(out).toBe(
      "\\textbf{Engineer} at ACME \\& Sons\n\\textbf{Lead} at Globex\n",
    );
  });

  it("supports conditional blocks for optional fields", () => {
    const template =
      "<% if (summary) { %>Summary: <%= e(summary) %><% } %>\n";
    const withSummary = renderTemplate(
      template,
      makeContent({ summary: "Hello world." }),
    );
    expect(withSummary).toBe("Summary: Hello world.\n");

    const withoutSummary = renderTemplate(template, makeContent());
    expect(withoutSummary).toBe("\n");
  });

  it("rejects rendered output containing \\write18", () => {
    const template = "Bad: <%= 'evil' %>\\write18{rm -rf /}\n";
    expect(() => renderTemplate(template, makeContent())).toThrow(
      RenderTemplateError,
    );
  });

  it("rejects rendered output containing \\immediate\\write18", () => {
    const template = "\\immediate\\write18{x}\n";
    expect(() => renderTemplate(template, makeContent())).toThrow(
      /write18/,
    );
  });

  it("rejects \\input{} with absolute path", () => {
    const template = "\\input{/etc/passwd}\n";
    expect(() => renderTemplate(template, makeContent())).toThrow(
      /absolute/,
    );
  });

  it("rejects \\input{} with parent traversal", () => {
    const template = "\\input{../secret}\n";
    expect(() => renderTemplate(template, makeContent())).toThrow(
      /parent-traversal/,
    );
  });

  it("preserves \\includegraphics calls", () => {
    const template = "\\includegraphics{photo.jpg}\n";
    const out = renderTemplate(template, makeContent());
    expect(out).toBe("\\includegraphics{photo.jpg}\n");
  });

  it("wraps Eta render errors as RenderTemplateError", () => {
    const template = "<%= nope.field %>\n";
    expect(() => renderTemplate(template, makeContent())).toThrow(
      RenderTemplateError,
    );
  });
});
