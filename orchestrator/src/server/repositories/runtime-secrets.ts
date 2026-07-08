/**
 * Repository for runtime_secrets — server-internal secrets (currently just
 * the JWT signing secret). Deliberately not settings-registry rows: registry
 * values echo through GET /api/settings, and a signing secret must have no
 * read surface.
 */

import { eq } from "drizzle-orm";
import { db, schema } from "../db/index";

const { runtimeSecrets } = schema;

export async function getRuntimeSecret(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: runtimeSecrets.value })
    .from(runtimeSecrets)
    .where(eq(runtimeSecrets.key, key));
  return row?.value ?? null;
}

/**
 * Insert-if-absent: concurrent callers converge on the first writer's value
 * (the caller re-reads after this to pick up the winner).
 */
export async function insertRuntimeSecretIfAbsent(
  key: string,
  value: string,
): Promise<void> {
  await db
    .insert(runtimeSecrets)
    .values({ key, value })
    .onConflictDoNothing();
}
