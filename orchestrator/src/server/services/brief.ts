import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { getActiveCvDocument } from "@server/services/cv-active";

export async function getActivePersonalBrief(): Promise<string> {
  try {
    const cv = await getActiveCvDocument();
    return cv?.personalBrief?.trim() ?? "";
  } catch (error) {
    logger.warn("Failed to load active CV; returning empty personal brief", {
      error: sanitizeUnknown(error),
    });
    return "";
  }
}
