import type { SourceConfigRunGlobals } from "@shared/types";

export class TemplateSubstitutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateSubstitutionError";
  }
}

interface SubstituteArgs {
  templateJson: string;
  runGlobals: SourceConfigRunGlobals;
  searchTerms: string[];
}

/**
 * Resolved value for each supported placeholder. The value is
 * substituted into the JSON tree:
 *   - strings replace string nodes verbatim (no escaping needed)
 *   - arrays/numbers replace any node, regardless of source type
 *
 * The substitution is structural, not textual: each leaf is checked
 * for a `{{name}}` literal and the entire leaf is replaced with the
 * typed value when matched. Surrounding-text mixing (e.g. `"hi
 * {{city}}!"`) is not supported in v1 — keep templates clean.
 */
type Placeholder =
  | { kind: "string"; value: string }
  | { kind: "array"; value: readonly string[] }
  | { kind: "number"; value: number };

function buildPlaceholders(args: SubstituteArgs): Record<string, Placeholder> {
  const { runGlobals, searchTerms } = args;
  const out: Record<string, Placeholder> = {
    searchTerms: { kind: "array", value: searchTerms },
    city: { kind: "string", value: runGlobals.city ?? "" },
    country: { kind: "string", value: runGlobals.country ?? "" },
  };

  if (runGlobals.workplaceTypes) {
    let parsed: string[] = [];
    try {
      const candidate = JSON.parse(runGlobals.workplaceTypes);
      if (Array.isArray(candidate)) {
        parsed = candidate.filter((v): v is string => typeof v === "string");
      }
    } catch {
      // ignore — leave empty array
    }
    out.workplaceTypes = { kind: "array", value: parsed };
  } else {
    out.workplaceTypes = { kind: "array", value: [] };
  }

  if (runGlobals.maxJobsPerTerm) {
    const parsed = Number(runGlobals.maxJobsPerTerm);
    out.maxJobsPerTerm = {
      kind: "number",
      value: Number.isFinite(parsed) ? parsed : 20,
    };
  } else {
    // Sensible default so the placeholder always resolves (Test endpoint,
    // pipeline runs without an explicit per-run budget, etc.).
    out.maxJobsPerTerm = { kind: "number", value: 20 };
  }

  return out;
}

const PLACEHOLDER_RE = /^\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}$/;

function substituteNode(
  node: unknown,
  placeholders: Record<string, Placeholder>,
): unknown {
  if (typeof node === "string") {
    const match = node.match(PLACEHOLDER_RE);
    if (!match) return node;
    const name = match[1];
    const placeholder = placeholders[name];
    if (!placeholder) {
      // Unknown placeholder name (typo). Strip the {{...}} and leave an
      // empty string rather than crashing the run.
      return "";
    }
    if (placeholder.kind === "array") return [...placeholder.value];
    return placeholder.value;
  }
  if (Array.isArray(node)) {
    return node.map((entry) => substituteNode(entry, placeholders));
  }
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key] = substituteNode(value, placeholders);
    }
    return out;
  }
  return node;
}

export function substituteInputTemplate(args: SubstituteArgs): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args.templateJson);
  } catch (error) {
    throw new TemplateSubstitutionError(
      `Input template is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const placeholders = buildPlaceholders(args);
  return substituteNode(parsed, placeholders);
}
