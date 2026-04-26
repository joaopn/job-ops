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

  it("requires an explicit saved search-terms override by default", () => {
    expect(
      hasSavedSearchTermsOnboarding({
        searchTerms: {
          value: ["Platform Engineer"],
          default: ["Software Engineer"],
          override: ["Platform Engineer"],
        },
      } as any),
    ).toBe(true);

    expect(
      isOnboardingComplete({
        settings: {
          basicAuthActive: false,
          onboardingBasicAuthDecision: "skipped",
          searchTerms: {
            value: ["Software Engineer"],
            default: ["Software Engineer"],
            override: null,
          },
        } as any,
        llmValid: true,
      }),
    ).toBe(false);
  });

  it("allows the flow to override search-term completion with session state", () => {
    expect(
      isOnboardingComplete({
        settings: {
          basicAuthActive: false,
          onboardingBasicAuthDecision: "skipped",
          searchTerms: {
            value: ["Platform Engineer"],
            default: ["Software Engineer"],
            override: ["Platform Engineer"],
          },
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
          searchTerms: {
            value: ["Platform Engineer"],
            default: ["Software Engineer"],
            override: ["Platform Engineer"],
          },
        } as any,
        llmValid: true,
      }),
    ).toBe(true);
  });
});
