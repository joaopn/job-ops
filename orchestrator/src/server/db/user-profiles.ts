/**
 * User Profiles — the file layer above the installation.
 *
 * A "user profile" is a whole database. The ACTIVE profile is always
 * `<DATA_DIR>/jobs.db` (no existing code path changes); inactive profiles are
 * closed, checkpointed SQLite files at `<DATA_DIR>/user-profiles/<uuid>.db`.
 * The directory listing IS the registry — each DB self-describes via a
 * `userProfileName` settings row, and store filenames are fresh
 * server-assigned UUIDs so importing a copy of an existing profile can never
 * collide.
 *
 * Like snapshot.ts, this module is deliberately import-free of `./index` (the
 * DB singleton opens SQLite at module load): it manages files and short-lived
 * connections only. Closing the live connection before a swap is the route's
 * job (`closeDb()`), as is the restart afterward.
 */

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type { StoredUserProfile, UserProfileStats } from "@shared/types";
import Database from "better-sqlite3";
import { getDataDir } from "../config/dataDir";
import { validateSnapshot } from "./snapshot";

const STORE_DIR_NAME = "user-profiles";
const IMPORT_STAGING_NAME = "import-staging.db";
const NAME_SETTING_KEY = "userProfileName";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function liveDbPath(): string {
  return join(getDataDir(), "jobs.db");
}

export function userProfilesDir(): string {
  const dir = join(getDataDir(), STORE_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Staging path for an uploaded import — same filesystem as the store so the
 * final rename is atomic. */
export function importStagingPath(): string {
  return join(userProfilesDir(), IMPORT_STAGING_NAME);
}

/** Resolve a stored profile's file path. The id must be a UUID —
 * case-insensitive because route validation (zod `.uuid()`) accepts uppercase
 * hex; anything else (traversal attempts included) throws. */
export function storedProfilePath(id: string): string {
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`Invalid user profile id: ${id}`);
  }
  return join(userProfilesDir(), `${id}.db`);
}

export function readProfileName(path: string): string | null {
  let d: Database.Database;
  try {
    d = new Database(path, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
  try {
    const row = d
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(NAME_SETTING_KEY) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  } finally {
    d.close();
  }
}

/** Upsert the self-describing name row inside a (closed) profile file. Throws
 * when the file has no usable `settings` table — callers map that to a 422. */
export function writeProfileName(path: string, name: string): void {
  const d = new Database(path, { fileMustExist: true });
  try {
    const now = new Date().toISOString();
    d.prepare(
      `INSERT INTO settings (key, value, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(NAME_SETTING_KEY, name, now, now);
  } finally {
    d.close();
  }
}

/**
 * Read display stats from a profile file. Each stat guards independently —
 * older-shape DBs may lack individual tables — so a partial read degrades to
 * nulls (or `[]` for search-profile names) instead of failing the listing.
 * Safe against the LIVE jobs.db while the singleton is open: WAL permits
 * concurrent readers and this is display-only data.
 */
export function readProfileStats(path: string): {
  stats: UserProfileStats | null;
  sizeBytes: number;
} {
  let sizeBytes = 0;
  try {
    sizeBytes = statSync(path).size;
  } catch {
    return { stats: null, sizeBytes: 0 };
  }

  let d: Database.Database;
  try {
    d = new Database(path, { readonly: true, fileMustExist: true });
  } catch {
    return { stats: null, sizeBytes };
  }

  const count = (sql: string): number | null => {
    try {
      const row = d.prepare(sql).get() as { n: number } | undefined;
      return row?.n ?? null;
    } catch {
      return null;
    }
  };

  try {
    const stats: UserProfileStats = {
      jobsTotal: count("SELECT COUNT(*) AS n FROM jobs"),
      liveJobs: count(
        "SELECT COUNT(*) AS n FROM jobs WHERE status IN ('applied', 'in_progress')",
      ),
      cvDocuments: count("SELECT COUNT(*) AS n FROM cv_documents"),
      searchProfileNames: (() => {
        try {
          const rows = d
            .prepare("SELECT name FROM profiles ORDER BY updated_at DESC")
            .all() as { name: string }[];
          return rows.map((r) => r.name);
        } catch {
          return [];
        }
      })(),
      lastUpdatedAt: (() => {
        try {
          const row = d
            .prepare("SELECT MAX(updated_at) AS latest FROM jobs")
            .get() as { latest: string | null } | undefined;
          if (row?.latest) return row.latest;
        } catch {
          // fall through to file mtime
        }
        try {
          return statSync(path).mtime.toISOString();
        } catch {
          return null;
        }
      })(),
    };
    return { stats, sizeBytes };
  } finally {
    d.close();
  }
}

export function listStoredProfiles(): StoredUserProfile[] {
  const dir = userProfilesDir();
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith(".db") && f !== IMPORT_STAGING_NAME)
    .sort();

  return entries.map((file) => {
    const id = file.slice(0, -".db".length);
    const path = join(dir, file);
    const validation = validateSnapshot(path);
    if (!validation.ok) {
      let sizeBytes = 0;
      try {
        sizeBytes = statSync(path).size;
      } catch {
        // unreadable file — size stays 0
      }
      return {
        id,
        name: id,
        sizeBytes,
        stats: null,
        invalid: true,
        invalidReason: validation.reason,
      };
    }
    const { stats, sizeBytes } = readProfileStats(path);
    return { id, name: readProfileName(path) ?? id, sizeBytes, stats };
  });
}

/**
 * Move the live DB into the store under a fresh UUID. The caller MUST have
 * closed the live connection (`closeDb()`) first.
 *
 * The last connection close normally checkpoints the WAL, but the stashed
 * file becomes a first-class profile (unlike restore's disposable `.bak`), so
 * a silently-failed checkpoint followed by the sidecar clear would truncate
 * it. Belt-and-braces: checkpoint explicitly before clearing sidecars.
 * `fileMustExist` keeps a missing jobs.db a loud error instead of better-
 * sqlite3 fabricating an empty DB and storing that as a "profile".
 */
export function stashLiveDb(): { id: string } {
  const live = liveDbPath();
  const checkpoint = new Database(live, { fileMustExist: true });
  try {
    checkpoint.pragma("wal_checkpoint(TRUNCATE)");
  } finally {
    checkpoint.close();
  }
  for (const sidecar of [`${live}-wal`, `${live}-shm`]) {
    rmSync(sidecar, { force: true });
  }

  const id = randomUUID();
  renameSync(live, storedProfilePath(id));
  return { id };
}

/**
 * Swap a stored profile in as the live DB: stash the live DB, then move the
 * chosen file into place. Caller must have closed the live connection and
 * must restart the process afterward. Both renames are same-filesystem
 * (the store lives under DATA_DIR) and therefore atomic; a crash between
 * them leaves no jobs.db — boot then creates a fresh install while the old
 * data sits safely in the store.
 */
export function activateStoredProfile(id: string): { stashedId: string } {
  const source = storedProfilePath(id);
  if (!existsSync(source)) {
    throw new Error(`Stored user profile not found: ${id}`);
  }
  const { id: stashedId } = stashLiveDb();
  renameSync(source, liveDbPath());
  return { stashedId };
}

/** Move a validated import from staging into the store under a fresh UUID.
 * A profile without a self-describing name gets one written in (imports must
 * stay self-describing). Validation is the caller's job (`validateSnapshot`
 * on the staging file). */
export function storeImportedProfile(stagingPath: string): {
  id: string;
  name: string;
} {
  const id = randomUUID();
  renameSync(stagingPath, storedProfilePath(id));
  const existing = readProfileName(storedProfilePath(id));
  if (existing) {
    return { id, name: existing };
  }
  const name = `Imported ${new Date().toISOString().slice(0, 10)}`;
  writeProfileName(storedProfilePath(id), name);
  return { id, name };
}

/**
 * Pre-create the fresh live DB after a "new profile" stash so the next boot
 * adopts the user's chosen name: migrations create `settings` with IF NOT
 * EXISTS and the `userProfileName` seed is absent-only, so a table + name row
 * that already exist survive untouched. The plain `new Database(path)` is the
 * ONE deliberate exception to this module's `fileMustExist` rule — creation
 * is the point, and the caller has just stashed the previous live DB away.
 */
export function createFreshLiveDb(name: string): void {
  const d = new Database(liveDbPath());
  try {
    // Mirrored from migrate.ts's settings DDL — keep in lockstep.
    d.exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
    const now = new Date().toISOString();
    d.prepare(
      `INSERT INTO settings (key, value, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(NAME_SETTING_KEY, name, now, now);
  } finally {
    d.close();
  }
}

export function deleteStoredProfile(id: string): boolean {
  const path = storedProfilePath(id);
  if (!existsSync(path)) {
    return false;
  }
  rmSync(path, { force: true });
  for (const sidecar of [`${path}-wal`, `${path}-shm`]) {
    rmSync(sidecar, { force: true });
  }
  return true;
}
