import { describe, expect, it } from "vitest";
import { parseSearchTermsInput } from "./automatic-run";

describe("automatic-run utilities", () => {
  it("parses comma and newline separated search terms", () => {
    expect(parseSearchTermsInput("backend, platform\napi\n\n")).toEqual([
      "backend",
      "platform",
      "api",
    ]);
  });
});
