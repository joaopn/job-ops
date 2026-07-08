// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for the prompts table. Keys are loader names
// ("job-score", "fragments/style"); values mirror PromptRow. vi.hoisted so
// the mock factory (which runs during the hoisted loader import) can see it.
const store = vi.hoisted(
  () =>
    new Map<
      string,
      {
        name: string;
        content: string;
        defaultContent: string;
        updatedAt: string;
      }
    >(),
);

vi.mock("@server/repositories/prompts", () => ({
  getAllPromptRows: vi.fn(async () => Array.from(store.values())),
  getPromptRow: vi.fn(async (name: string) => store.get(name) ?? null),
}));

import {
  clearPromptCache,
  listPrompts,
  loadPrompt,
  validatePromptContent,
} from "./loader";

let tick = 0;

function setPrompt(
  name: string,
  content: string,
  overrides?: { defaultContent?: string },
): void {
  tick += 1;
  store.set(name, {
    name,
    content,
    defaultContent: overrides?.defaultContent ?? content,
    updatedAt: `2026-07-08T00:00:${String(tick).padStart(2, "0")}Z`,
  });
}

beforeEach(() => {
  store.clear();
  clearPromptCache();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("loadPrompt", () => {
  it("interpolates variables in system and user templates", async () => {
    setPrompt(
      "greet",
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
    setPrompt(
      "with-version",
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
    setPrompt(
      "fragments/style",
      `name: style
template: |
  Tone: {{tone}}.
`,
    );
    setPrompt(
      "host",
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

  it("falls back to top-level prompts when fragments/<name> is absent", async () => {
    setPrompt(
      "tone-only",
      `name: tone-only
template: |
  Tone-only: {{tone}}.
`,
    );
    setPrompt(
      "host",
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
    setPrompt(
      "optional",
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
    setPrompt(
      "needy",
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
    setPrompt(
      "fragments/a",
      `name: a
template: |
  {{> b}}
`,
    );
    setPrompt(
      "fragments/b",
      `name: b
template: |
  inner
`,
    );
    setPrompt(
      "host",
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

  it("throws when the prompt row is missing", async () => {
    await expect(loadPrompt("does-not-exist", {})).rejects.toThrow(
      /Failed to read prompt "does-not-exist"/,
    );
  });

  it("throws on invalid YAML", async () => {
    setPrompt("broken", "not: valid: yaml: again:\n  - [oops");

    await expect(loadPrompt("broken", {})).rejects.toThrow(
      /Failed to (parse YAML|read prompt)/,
    );
  });

  it("re-parses when updated_at changes and reuses the memo when it doesn't", async () => {
    setPrompt(
      "cached",
      `name: cached
system: ""
user: |
  first
`,
    );
    expect((await loadPrompt("cached", {})).user.trim()).toBe("first");

    // Same updatedAt, mutated content: memo wins (proves reuse).
    const row = store.get("cached");
    if (!row) throw new Error("row missing");
    store.set("cached", { ...row, content: row.content.replace("first", "x") });
    expect((await loadPrompt("cached", {})).user.trim()).toBe("first");

    // Bumped updatedAt: re-parse picks up the new content.
    setPrompt(
      "cached",
      `name: cached
system: ""
user: |
  second
`,
    );
    expect((await loadPrompt("cached", {})).user.trim()).toBe("second");
  });
});

describe("validatePromptContent", () => {
  it("accepts valid content without requiring variables", async () => {
    await expect(
      validatePromptContent(
        "any",
        `name: any
system: |
  Hello {{who}}.
user: ""
`,
      ),
    ).resolves.toBeUndefined();
  });

  it("accepts content referencing an existing fragment", async () => {
    setPrompt(
      "fragments/style",
      `name: style
template: |
  Tone: {{tone}}.
`,
    );

    await expect(
      validatePromptContent(
        "host",
        `name: host
system: |
  {{> style}}
user: ""
`,
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects a FRAGMENT that references another partial, even an existing one", async () => {
    setPrompt(
      "fragments/other",
      `name: other
template: |
  inner
`,
    );

    await expect(
      validatePromptContent(
        "fragments/style",
        `name: style
template: |
  {{> other}}
`,
      ),
    ).rejects.toThrow(/fragments cannot include/i);
  });

  it("rejects content referencing a missing fragment", async () => {
    await expect(
      validatePromptContent(
        "host",
        `name: host
system: |
  {{> nope}}
user: ""
`,
      ),
    ).rejects.toThrow(/Failed to read prompt "nope"/);
  });

  it("rejects invalid YAML and unknown keys (strict schema)", async () => {
    await expect(
      validatePromptContent("bad", "not: valid: yaml:\n  - [oops"),
    ).rejects.toThrow(/Failed to parse YAML/);

    await expect(
      validatePromptContent(
        "bad",
        `name: bad
system: ""
user: ""
bogusKey: true
`,
      ),
    ).rejects.toThrow(/Invalid prompt schema/);
  });
});

describe("listPrompts", () => {
  it("enumerates rows with description, modifiedAt, and edited flag", async () => {
    setPrompt(
      "alpha",
      `name: alpha
description: alpha desc
system: ""
user: ""
`,
    );
    setPrompt(
      "fragments/beta",
      `name: beta
description: beta desc
template: ""
`,
    );
    setPrompt(
      "gamma",
      `name: gamma
description: edited desc
system: ""
user: ""
`,
      { defaultContent: "name: gamma\nsystem: ''\nuser: ''\n" },
    );

    const items = await listPrompts();
    const names = items.map((p) => p.name);

    expect(names).toContain("alpha");
    expect(names).toContain("fragments/beta");

    const alpha = items.find((p) => p.name === "alpha");
    expect(alpha?.description).toBe("alpha desc");
    expect(typeof alpha?.modifiedAt).toBe("string");
    expect(alpha?.edited).toBe(false);

    const gamma = items.find((p) => p.name === "gamma");
    expect(gamma?.edited).toBe(true);
  });

  it("skips rows that fail to parse instead of throwing", async () => {
    setPrompt("broken", "not: valid: yaml:\n  - [oops");
    setPrompt(
      "fine",
      `name: fine
system: ""
user: ""
`,
    );

    const items = await listPrompts();
    expect(items.map((p) => p.name)).toEqual(["fine"]);
  });
});
