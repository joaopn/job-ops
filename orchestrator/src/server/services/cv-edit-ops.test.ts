// @vitest-environment node
import type { CvField, CvFieldOverrides } from "@shared/types";
import { describe, expect, it } from "vitest";
import { applyBriefEdit, applyCvEditOps } from "./cv-edit-ops";

const fields: CvField[] = [
  { id: "basics.name", role: "name", value: "Alice" },
  { id: "experience.0.title", role: "title", value: "Engineer" },
  { id: "experience.0.bullet.0", role: "bullet", value: "Built foo" },
  { id: "experience.1.bullet.0", role: "bullet", value: "Shipped bar" },
];

describe("applyCvEditOps", () => {
  it("merges patches into a copy of currentOverrides when `from` matches", () => {
    const overrides: CvFieldOverrides = {};
    const next = applyCvEditOps(fields, overrides, [
      {
        fieldId: "experience.1.bullet.0",
        from: "Shipped bar",
        to: "Shipped bar end-to-end",
      },
    ]);

    expect(next).toEqual({
      "experience.1.bullet.0": "Shipped bar end-to-end",
    });
    // Original overrides map is not mutated.
    expect(overrides).toEqual({});
  });

  it("uses the existing override as the `from` baseline when present", () => {
    const overrides: CvFieldOverrides = {
      "basics.name": "Alice (PhD)",
    };
    const next = applyCvEditOps(fields, overrides, [
      {
        fieldId: "basics.name",
        from: "Alice (PhD)",
        to: "Dr. Alice",
      },
    ]);
    expect(next["basics.name"]).toBe("Dr. Alice");
  });

  it("throws conflict when `from` no longer matches the effective value", () => {
    expect(() =>
      applyCvEditOps(fields, {}, [
        { fieldId: "basics.name", from: "Bob", to: "Charlie" },
      ]),
    ).toThrow(/no longer matches/i);
  });

  it("throws conflict for an unknown fieldId", () => {
    expect(() =>
      applyCvEditOps(fields, {}, [
        { fieldId: "experience.99.bullet.0", from: "x", to: "y" },
      ]),
    ).toThrow(/unknown fieldId/i);
  });

  it("rejects empty edit lists and empty fieldIds", () => {
    expect(() => applyCvEditOps(fields, {}, [])).toThrow(/no edits/i);
    expect(() =>
      applyCvEditOps(fields, {}, [{ fieldId: "", from: "x", to: "y" }]),
    ).toThrow(/empty/i);
  });
});

describe("applyBriefEdit", () => {
  it("appends to a non-empty brief with a blank line separator", () => {
    expect(
      applyBriefEdit("First paragraph.", {
        kind: "brief-edit",
        rationale: "more context",
        append: "Second paragraph.",
      }),
    ).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("appends to an empty brief without leading whitespace", () => {
    expect(
      applyBriefEdit("", {
        kind: "brief-edit",
        rationale: "first context",
        append: "Hello.",
      }),
    ).toBe("Hello.");
  });

  it("replaces wholesale when `replace` is set and `append` is not", () => {
    expect(
      applyBriefEdit("Old brief.", {
        kind: "brief-edit",
        rationale: "rewrite",
        replace: "Brand new brief.",
      }),
    ).toBe("Brand new brief.");
  });

  it("prefers append over replace when both are present", () => {
    expect(
      applyBriefEdit("Existing.", {
        kind: "brief-edit",
        rationale: "edge",
        append: "Added.",
        replace: "Should be ignored.",
      }),
    ).toBe("Existing.\n\nAdded.");
  });

  it("returns the current brief when neither field is set", () => {
    expect(
      applyBriefEdit("Existing.", {
        kind: "brief-edit",
        rationale: "noop",
      }),
    ).toBe("Existing.");
  });
});
