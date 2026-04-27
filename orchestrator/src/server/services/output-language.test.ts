import { describe, expect, it } from "vitest";
import {
  detectLanguageFromSample,
  resolveWritingOutputLanguage,
} from "./output-language";

describe("resolveWritingOutputLanguage", () => {
  it("uses the manual language when manual mode is selected", () => {
    const result = resolveWritingOutputLanguage({
      style: {
        languageMode: "manual",
        manualLanguage: "spanish",
      },
      sample: "",
    });

    expect(result).toEqual({
      language: "spanish",
      source: "manual",
    });
  });

  it("detects supported non-english language from a free-form text sample", () => {
    const sample =
      "Ich entwickle skalierbare Plattformen und arbeite eng mit Produktteams und der Entwicklung zusammen.\nErfahrung mit verteilten Systemen, APIs und verantwortlicher Lieferung für das Team.";

    expect(detectLanguageFromSample(sample)).toBe("german");
    expect(
      resolveWritingOutputLanguage({
        style: {
          languageMode: "match-resume",
          manualLanguage: "english",
        },
        sample,
      }),
    ).toEqual({
      language: "german",
      source: "detected",
    });
  });

  it("falls back to english when language detection is weak", () => {
    const result = resolveWritingOutputLanguage({
      style: {
        languageMode: "match-resume",
        manualLanguage: "french",
      },
      sample: "Senior Engineer",
    });

    expect(result).toEqual({
      language: "english",
      source: "fallback",
    });
  });
});
