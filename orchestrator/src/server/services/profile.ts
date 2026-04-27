import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { getActiveCvContent } from "@server/services/cv-active";
import { cvContentToResumeProfile } from "@server/services/cv-to-profile";
import type { ResumeProfile } from "@shared/types";

export async function getProfile(): Promise<ResumeProfile> {
  try {
    const content = await getActiveCvContent();
    if (!content) return { basics: {}, sections: {} };
    return cvContentToResumeProfile(content);
  } catch (error) {
    logger.warn("Failed to load active CV; returning empty profile", {
      error: sanitizeUnknown(error),
    });
    return { basics: {}, sections: {} };
  }
}
