import {
  getAllPromptRows,
  getPromptRow,
} from "@server/repositories/prompts";
import { parse as parseYaml } from "yaml";
import { getDefaultPromptVars } from "./fragments";
import { type ModelHints, type PromptFile, promptFileSchema } from "./schema";

export type PromptVars = Record<string, string | number | null | undefined>;

export type LoadedPrompt = {
  name: string;
  description: string;
  system: string;
  user: string;
  modelHints: ModelHints;
};

// Parse memo, keyed by prompt name. The DB row is fetched on every load (that
// IS the read — there is no way to skip it without staleness), so the only
// cacheable cost is the YAML parse; `updated_at` decides reuse. Both API
// edits and direct-DB edits bump `updated_at`, so changes propagate on the
// next call with no reload step.
type CacheEntry = {
  updatedAt: string;
  parsed: PromptFile;
};

const cache = new Map<string, CacheEntry>();

const VARIABLE_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g;
const PARTIAL_PATTERN = /\{\{>\s*([\w.-]+)\s*\}\}/g;

function normalizeVars(vars: PromptVars): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (value === null || value === undefined) continue;
    out[key] = String(value);
  }
  return out;
}

function parseContent(raw: string, name: string): PromptFile {
  let yamlValue: unknown;
  try {
    yamlValue = parseYaml(raw);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse YAML for prompt "${name}": ${cause}`);
  }

  const validated = promptFileSchema.safeParse(yamlValue);
  if (!validated.success) {
    throw new Error(
      `Invalid prompt schema for "${name}": ${validated.error.message}`,
    );
  }
  return validated.data;
}

async function loadFile(name: string): Promise<PromptFile> {
  const row = await getPromptRow(name);
  if (!row) {
    throw new Error(
      `Failed to read prompt "${name}": not found in prompts table`,
    );
  }

  const cached = cache.get(name);
  if (cached && cached.updatedAt === row.updatedAt) {
    return cached.parsed;
  }

  const parsed = parseContent(row.content, name);
  cache.set(name, { updatedAt: row.updatedAt, parsed });
  return parsed;
}

async function loadFragment(name: string): Promise<PromptFile> {
  const fragmentRow = await getPromptRow(`fragments/${name}`);
  if (fragmentRow) {
    return loadFile(`fragments/${name}`);
  }
  return loadFile(name);
}

function interpolate(
  template: string,
  vars: Record<string, string>,
  contextLabel: string,
): string {
  if (!template) return "";

  const missing = new Set<string>();
  const result = template.replace(VARIABLE_PATTERN, (_match, key: string) => {
    if (Object.hasOwn(vars, key)) {
      return vars[key];
    }
    missing.add(key);
    return "";
  });

  if (missing.size > 0) {
    const provided = Object.keys(vars).sort().join(", ") || "(none)";
    throw new Error(
      `Prompt "${contextLabel}" is missing variables: ${[...missing]
        .sort()
        .join(", ")}. Provided: ${provided}.`,
    );
  }
  return result;
}

async function expandPartials(
  template: string,
  vars: Record<string, string>,
  contextLabel: string,
  options?: { interpolateFragments?: boolean },
): Promise<string> {
  if (!template || !PARTIAL_PATTERN.test(template)) {
    PARTIAL_PATTERN.lastIndex = 0;
    return template;
  }
  PARTIAL_PATTERN.lastIndex = 0;

  const interpolateFragments = options?.interpolateFragments ?? true;
  const matches = Array.from(template.matchAll(PARTIAL_PATTERN));
  const replacements = new Map<string, string>();

  for (const match of matches) {
    const partialName = match[1];
    if (replacements.has(partialName)) continue;

    const fragmentFile = await loadFragment(partialName);
    if (!fragmentFile.template) {
      throw new Error(
        `Fragment "${partialName}" referenced from "${contextLabel}" has no \`template\` field.`,
      );
    }
    if (PARTIAL_PATTERN.test(fragmentFile.template)) {
      PARTIAL_PATTERN.lastIndex = 0;
      throw new Error(
        `Fragment "${partialName}" references another partial; nested partials are not supported.`,
      );
    }
    PARTIAL_PATTERN.lastIndex = 0;

    replacements.set(
      partialName,
      interpolateFragments
        ? interpolate(fragmentFile.template, vars, `fragment:${partialName}`)
        : fragmentFile.template,
    );
  }

  return template.replace(
    PARTIAL_PATTERN,
    (_match, key: string) => replacements.get(key) ?? "",
  );
}

async function renderTemplate(
  template: string,
  vars: Record<string, string>,
  contextLabel: string,
): Promise<string> {
  const expanded = await expandPartials(template, vars, contextLabel);
  return interpolate(expanded, vars, contextLabel);
}

export async function loadPrompt(
  name: string,
  vars: PromptVars = {},
): Promise<LoadedPrompt> {
  const file = await loadFile(name);
  const merged: Record<string, string> = {
    ...getDefaultPromptVars(),
    ...normalizeVars(vars),
  };

  const [system, user] = await Promise.all([
    renderTemplate(file.system, merged, name),
    renderTemplate(file.user, merged, name),
  ]);

  return {
    name: file.name,
    description: file.description,
    system,
    user,
    modelHints: file.model ?? {},
  };
}

/**
 * Structural validation for a prompt save: YAML parses, the (strict) prompt
 * schema accepts it, and every `{{> partial}}` it references exists and is
 * expandable. Deliberately does NOT validate `{{var}}` names — variables are
 * call-time-checked (a bad edit fails loudly at the consuming call, and Reset
 * recovers), so fragments are expanded WITHOUT interpolating their variables.
 */
export async function validatePromptContent(
  name: string,
  content: string,
): Promise<void> {
  const parsed = parseContent(content, name);
  const noInterpolation = { interpolateFragments: false };
  await expandPartials(parsed.system, {}, name, noInterpolation);
  await expandPartials(parsed.user, {}, name, noInterpolation);
  await expandPartials(parsed.template, {}, name, noInterpolation);
}

export function clearPromptCache(name?: string): void {
  if (!name) {
    cache.clear();
    return;
  }
  cache.delete(name);
  cache.delete(`fragments/${name}`);
}

export type PromptDescriptor = {
  name: string;
  /** Kept for API compatibility; holds the prompt name post-DB-move. */
  path: string;
  description: string;
  modifiedAt: string;
  /** True when the live content differs from the baked default. */
  edited: boolean;
};

export async function listPrompts(): Promise<PromptDescriptor[]> {
  const rows = await getAllPromptRows();
  const out: PromptDescriptor[] = [];

  for (const row of rows) {
    try {
      const parsed = parseContent(row.content, row.name);
      out.push({
        name: row.name,
        path: row.name,
        description: parsed.description,
        modifiedAt: row.updatedAt,
        edited: row.content !== row.defaultContent,
      });
    } catch {
      // skip rows that fail to parse — listPrompts should never throw
    }
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
