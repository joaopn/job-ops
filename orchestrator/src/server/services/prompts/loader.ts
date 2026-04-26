import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
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

type CacheEntry = {
  mtimeMs: number;
  loadedAt: number;
  parsed: PromptFile;
};

const cache = new Map<string, CacheEntry>();

const VARIABLE_PATTERN = /\{\{\s*([\w.-]+)\s*\}\}/g;
const PARTIAL_PATTERN = /\{\{>\s*([\w.-]+)\s*\}\}/g;

function getCacheTtlMs(): number {
  const raw = process.env.PROMPTS_CACHE_TTL;
  if (raw == null || raw === "") return 5_000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 5_000;
  return parsed * 1000;
}

export function getPromptsDir(): string {
  const fromEnv = (process.env.PROMPTS_DIR ?? "").trim();
  if (fromEnv) return resolve(fromEnv);
  return "/app/prompts";
}

function normalizeVars(vars: PromptVars): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (value === null || value === undefined) continue;
    out[key] = String(value);
  }
  return out;
}

async function readAndParse(absPath: string, name: string): Promise<PromptFile> {
  let raw: string;
  try {
    raw = await fs.readFile(absPath, "utf8");
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read prompt "${name}" at ${absPath}: ${cause}`);
  }

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
  const dir = getPromptsDir();
  const absPath = join(dir, `${name}.yaml`);
  const ttl = getCacheTtlMs();

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(absPath);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read prompt "${name}" at ${absPath}: ${cause}`);
  }

  const cached = cache.get(absPath);
  if (
    ttl > 0 &&
    cached &&
    cached.mtimeMs === stat.mtimeMs &&
    Date.now() - cached.loadedAt < ttl
  ) {
    return cached.parsed;
  }

  const parsed = await readAndParse(absPath, name);
  cache.set(absPath, {
    mtimeMs: stat.mtimeMs,
    loadedAt: Date.now(),
    parsed,
  });
  return parsed;
}

async function loadFragment(name: string): Promise<PromptFile> {
  const dir = getPromptsDir();
  const fragmentPath = join(dir, "fragments", `${name}.yaml`);
  try {
    await fs.access(fragmentPath);
    return loadFile(`fragments/${name}`);
  } catch {
    return loadFile(name);
  }
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
): Promise<string> {
  if (!template || !PARTIAL_PATTERN.test(template)) {
    PARTIAL_PATTERN.lastIndex = 0;
    return template;
  }
  PARTIAL_PATTERN.lastIndex = 0;

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
      interpolate(fragmentFile.template, vars, `fragment:${partialName}`),
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

export function clearPromptCache(name?: string): void {
  if (!name) {
    cache.clear();
    return;
  }
  const dir = getPromptsDir();
  const directKey = join(dir, `${name}.yaml`);
  const fragmentKey = join(dir, "fragments", `${name}.yaml`);
  cache.delete(directKey);
  cache.delete(fragmentKey);
}

export type PromptDescriptor = {
  name: string;
  path: string;
  description: string;
  modifiedAt: string;
};

export async function listPrompts(): Promise<PromptDescriptor[]> {
  const dir = getPromptsDir();
  const out: PromptDescriptor[] = [];

  async function walk(subdir: string, prefix: string): Promise<void> {
    const fullDir = join(dir, subdir);
    const entries = await fs
      .readdir(fullDir, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(join(subdir, entry.name), `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;
      const baseName = entry.name.slice(0, -".yaml".length);
      const promptName = `${prefix}${baseName}`;
      const absPath = join(fullDir, entry.name);
      try {
        const [stat, parsed] = await Promise.all([
          fs.stat(absPath),
          readAndParse(absPath, promptName),
        ]);
        out.push({
          name: promptName,
          path: absPath,
          description: parsed.description,
          modifiedAt: new Date(stat.mtimeMs).toISOString(),
        });
      } catch {
        // skip files that fail to parse — listPrompts should never throw
      }
    }
  }

  await walk("", "");
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
