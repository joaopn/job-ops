import { randomUUID } from "node:crypto";
import type {
  CreateProviderInstanceInput,
  ProviderInstanceRow,
  SourceConfigGlobalField,
  UpdateProviderInstanceInput,
} from "@shared/types";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index";
import type { ProviderInstanceDbRow } from "../db/schema";

const { providerInstances } = schema;

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

function mapRow(row: ProviderInstanceDbRow): ProviderInstanceRow {
  return {
    id: row.id,
    providerId: row.providerId,
    actorRef: row.actorRef,
    label: row.label,
    templateId: row.templateId,
    enabled: Boolean(row.enabled),
    inputTemplateJson: row.inputTemplateJson,
    outputMappingJson: row.outputMappingJson,
    mappings: parseMappingsJson(row.mappingsJson),
    updatedAt: row.updatedAt,
  };
}

export async function getAllProviderInstances(): Promise<ProviderInstanceRow[]> {
  const rows = await db.select().from(providerInstances);
  return rows.map(mapRow);
}

export async function getProviderInstance(
  id: string,
): Promise<ProviderInstanceRow | null> {
  const [row] = await db
    .select()
    .from(providerInstances)
    .where(eq(providerInstances.id, id));
  return row ? mapRow(row) : null;
}

export async function getProviderInstancesByProvider(
  providerId: string,
): Promise<ProviderInstanceRow[]> {
  const rows = await db
    .select()
    .from(providerInstances)
    .where(eq(providerInstances.providerId, providerId));
  return rows.map(mapRow);
}

export async function getEnabledProviderInstances(): Promise<
  ProviderInstanceRow[]
> {
  const rows = await getAllProviderInstances();
  return rows.filter((row) => row.enabled);
}

export async function createProviderInstance(
  input: CreateProviderInstanceInput,
): Promise<ProviderInstanceRow> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.insert(providerInstances).values({
    id,
    providerId: input.providerId,
    actorRef: input.actorRef,
    label: input.label,
    templateId: input.templateId ?? null,
    enabled: input.enabled ?? false,
    inputTemplateJson: input.inputTemplateJson,
    outputMappingJson: input.outputMappingJson ?? "{}",
    mappingsJson: input.mappings ?? {},
    updatedAt: now,
  });
  const created = await getProviderInstance(id);
  if (!created) {
    throw new Error(`Failed to load created provider instance ${id}`);
  }
  return created;
}

export async function updateProviderInstance(
  id: string,
  patch: UpdateProviderInstanceInput,
): Promise<ProviderInstanceRow | null> {
  const existing = await getProviderInstance(id);
  if (!existing) return null;

  const next: Partial<typeof providerInstances.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (patch.actorRef !== undefined) next.actorRef = patch.actorRef;
  if (patch.label !== undefined) next.label = patch.label;
  if (patch.templateId !== undefined) next.templateId = patch.templateId;
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.inputTemplateJson !== undefined) {
    next.inputTemplateJson = patch.inputTemplateJson;
  }
  if (patch.outputMappingJson !== undefined) {
    next.outputMappingJson = patch.outputMappingJson;
  }
  if (patch.mappings !== undefined) {
    next.mappingsJson = { ...existing.mappings, ...patch.mappings };
  }

  await db
    .update(providerInstances)
    .set(next)
    .where(eq(providerInstances.id, id));

  return await getProviderInstance(id);
}

export async function deleteProviderInstance(id: string): Promise<boolean> {
  const result = await db
    .delete(providerInstances)
    .where(eq(providerInstances.id, id))
    .run();
  return result.changes > 0;
}
