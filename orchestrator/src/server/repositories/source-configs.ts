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

function mapRow(row: SourceConfigDbRow): SourceConfigRow {
  return {
    extractorId: row.extractorId,
    enabled: Boolean(row.enabled),
    config: parseConfigJson(row.configJson),
    mappings: parseMappingsJson(row.mappingsJson),
    updatedAt: row.updatedAt,
  };
}

export async function getAllSourceConfigs(): Promise<SourceConfigRow[]> {
  const rows = await db.select().from(sourceConfigs);
  return rows.map(mapRow);
}

export async function getSourceConfig(
  extractorId: string,
): Promise<SourceConfigRow | null> {
  const [row] = await db
    .select()
    .from(sourceConfigs)
    .where(eq(sourceConfigs.extractorId, extractorId));
  return row ? mapRow(row) : null;
}

export async function getEnabledExtractorIds(): Promise<string[]> {
  const rows = await getAllSourceConfigs();
  return rows.filter((row) => row.enabled).map((row) => row.extractorId);
}

export async function upsertSourceConfig(
  extractorId: string,
  patch: UpsertSourceConfigInput,
): Promise<SourceConfigRow> {
  const existing = await getSourceConfig(extractorId);
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
      .where(eq(sourceConfigs.extractorId, extractorId));
  } else {
    await db.insert(sourceConfigs).values({
      extractorId,
      enabled,
      configJson: config,
      mappingsJson: mappings,
      updatedAt,
    });
  }

  const refreshed = await getSourceConfig(extractorId);
  if (!refreshed) {
    throw new Error(`Failed to load upserted source config ${extractorId}`);
  }
  return refreshed;
}
