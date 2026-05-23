import { notFound, toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { getExtractorRegistry } from "@server/extractors/registry";
import * as repo from "@server/repositories/source-configs";
import {
  EXTRACTOR_SOURCE_METADATA,
  type ExtractorSourceId,
  isExtractorSourceId,
  PIPELINE_EXTRACTOR_SOURCE_IDS,
} from "@shared/extractors";
import {
  SOURCE_CONFIG_GLOBAL_FIELDS,
  type SourceConfigSchema,
} from "@shared/types";
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";

export const sourceConfigsRouter = Router();

const globalFieldEnum = z.enum(
  SOURCE_CONFIG_GLOBAL_FIELDS as unknown as [string, ...string[]],
);

const upsertSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.string()).optional(),
  mappings: z.record(globalFieldEnum, z.boolean()).optional(),
});

sourceConfigsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const [rows, registry] = await Promise.all([
      repo.getAllSourceConfigs(),
      getExtractorRegistry(),
    ]);
    const rowsBySource = new Map<ExtractorSourceId, (typeof rows)[number]>();
    for (const row of rows) rowsBySource.set(row.sourceId, row);

    const data = PIPELINE_EXTRACTOR_SOURCE_IDS.map((sourceId) => {
      const existing = rowsBySource.get(sourceId);
      return (
        existing ?? {
          sourceId,
          enabled: false,
          config: {},
          mappings: {},
          updatedAt: new Date(0).toISOString(),
        }
      );
    });
    const schemas: Record<string, SourceConfigSchema | null> = {};
    for (const sourceId of PIPELINE_EXTRACTOR_SOURCE_IDS) {
      const manifest = registry.manifestBySource.get(sourceId);
      schemas[sourceId] = manifest?.configSchema ?? null;
    }
    ok(res, {
      rows: data,
      metadata: Object.fromEntries(
        PIPELINE_EXTRACTOR_SOURCE_IDS.map((sourceId) => [
          sourceId,
          EXTRACTOR_SOURCE_METADATA[sourceId],
        ]),
      ),
      schemas,
    });
  } catch (error) {
    fail(res, toAppError(error));
  }
});

sourceConfigsRouter.put(
  "/:sourceId",
  async (req: Request, res: Response) => {
    try {
      const { sourceId } = req.params;
      if (!isExtractorSourceId(sourceId)) {
        return fail(res, notFound(`Unknown source: ${sourceId}`));
      }
      const patch = upsertSchema.parse(req.body ?? {});
      const updated = await repo.upsertSourceConfig(sourceId, patch);
      ok(res, updated);
    } catch (error) {
      fail(res, toAppError(error));
    }
  },
);
