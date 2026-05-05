/**
 * Standalone script to run the pipeline.
 * Can be triggered by n8n or cron.
 *
 * Usage: npm run pipeline:run
 */

import {
  SUITABILITY_CATEGORIES,
  type SuitabilityCategory,
} from "@shared/types";
import "../config/env";
import { closeDb } from "../db/index";
import { runPipeline } from "./orchestrator";

function parseEnvCategory(raw: string | undefined): SuitabilityCategory {
  if (raw && (SUITABILITY_CATEGORIES as readonly string[]).includes(raw)) {
    return raw as SuitabilityCategory;
  }
  return "good_fit";
}

async function main() {
  console.log("=".repeat(60));
  console.log("🚀 Job Pipeline Runner");
  console.log(`   Started at: ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  const result = await runPipeline({
    topN: parseInt(process.env.PIPELINE_TOP_N || "10", 10),
    minSuitabilityCategory: parseEnvCategory(
      process.env.PIPELINE_MIN_CATEGORY,
    ),
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log("📊 Pipeline Results:");
  console.log(`   Success: ${result.success}`);
  console.log(`   Jobs Discovered: ${result.jobsDiscovered}`);
  console.log(`   Jobs Processed: ${result.jobsProcessed}`);
  if (result.error) {
    console.log(`   Error: ${result.error}`);
  }
  console.log(`   Completed at: ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  closeDb();
  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  closeDb();
  process.exit(1);
});
