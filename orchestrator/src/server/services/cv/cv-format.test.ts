// @vitest-environment node
import { createAppSettings } from "@shared/testing/factories";
import { describe, expect, it } from "vitest";
import { resolveCvSourceFormat } from "./cv-format";

describe("resolveCvSourceFormat", () => {
  it("treats an unset format as latex", () => {
    expect(resolveCvSourceFormat(createAppSettings())).toBe("latex");
  });

  it("returns the stored format", () => {
    expect(
      resolveCvSourceFormat(createAppSettings({ cvSourceFormat: "latex" })),
    ).toBe("latex");
    expect(
      resolveCvSourceFormat(createAppSettings({ cvSourceFormat: "docx" })),
    ).toBe("docx");
  });
});
