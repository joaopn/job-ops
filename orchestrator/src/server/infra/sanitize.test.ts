// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sanitizeUnknown } from "./sanitize";

describe("sanitizeUnknown — sensitive key redaction", () => {
  it("redacts auth tokens", () => {
    expect(
      sanitizeUnknown({
        token: "secret-jwt",
        accessToken: "abc",
        Authorization: "Bearer xyz",
      }),
    ).toEqual({
      token: "[REDACTED]",
      accessToken: "[REDACTED]",
      Authorization: "[REDACTED]",
    });
  });

  it("does NOT redact token-count fields (LLM telemetry safelist)", () => {
    expect(
      sanitizeUnknown({
        promptTokens: 1000,
        completionTokens: 250,
        totalTokens: 1250,
        tokensPerSec: 42.5,
        tokensIn: 100,
        tokensOut: 50,
      }),
    ).toEqual({
      promptTokens: 1000,
      completionTokens: 250,
      totalTokens: 1250,
      tokensPerSec: 42.5,
      tokensIn: 100,
      tokensOut: 50,
    });
  });

  it("safelist is case-insensitive", () => {
    expect(
      sanitizeUnknown({ PromptTokens: 1, COMPLETIONTOKENS: 2 }),
    ).toEqual({ PromptTokens: 1, COMPLETIONTOKENS: 2 });
  });

  it("redacts password / secret / cookie / credential", () => {
    expect(
      sanitizeUnknown({
        password: "p",
        secret: "s",
        cookie: "c",
        apiKey: "k",
        credential: "cr",
      }),
    ).toEqual({
      password: "[REDACTED]",
      secret: "[REDACTED]",
      cookie: "[REDACTED]",
      apiKey: "[REDACTED]",
      credential: "[REDACTED]",
    });
  });

  it("recurses into nested objects", () => {
    expect(
      sanitizeUnknown({
        user: { name: "Ada", token: "x" },
        usage: { promptTokens: 50, completionTokens: 10 },
      }),
    ).toEqual({
      user: { name: "Ada", token: "[REDACTED]" },
      usage: { promptTokens: 50, completionTokens: 10 },
    });
  });
});
