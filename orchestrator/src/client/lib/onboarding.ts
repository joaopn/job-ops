import type { AppSettings } from "@shared/types";

export function hasCompletedBasicAuthOnboarding(
  settings: AppSettings | null | undefined,
): boolean {
  return Boolean(
    settings?.basicAuthActive || settings?.onboardingBasicAuthDecision !== null,
  );
}

export function hasSavedSearchTermsOnboarding(
  searchTerms: readonly string[] | null | undefined,
): boolean {
  return Boolean(Array.isArray(searchTerms) && searchTerms.length > 0);
}

export function isOnboardingComplete(input: {
  settings: AppSettings | null | undefined;
  llmValid: boolean;
  searchTermsValid: boolean;
}): boolean {
  if (!input.settings) return false;

  return Boolean(
    input.llmValid &&
      input.searchTermsValid &&
      hasCompletedBasicAuthOnboarding(input.settings),
  );
}
