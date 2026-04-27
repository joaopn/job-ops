import type { CvContent } from "@shared/types";
import { Eta } from "eta";

const eta = new Eta({
  tags: ["<%", "%>"],
  useWith: true,
  autoTrim: false,
  autoEscape: false,
});

const LATEX_ESCAPE_MAP: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "{": "\\{",
  "}": "\\}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};
const LATEX_ESCAPE_PATTERN = /[\\{}&%$#_~^]/g;

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /\\(?:immediate\s*)?write18\b/,
    description: "\\write18 (shell-escape)",
  },
  { pattern: /\\openout\b/, description: "\\openout (file write)" },
  { pattern: /\\input\s*\{\s*\//, description: "\\input{} with absolute path" },
  {
    pattern: /\\input\s*\{\s*\.\.\//,
    description: "\\input{} with parent-traversal path",
  },
];

export class RenderTemplateError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "RenderTemplateError";
    this.code = code;
  }
}

export function latexEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(
    LATEX_ESCAPE_PATTERN,
    (ch) => LATEX_ESCAPE_MAP[ch] ?? ch,
  );
}

export function renderTemplate(template: string, content: CvContent): string {
  const data: Record<string, unknown> = { ...content, e: latexEscape };
  let rendered: string;
  try {
    rendered = eta.renderString(template, data);
  } catch (error) {
    throw new RenderTemplateError(
      `Eta render failed: ${error instanceof Error ? error.message : String(error)}`,
      "RENDER_FAILED",
    );
  }
  for (const guard of FORBIDDEN_PATTERNS) {
    if (guard.pattern.test(rendered)) {
      throw new RenderTemplateError(
        `Rendered template contains forbidden pattern: ${guard.description}.`,
        "FORBIDDEN_PATTERN",
      );
    }
  }
  return rendered;
}
