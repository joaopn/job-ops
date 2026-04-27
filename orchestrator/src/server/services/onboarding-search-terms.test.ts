import type { CvDocument } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callJsonMock = vi.fn();

vi.mock("./llm/service", () => ({
  LlmService: class {
    callJson = callJsonMock;
  },
}));

vi.mock("@server/services/modelSelection", () => ({
  resolveLlmModel: vi.fn().mockResolvedValue("test-model"),
}));

vi.mock("./cv-active", () => ({
  getActiveCvDocument: vi.fn(),
}));

vi.mock("./prompts", () => ({
  loadPrompt: vi.fn().mockResolvedValue({
    name: "onboarding-search-terms",
    description: "",
    system: "stub-system",
    user: "stub-user",
    modelHints: {},
  }),
}));

import { buildFallbackSearchTerms, suggestOnboardingSearchTerms } from "./onboarding-search-terms";
import { getActiveCvDocument } from "./cv-active";

function makeCv(overrides: {
  personalBrief?: string;
  content?: Record<string, unknown>;
}): CvDocument {
  return {
    id: "cv-1",
    name: "cv.tex",
    flattenedTex: "",
    template: "",
    content: (overrides.content ?? {}) as CvDocument["content"],
    personalBrief: overrides.personalBrief ?? "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("suggestOnboardingSearchTerms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns sanitized AI terms when generation succeeds", async () => {
    vi.mocked(getActiveCvDocument).mockResolvedValue(
      makeCv({
        personalBrief: "Backend platform engineer with API and infra experience.",
        content: {
          basics: { headline: "Senior Backend Engineer" },
          experience: [{ position: "Platform Engineer" }],
        },
      }),
    );
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        terms: [
          " Senior Backend Engineer ",
          "Platform Engineer",
          "platform engineer",
          "",
        ],
      },
    });

    const result = await suggestOnboardingSearchTerms();

    expect(result).toEqual({
      terms: ["Senior Backend Engineer", "Platform Engineer"],
      source: "ai",
    });
  });

  it("falls back to headline and experience positions when AI generation fails", async () => {
    vi.mocked(getActiveCvDocument).mockResolvedValue(
      makeCv({
        personalBrief: "Staff engineer focused on platform tooling.",
        content: {
          basics: { headline: "Staff Software Engineer" },
          experience: [{ position: "Platform Engineer" }],
        },
      }),
    );
    callJsonMock.mockResolvedValue({
      success: false,
      error: "LLM provider unavailable",
    });

    const result = await suggestOnboardingSearchTerms();

    expect(result).toEqual({
      terms: ["Staff Software Engineer", "Platform Engineer"],
      source: "fallback",
    });
  });

  it("falls back to project and skill hints when no headline or positions exist", async () => {
    vi.mocked(getActiveCvDocument).mockResolvedValue(
      makeCv({
        personalBrief: "Backend platform engineer focused on distributed systems.",
        content: {
          projects: [{ name: "Developer Platform" }],
          skillGroups: [
            {
              name: "Site Reliability Engineering",
              keywords: ["Distributed Systems"],
            },
          ],
        },
      }),
    );
    callJsonMock.mockResolvedValue({
      success: false,
      error: "LLM provider unavailable",
    });

    const result = await suggestOnboardingSearchTerms();

    expect(result).toEqual({
      terms: [
        "Developer Platform",
        "Site Reliability Engineering",
        "Distributed Systems",
      ],
      source: "fallback",
    });
  });

  it("throws a conflict when no CV has been uploaded", async () => {
    vi.mocked(getActiveCvDocument).mockResolvedValue(null);

    await expect(suggestOnboardingSearchTerms()).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      message: "Resume must be configured before suggesting search terms.",
    });
  });

  it("throws a conflict when the CV has no usable hints or brief", async () => {
    vi.mocked(getActiveCvDocument).mockResolvedValue(
      makeCv({ personalBrief: "", content: {} }),
    );

    await expect(suggestOnboardingSearchTerms()).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      message: "Resume must be configured before suggesting search terms.",
    });
  });

  it("caps and deduplicates fallback search terms", () => {
    const result = buildFallbackSearchTerms({
      brief: "",
      headline: "Senior Engineer",
      positions: Array.from({ length: 12 }, (_, i) => `Platform Engineer ${i}`),
      projectNames: [],
      skillNames: [],
    });

    expect(result.source).toBe("fallback");
    expect(result.terms).toHaveLength(10);
    expect(result.terms[0]).toBe("Senior Engineer");
    expect(result.terms).not.toContain("Platform Engineer 10");
  });
});
