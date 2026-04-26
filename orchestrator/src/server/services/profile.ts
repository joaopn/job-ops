import type { ResumeProfile } from "@shared/types";

/**
 * Stub: the resume layer is being rewritten on top of a user-uploaded LaTeX
 * CV (extracted into structured CvContent). Until that lands, callers receive
 * a minimal empty profile so scorer/ghostwriter paths can boot without
 * pulling in RxResume.
 */
export async function getProfile(
  _forceRefresh = false,
): Promise<ResumeProfile> {
  return { basics: {}, sections: {} };
}

export async function getPersonName(): Promise<string> {
  return "Resume";
}

export function clearProfileCache(): void {
  // no-op until the new resume layer lands
}
