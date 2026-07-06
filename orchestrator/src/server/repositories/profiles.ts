import { randomUUID } from "node:crypto";
import {
  type CreateProfileInput,
  defaultProfileConfig,
  type Profile,
  type ProfileConfig,
  parseProfileConfig,
  type UpdateProfileInput,
} from "@shared/types";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "../db/index";
import type { ProfileDbRow } from "../db/schema";

const { profiles } = schema;

function mapRow(row: ProfileDbRow): Profile {
  return {
    id: row.id,
    name: row.name,
    config: parseProfileConfig(row.configJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getAllProfiles(): Promise<Profile[]> {
  const rows = await db
    .select()
    .from(profiles)
    .orderBy(desc(profiles.updatedAt));
  return rows.map(mapRow);
}

export async function getProfile(id: string): Promise<Profile | null> {
  const [row] = await db.select().from(profiles).where(eq(profiles.id, id));
  return row ? mapRow(row) : null;
}

export async function countProfiles(): Promise<number> {
  const rows = await db.select({ id: profiles.id }).from(profiles);
  return rows.length;
}

export async function createProfile(
  input: CreateProfileInput,
): Promise<Profile> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const config: ProfileConfig = {
    ...defaultProfileConfig(),
    ...(input.config ?? {}),
  };
  await db.insert(profiles).values({
    id,
    name: input.name,
    configJson: config,
    createdAt: now,
    updatedAt: now,
  });
  const created = await getProfile(id);
  if (!created) {
    throw new Error(`Failed to load created profile ${id}`);
  }
  return created;
}

export async function updateProfile(
  id: string,
  patch: UpdateProfileInput,
): Promise<Profile | null> {
  const existing = await getProfile(id);
  if (!existing) return null;

  const next: Partial<typeof profiles.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.config !== undefined) {
    // Field-level merge over the existing blob; an explicit `null` inside the
    // patch (e.g. scrapeMaxAgeDays) sets null, an omitted key is preserved.
    next.configJson = { ...existing.config, ...patch.config };
  }

  await db.update(profiles).set(next).where(eq(profiles.id, id));

  return await getProfile(id);
}

export async function deleteProfile(id: string): Promise<boolean> {
  const result = await db.delete(profiles).where(eq(profiles.id, id)).run();
  return result.changes > 0;
}
