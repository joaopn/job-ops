// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearPromptCache, listPrompts, loadPrompt } from "./loader";

let workDir: string;
let prevPromptsDir: string | undefined;
let prevCacheTtl: string | undefined;

function writePrompt(relPath: string, contents: string): void {
  const abs = join(workDir, relPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, contents, "utf8");
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "prompts-test-"));
  prevPromptsDir = process.env.PROMPTS_DIR;
  prevCacheTtl = process.env.PROMPTS_CACHE_TTL;
  process.env.PROMPTS_DIR = workDir;
  process.env.PROMPTS_CACHE_TTL = "0";
  clearPromptCache();
});

afterEach(() => {
  process.env.PROMPTS_DIR = prevPromptsDir;
  process.env.PROMPTS_CACHE_TTL = prevCacheTtl;
  rmSync(workDir, { recursive: true, force: true });
  clearPromptCache();
});

describe("loadPrompt", () => {
  it("interpolates variables in system and user templates", async () => {
    writePrompt(
      "greet.yaml",
      `name: greet
description: hi
system: |
  You are a {{role}}.
user: |
  Hello, {{subject}}!
model:
  temperature: 0.5
`,
    );

    const result = await loadPrompt("greet", {
      role: "ghostwriter",
      subject: "world",
    });

    expect(result.system.trim()).toBe("You are a ghostwriter.");
    expect(result.user.trim()).toBe("Hello, world!");
    expect(result.modelHints.temperature).toBe(0.5);
    expect(result.name).toBe("greet");
  });

  it("auto-injects appVersion without requiring callers to pass it", async () => {
    writePrompt(
      "with-version.yaml",
      `name: with-version
system: ""
user: |
  v{{appVersion}}
`,
    );

    const result = await loadPrompt("with-version", {});

    expect(result.user.trim().startsWith("v")).toBe(true);
    expect(result.user.trim()).not.toBe("v");
  });

  it("expands fragments referenced via {{> name}}", async () => {
    writePrompt(
      "fragments/style.yaml",
      `name: style
template: |
  Tone: {{tone}}.
`,
    );
    writePrompt(
      "host.yaml",
      `name: host
system: |
  Lead-in.
  {{> style}}
user: ""
`,
    );

    const result = await loadPrompt("host", { tone: "warm" });

    expect(result.system).toContain("Lead-in.");
    expect(result.system).toContain("Tone: warm.");
  });

  it("falls back to top-level prompts/ when fragments/<name>.yaml is absent", async () => {
    writePrompt(
      "tone-only.yaml",
      `name: tone-only
template: |
  Tone-only: {{tone}}.
`,
    );
    writePrompt(
      "host.yaml",
      `name: host
system: |
  {{> tone-only}}
user: ""
`,
    );

    const result = await loadPrompt("host", { tone: "neutral" });

    expect(result.system.trim()).toBe("Tone-only: neutral.");
  });

  it("treats explicit empty strings as valid interpolations", async () => {
    writePrompt(
      "optional.yaml",
      `name: optional
system: ""
user: |
  before{{maybe}}after
`,
    );

    const result = await loadPrompt("optional", { maybe: "" });

    expect(result.user.trim()).toBe("beforeafter");
  });

  it("throws a descriptive error when a variable is missing", async () => {
    writePrompt(
      "needy.yaml",
      `name: needy
system: ""
user: |
  Hello {{who}}, age {{age}}.
`,
    );

    await expect(loadPrompt("needy", { who: "world" })).rejects.toThrow(
      /missing variables: age/i,
    );
  });

  it("rejects nested partials (depth > 1)", async () => {
    writePrompt(
      "fragments/a.yaml",
      `name: a
template: |
  {{> b}}
`,
    );
    writePrompt(
      "fragments/b.yaml",
      `name: b
template: |
  inner
`,
    );
    writePrompt(
      "host.yaml",
      `name: host
system: |
  {{> a}}
user: ""
`,
    );

    await expect(loadPrompt("host", {})).rejects.toThrow(
      /nested partials are not supported/i,
    );
  });

  it("throws when the prompt file is missing", async () => {
    await expect(loadPrompt("does-not-exist", {})).rejects.toThrow(
      /Failed to read prompt "does-not-exist"/,
    );
  });

  it("throws on invalid YAML", async () => {
    writePrompt("broken.yaml", "not: valid: yaml: again:\n  - [oops");

    await expect(loadPrompt("broken", {})).rejects.toThrow(
      /Failed to (parse YAML|read prompt)/,
    );
  });
});

describe("listPrompts", () => {
  it("enumerates top-level and fragment YAMLs with their description and mtime", async () => {
    writePrompt(
      "alpha.yaml",
      `name: alpha
description: alpha desc
system: ""
user: ""
`,
    );
    writePrompt(
      "fragments/beta.yaml",
      `name: beta
description: beta desc
template: ""
`,
    );

    const items = await listPrompts();
    const names = items.map((p) => p.name);

    expect(names).toContain("alpha");
    expect(names).toContain("fragments/beta");

    const alpha = items.find((p) => p.name === "alpha");
    expect(alpha?.description).toBe("alpha desc");
    expect(typeof alpha?.modifiedAt).toBe("string");
  });
});
