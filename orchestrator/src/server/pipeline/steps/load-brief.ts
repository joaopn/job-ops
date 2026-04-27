import { logger } from "@infra/logger";
import { getActivePersonalBrief } from "@server/services/brief";

export async function loadBriefStep(): Promise<string> {
  logger.info("Loading personal brief");
  return getActivePersonalBrief().catch((error) => {
    logger.warn("Failed to load personal brief, using empty string", error);
    return "";
  });
}
