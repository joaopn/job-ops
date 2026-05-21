import type { CvField } from "./types";
import { describe, expect, it } from "vitest";
import { parseTaggedText, serializeTaggedText } from "./cv-tagged-text";

const SAMPLE_FIELDS: CvField[] = [
  { id: "basics.name", role: "name", value: "Ada Lovelace" },
  { id: "experience.0.title", role: "title", value: "Engineer" },
  { id: "experience.0.bullet.0", role: "bullet", value: "Built things." },
];

describe("parseTaggedText", () => {
  it("happy path — round-trips serializer output", () => {
    const text = serializeTaggedText({
      fields: SAMPLE_FIELDS,
      overrides: {
        "experience.0.bullet.0": "Built fancy things.",
      },
      defaults: {},
      locks: new Set(),
    });
    const result = parseTaggedText(text, SAMPLE_FIELDS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overrides).toEqual({
      "basics.name": "Ada Lovelace",
      "experience.0.title": "Engineer",
      "experience.0.bullet.0": "Built fancy things.",
    });
  });

  it("preserves multi-line values verbatim", () => {
    const fields: CvField[] = [
      { id: "summary", role: "summary", value: "line1\nline2\nline3" },
    ];
    const text = "--- summary ---\nline1\nline2\nline3";
    const result = parseTaggedText(text, fields);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overrides.summary).toBe("line1\nline2\nline3");
  });

  it("empty value between fences = real empty-string override", () => {
    const fields: CvField[] = [
      { id: "a", role: "other", value: "x" },
      { id: "b", role: "other", value: "y" },
    ];
    const text = "--- a ---\n\n--- b ---\nkept";
    const result = parseTaggedText(text, fields);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overrides.a).toBe("");
    expect(result.overrides.b).toBe("kept");
  });

  it("strips `# locked` annotation that precedes a fence", () => {
    const fields: CvField[] = [
      { id: "a", role: "other", value: "x" },
      { id: "b", role: "other", value: "y" },
    ];
    const text =
      "--- a ---\nvalue-a\n\n# locked\n--- b ---\nvalue-b";
    const result = parseTaggedText(text, fields);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overrides.a).toBe("value-a");
    expect(result.overrides.b).toBe("value-b");
  });

  it("rejects orphan content before the first fence", () => {
    const text = "stray text\n--- basics.name ---\nAda";
    const result = parseTaggedText(text, SAMPLE_FIELDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line: 1,
          message: expect.stringContaining("Orphan content"),
        }),
      ]),
    );
  });

  it("rejects a fence whose id is not in `fields`", () => {
    const text =
      "--- basics.name ---\nAda\n--- nope.field ---\nx\n--- experience.0.title ---\nEng\n--- experience.0.bullet.0 ---\nb";
    const result = parseTaggedText(text, SAMPLE_FIELDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining(`Unknown fieldId "nope.field"`),
        }),
      ]),
    );
  });

  it("rejects duplicate fences for the same id", () => {
    const text =
      "--- basics.name ---\nAda\n--- experience.0.title ---\nEng\n--- experience.0.bullet.0 ---\nb\n--- basics.name ---\nAgain";
    const result = parseTaggedText(text, SAMPLE_FIELDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining(
            `Duplicate block for fieldId "basics.name"`,
          ),
        }),
      ]),
    );
  });

  it("rejects when a field in `fields` is missing from the input", () => {
    const text = "--- basics.name ---\nAda";
    const result = parseTaggedText(text, SAMPLE_FIELDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const missing = result.errors.filter((e) =>
      e.message.startsWith("Missing block"),
    );
    expect(missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining(
            `Missing block for fieldId "experience.0.title"`,
          ),
        }),
        expect.objectContaining({
          message: expect.stringContaining(
            `Missing block for fieldId "experience.0.bullet.0"`,
          ),
        }),
      ]),
    );
  });

  it("rejects malformed fence lines that look like fences", () => {
    const text = "--- basics.name\nAda";
    const result = parseTaggedText(text, SAMPLE_FIELDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("Malformed fence line"),
        }),
      ]),
    );
  });

  it("returns the FULL list of errors, not just the first", () => {
    const text =
      "stray\n--- nope.field ---\nx\n--- nope.field ---\ny";
    const result = parseTaggedText(text, SAMPLE_FIELDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Expect orphan + unknown + duplicate + missing(3).
    const messages = result.errors.map((e) => e.message).join("\n");
    expect(messages).toMatch(/Orphan content/);
    expect(messages).toMatch(/Unknown fieldId "nope.field"/);
    expect(messages).toMatch(/Duplicate block/);
    expect(messages).toMatch(/Missing block for fieldId "basics.name"/);
  });
});

describe("serializeTaggedText", () => {
  it("emits fields in `fields[]` order with override values when set", () => {
    const text = serializeTaggedText({
      fields: SAMPLE_FIELDS,
      overrides: { "basics.name": "Ada L. Byron" },
      defaults: {
        "basics.name": "Ada Lovelace",
        "experience.0.title": "Engineer",
        "experience.0.bullet.0": "Built things.",
      },
      locks: new Set(),
    });
    expect(text).toBe(
      "--- basics.name ---\nAda L. Byron\n\n" +
        "--- experience.0.title ---\nEngineer\n\n" +
        "--- experience.0.bullet.0 ---\nBuilt things.",
    );
  });

  it("emits `# locked` annotation above a locked field's fence", () => {
    const text = serializeTaggedText({
      fields: [SAMPLE_FIELDS[0]],
      overrides: {},
      defaults: { "basics.name": "Ada Lovelace" },
      locks: new Set(["basics.name"]),
    });
    expect(text).toBe("# locked\n--- basics.name ---\nAda Lovelace");
  });

  it("falls back to field.value when defaults lack an entry", () => {
    const text = serializeTaggedText({
      fields: [SAMPLE_FIELDS[0]],
      overrides: {},
      defaults: {},
      locks: new Set(),
    });
    expect(text).toBe("--- basics.name ---\nAda Lovelace");
  });

  it("round-trips empty-string overrides", () => {
    const text = serializeTaggedText({
      fields: [SAMPLE_FIELDS[0]],
      overrides: { "basics.name": "" },
      defaults: {},
      locks: new Set(),
    });
    expect(text).toBe("--- basics.name ---\n");
    const parsed = parseTaggedText(text, [SAMPLE_FIELDS[0]]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.overrides["basics.name"]).toBe("");
  });
});
