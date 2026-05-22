import {
  type ExtractorSourceId,
  isExtractorSourceId,
} from "@shared/extractors";
import type {
  SourceConfigGlobalField,
  SourceConfigRow,
  UpsertSourceConfigInput,
} from "@shared/types";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index";
import type { SourceConfigDbRow } from "../db/schema";

const { sourceConfigs } = schema;

function parseConfigJson(raw: unknown): Record<string, string> {
  if (!raw) return {};
  const source = typeof raw === "string" ? safeParse(raw) : raw;
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function parseMappingsJson(
  raw: unknown,
): Partial<Record<SourceConfigGlobalField, boolean>> {
  if (!raw) return {};
  const source = typeof raw === "string" ? safeParse(raw) : raw;
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const out: Partial<Record<SourceConfigGlobalField, boolean>> = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (typeof value === "boolean") {
      out[key as SourceConfigGlobalField] = value;
    }
  }
  return out;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function mapRow(row: SourceConfigDbRow): SourceConfigRow | null {
  if (!isExtractorSourceId(row.sourceId)) return null;
  return {
    sourceId: row.sourceId,
    enabled: Boolean(row.enabled),
    config: parseConfigJson(row.configJson),
    mappings: parseMappingsJson(row.mappingsJson),
    updatedAt: row.updatedAt,
  };
}

export async function getAllSourceConfigs(): Promise<SourceConfigRow[]> {
  const rows = await db.select().from(sourceConfigs);
  const out: SourceConfigRow[] = [];
  for (const row of rows) {
    const mapped = mapRow(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

export async function getSourceConfig(
  sourceId: ExtractorSourceId,
): Promise<SourceConfigRow | null> {
  const [row] = await db
    .select()
    .from(sourceConfigs)
    .where(eq(sourceConfigs.sourceId, sourceId));
  return row ? mapRow(row) : null;
}

export async function getEnabledSources(): Promise<ExtractorSourceId[]> {
  const rows = await getAllSourceConfigs();
  return rows.filter((row) => row.enabled).map((row) => row.sourceId);
}

export async function upsertSourceConfig(
  sourceId: ExtractorSourceId,
  patch: UpsertSourceConfigInput,
): Promise<SourceConfigRow> {
  const existing = await getSourceConfig(sourceId);
  const enabled = patch.enabled ?? existing?.enabled ?? false;
  const config = patch.config ?? existing?.config ?? {};
  const mappings = patch.mappings
    ? { ...(existing?.mappings ?? {}), ...patch.mappings }
    : (existing?.mappings ?? {});
  const updatedAt = new Date().toISOString();

  if (existing) {
    await db
      .update(sourceConfigs)
      .set({
        enabled,
        configJson: config,
        mappingsJson: mappings,
        updatedAt,
      })
      .where(eq(sourceConfigs.sourceId, sourceId));
  } else {
    await db.insert(sourceConfigs).values({
      sourceId,
      enabled,
      configJson: config,
      mappingsJson: mappings,
      updatedAt,
    });
  }

  const refreshed = await getSourceConfig(sourceId);
  if (!refreshed) {
    throw new Error(`Failed to load upserted source config ${sourceId}`);
  }
  return refreshed;
}
