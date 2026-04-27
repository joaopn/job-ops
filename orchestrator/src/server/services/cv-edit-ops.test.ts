// @vitest-environment node
import type { CvContent } from "@shared/types";
import { describe, expect, it } from "vitest";
import { applyBriefEdit, applyCvEditOps } from "./cv-edit-ops";

describe("applyCvEditOps", () => {
  it("replaces a leaf value when `from` matches", () => {
    const content: CvContent = {
      experience: [
        {
          bullets: ["Built X", "Built Y"],
        },
        {
          bullets: ["Shipped Z"],
        },
      ],
    } as CvContent;

    const next = applyCvEditOps(content, [
      {
        path: ["experience", 1, "bullets", 0],
        from: "Shipped Z",
        to: "Shipped Z+, owning the rollout",
      },
    ]);

    expect((next as any).experience[1].bullets[0]).toBe(
      "Shipped Z+, owning the rollout",
    );
    // Original is not mutated.
    expect((content as any).experience[1].bullets[0]).toBe("Shipped Z");
  });

  it("supports string-encoded numeric path segments", () => {
    const content = { items: ["a", "b", "c"] } as unknown as CvContent;
    const next = applyCvEditOps(content, [
      { path: ["items", "1"], from: "b", to: "B" },
    ]);
    expect((next as any).items).toEqual(["a", "B", "c"]);
  });

  it("throws conflict when `from` no longer matches", () => {
    const content = { name: "Alice" } as unknown as CvContent;
    expect(() =>
      applyCvEditOps(content, [{ path: ["name"], from: "Bob", to: "Charlie" }]),
    ).toThrow(/no longer matches/i);
  });

  it("throws conflict when path resolves through null", () => {
    const content = { obj: null } as unknown as CvContent;
    expect(() =>
      applyCvEditOps(content, [
        { path: ["obj", "nested"], from: "x", to: "y" },
      ]),
    ).toThrow(/cannot be resolved/i);
  });

  it("rejects empty edit lists and empty paths", () => {
    const content = { name: "Alice" } as unknown as CvContent;
    expect(() => applyCvEditOps(content, [])).toThrow(/no edits/i);
    expect(() =>
      applyCvEditOps(content, [{ path: [], from: "x", to: "y" }]),
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
