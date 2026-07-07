import { describe, expect, it } from "vitest";
import {
  hasCompletedBasicAuthOnboarding,
  hasSavedSearchTermsOnboarding,
  isOnboardingComplete,
} from "./onboarding";

describe("onboarding helpers", () => {
  it("treats a skipped basic-auth decision as complete", () => {
    expect(
      hasCompletedBasicAuthOnboarding({
        basicAuthActive: false,
        onboardingBasicAuthDecision: "skipped",
      } as any),
    ).toBe(true);
  });

  it("treats a non-empty search-terms list as saved", () => {
    expect(hasSavedSearchTermsOnboarding(["Platform Engineer"])).toBe(true);
    expect(hasSavedSearchTermsOnboarding([])).toBe(false);
    expect(hasSavedSearchTermsOnboarding(undefined)).toBe(false);
    expect(hasSavedSearchTermsOnboarding(null)).toBe(false);
  });

  it("is incomplete when search terms have not been saved", () => {
    expect(
      isOnboardingComplete({
        settings: {
          basicAuthActive: false,
          onboardingBasicAuthDecision: "skipped",
        } as any,
        llmValid: true,
        searchTermsValid: false,
      }),
    ).toBe(false);
  });

  it("treats all required onboarding gates passing as complete", () => {
    expect(
      isOnboardingComplete({
        settings: {
          basicAuthActive: false,
          onboardingBasicAuthDecision: "skipped",
        } as any,
        llmValid: true,
        searchTermsValid: true,
      }),
    ).toBe(true);
  });
});
