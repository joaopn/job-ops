/**
 * Repository for prompts — live LLM prompt YAML (`content`) plus the baked
 * image default (`defaultContent`). Seeding/refresh happens in migrate.ts;
 * this layer only reads and edits the live copy.
 */

import { eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index";

const { prompts } = schema;

export type PromptRow = {
  name: string;
  content: string;
  defaultContent: string;
  updatedAt: string;
};

export async function getAllPromptRows(): Promise<PromptRow[]> {
  return await db.select().from(prompts);
}

export async function getPromptRow(name: string): Promise<PromptRow | null> {
  const [row] = await db.select().from(prompts).where(eq(prompts.name, name));
  return row ?? null;
}

export async function updatePromptContent(
  name: string,
  content: string,
): Promise<number> {
  const result = await db
    .update(prompts)
    .set({ content, updatedAt: sql`(datetime('now'))` })
    .where(eq(prompts.name, name))
    .run();
  return result.changes;
}

/** Copy `defaultContent` back over `content` (the Reset button). */
export async function resetPromptContent(name: string): Promise<number> {
  const result = await db
    .update(prompts)
    .set({
      content: sql`default_content`,
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(prompts.name, name))
    .run();
  return result.changes;
}
