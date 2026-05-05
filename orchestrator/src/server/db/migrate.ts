/**
 * Database migration script - creates tables if they don't exist
 * and brings legacy schemas up to the current shape.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { getDataDir } from "../config/dataDir";

const DB_PATH = join(getDataDir(), "jobs.db");

const dataDir = dirname(DB_PATH);
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const sqlite = new Database(DB_PATH);

const migrations: string[] = [
  // Drop tables for stripped features (safe if missing).
  `DROP TABLE IF EXISTS design_resume_assets`,
  `DROP TABLE IF EXISTS design_resume_documents`,
  `DROP TABLE IF EXISTS post_application_message_candidates`,
  `DROP TABLE IF EXISTS post_application_message_links`,
  `DROP TABLE IF EXISTS post_application_messages`,
  `DROP TABLE IF EXISTS post_application_sync_runs`,
  `DROP TABLE IF EXISTS post_application_integrations`,
  `DROP TABLE IF EXISTS stage_events`,
  `DROP TABLE IF EXISTS tracer_click_events`,
  `DROP TABLE IF EXISTS tracer_links`,
  `DROP TABLE IF EXISTS backup_runs`,

  // Canonical tables.
  `CREATE TABLE IF NOT EXISTS cv_documents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    original_archive BLOB NOT NULL,
    flattened_tex TEXT NOT NULL,
    fields TEXT NOT NULL DEFAULT '[]',
    personal_brief TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'linkedin',
    source_job_id TEXT,
    job_url_direct TEXT,
    date_posted TEXT,
    job_type TEXT,
    salary_source TEXT,
    salary_interval TEXT,
    salary_min_amount REAL,
    salary_max_amount REAL,
    salary_currency TEXT,
    is_remote INTEGER,
    job_level TEXT,
    job_function TEXT,
    listing_type TEXT,
    emails TEXT,
    company_industry TEXT,
    company_logo TEXT,
    company_url_direct TEXT,
    company_addresses TEXT,
    company_num_employees TEXT,
    company_revenue TEXT,
    company_description TEXT,
    skills TEXT,
    experience_range TEXT,
    company_rating REAL,
    company_reviews_count INTEGER,
    vacancy_count INTEGER,
    work_from_home_type TEXT,
    title TEXT NOT NULL,
    employer TEXT NOT NULL,
    employer_url TEXT,
    job_url TEXT NOT NULL UNIQUE,
    application_link TEXT,
    disciplines TEXT,
    deadline TEXT,
    salary TEXT,
    location TEXT,
    location_evidence TEXT,
    degree_required TEXT,
    starting TEXT,
    job_description TEXT,
    status TEXT NOT NULL DEFAULT 'discovered' CHECK(status IN ('discovered', 'processing', 'ready', 'applied', 'in_progress', 'skipped', 'expired')),
    outcome TEXT,
    closed_at INTEGER,
    suitability_category TEXT CHECK(suitability_category IS NULL OR suitability_category IN ('very_good_fit', 'good_fit', 'bad_fit')),
    suitability_reason TEXT,
    tailored_fields TEXT NOT NULL DEFAULT '{}',
    tailoring_matched TEXT,
    tailoring_skipped TEXT,
    cv_document_id TEXT REFERENCES cv_documents(id) ON DELETE SET NULL,
    pdf_path TEXT,
    cover_letter_draft TEXT NOT NULL DEFAULT '',
    discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    ready_at TEXT,
    applied_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
    jobs_discovered INTEGER NOT NULL DEFAULT 0,
    jobs_processed INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    config_snapshot TEXT,
    requested_config TEXT,
    effective_config TEXT,
    result_summary TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS job_chat_threads (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_message_at TEXT,
    active_root_message_id TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS job_chat_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
    content TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'partial' CHECK(status IN ('complete', 'partial', 'cancelled', 'failed')),
    tokens_in INTEGER,
    tokens_out INTEGER,
    version INTEGER NOT NULL DEFAULT 1,
    replaces_message_id TEXT,
    parent_message_id TEXT,
    active_child_id TEXT,
    proposed_edit TEXT,
    edit_status TEXT CHECK(edit_status IS NULL OR edit_status IN ('pending', 'accepted', 'rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (thread_id) REFERENCES job_chat_threads(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS job_chat_runs (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'cancelled', 'failed')),
    model TEXT,
    provider TEXT,
    error_code TEXT,
    error_message TEXT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    request_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (thread_id) REFERENCES job_chat_threads(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    due_date INTEGER,
    is_completed INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    FOREIGN KEY (application_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS job_notes (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS interviews (
    id TEXT PRIMARY KEY,
    application_id TEXT NOT NULL,
    scheduled_at INTEGER NOT NULL,
    duration_mins INTEGER,
    type TEXT NOT NULL,
    outcome TEXT,
    FOREIGN KEY (application_id) REFERENCES jobs(id) ON DELETE CASCADE
  )`,

  // Add new columns on top of legacy DBs (safe to skip when already present).
  `ALTER TABLE jobs ADD COLUMN tailoring_matched TEXT`,
  `ALTER TABLE jobs ADD COLUMN tailoring_skipped TEXT`,
  `ALTER TABLE jobs ADD COLUMN cv_document_id TEXT REFERENCES cv_documents(id) ON DELETE SET NULL`,
  `ALTER TABLE jobs ADD COLUMN cover_letter_draft TEXT NOT NULL DEFAULT ''`,
  // Idempotent ALTER so the jobs-rebuild SELECT below can reference
  // `tailored_fields` directly instead of hardcoding `'{}' AS
  // tailored_fields`. Without this, every boot wipes per-job tailoring back
  // to '{}' (the rebuild runs on every startup).
  `ALTER TABLE jobs ADD COLUMN tailored_fields TEXT NOT NULL DEFAULT '{}'`,
  // suitability_category replaces suitability_score (numeric → categorical
  // enum). Idempotent ALTER lets the rebuild's SELECT reference the new
  // column directly. Legacy DBs without it pick up NULL on first boot.
  `ALTER TABLE jobs ADD COLUMN suitability_category TEXT`,
  `ALTER TABLE job_chat_messages ADD COLUMN proposed_edit TEXT`,
  `ALTER TABLE job_chat_messages ADD COLUMN edit_status TEXT`,
  `ALTER TABLE cv_documents ADD COLUMN personal_brief TEXT NOT NULL DEFAULT ''`,

  // Phase 5d destructive rebuild: drop the LLM-generated `template` /
  // `content` columns on cv_documents (replaced by per-field `fields`) and
  // drop `tailored_content` on jobs (replaced by `tailored_fields`). Legacy
  // CVs need to be re-extracted; legacy tailorings are invalidated. The
  // fork is private and not yet load-bearing.
  //
  // The defensive ALTER below is required so the rebuild is idempotent.
  // migrate.ts runs every boot; without it, the SELECT below has to
  // hardcode `'[]' AS fields` (because legacy rows lack the column) which
  // wipes every CV's fields on the SECOND boot after upload. The ALTER
  // skips silently on the duplicate-column branch when fields already
  // exists, so it's a no-op on every boot after the first.
  `ALTER TABLE cv_documents ADD COLUMN fields TEXT NOT NULL DEFAULT '[]'`,
  `PRAGMA foreign_keys = OFF`,
  `DROP TABLE IF EXISTS cv_documents_new`,
  `CREATE TABLE cv_documents_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    original_archive BLOB NOT NULL,
    flattened_tex TEXT NOT NULL,
    fields TEXT NOT NULL DEFAULT '[]',
    personal_brief TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `INSERT INTO cv_documents_new (
    id, name, original_archive, flattened_tex, fields, personal_brief,
    created_at, updated_at
  )
  SELECT
    id, name, original_archive, flattened_tex, fields, personal_brief,
    created_at, updated_at
  FROM cv_documents`,
  `DROP TABLE cv_documents`,
  `ALTER TABLE cv_documents_new RENAME TO cv_documents`,
  `PRAGMA foreign_keys = ON`,

  // 5g repost-tracking columns. Additive, idempotent via duplicate-column
  // skip below. Has to run BEFORE the rebuild block — the rebuild's
  // INSERT SELECT references `reposted_at` / `repost_count` from `jobs`, so
  // legacy DBs without those columns would otherwise fail the SELECT.
  `ALTER TABLE jobs ADD COLUMN reposted_at TEXT`,
  `ALTER TABLE jobs ADD COLUMN repost_count INTEGER NOT NULL DEFAULT 0`,

  // Canonical jobs-table rebuild. Originally added in 5d to drop unused
  // columns (tailored_summary/headline/skills, tracer_links_enabled,
  // sponsor_match_*); 5g extended it with the new status + outcome enums and
  // the repost-tracking columns. Runs every boot; on a fresh DB it's a
  // round-trip with zero rows. The CASE expressions remap legacy enum values
  // forward for any pre-5g rows that might still be in flight.
  `PRAGMA foreign_keys = OFF`,
  `DROP TABLE IF EXISTS jobs_new`,
  `CREATE TABLE jobs_new (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'linkedin',
    source_job_id TEXT,
    job_url_direct TEXT,
    date_posted TEXT,
    job_type TEXT,
    salary_source TEXT,
    salary_interval TEXT,
    salary_min_amount REAL,
    salary_max_amount REAL,
    salary_currency TEXT,
    is_remote INTEGER,
    job_level TEXT,
    job_function TEXT,
    listing_type TEXT,
    emails TEXT,
    company_industry TEXT,
    company_logo TEXT,
    company_url_direct TEXT,
    company_addresses TEXT,
    company_num_employees TEXT,
    company_revenue TEXT,
    company_description TEXT,
    skills TEXT,
    experience_range TEXT,
    company_rating REAL,
    company_reviews_count INTEGER,
    vacancy_count INTEGER,
    work_from_home_type TEXT,
    title TEXT NOT NULL,
    employer TEXT NOT NULL,
    employer_url TEXT,
    job_url TEXT NOT NULL UNIQUE,
    application_link TEXT,
    disciplines TEXT,
    deadline TEXT,
    salary TEXT,
    location TEXT,
    location_evidence TEXT,
    degree_required TEXT,
    starting TEXT,
    job_description TEXT,
    status TEXT NOT NULL DEFAULT 'discovered' CHECK(status IN ('discovered', 'selected', 'processing', 'ready', 'applied', 'in_progress', 'backlog', 'skipped', 'closed')),
    outcome TEXT CHECK(outcome IS NULL OR outcome IN ('rejected', 'withdrawn', 'ghosted', 'other')),
    closed_at INTEGER,
    suitability_category TEXT CHECK(suitability_category IS NULL OR suitability_category IN ('very_good_fit', 'good_fit', 'bad_fit')),
    suitability_reason TEXT,
    tailored_fields TEXT NOT NULL DEFAULT '{}',
    tailoring_matched TEXT,
    tailoring_skipped TEXT,
    cv_document_id TEXT REFERENCES cv_documents(id) ON DELETE SET NULL,
    pdf_path TEXT,
    cover_letter_draft TEXT NOT NULL DEFAULT '',
    reposted_at TEXT,
    repost_count INTEGER NOT NULL DEFAULT 0,
    discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT,
    ready_at TEXT,
    applied_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `INSERT INTO jobs_new (
    id, source, source_job_id, job_url_direct, date_posted, job_type,
    salary_source, salary_interval, salary_min_amount, salary_max_amount,
    salary_currency, is_remote, job_level, job_function, listing_type, emails,
    company_industry, company_logo, company_url_direct, company_addresses,
    company_num_employees, company_revenue, company_description, skills,
    experience_range, company_rating, company_reviews_count, vacancy_count,
    work_from_home_type, title, employer, employer_url, job_url,
    application_link, disciplines, deadline, salary, location,
    location_evidence, degree_required, starting, job_description, status,
    outcome, closed_at, suitability_category, suitability_reason, tailored_fields,
    tailoring_matched, tailoring_skipped, cv_document_id,
    pdf_path, cover_letter_draft, reposted_at, repost_count,
    discovered_at, processed_at, ready_at,
    applied_at, created_at, updated_at
  )
  SELECT
    id, source, source_job_id, job_url_direct, date_posted, job_type,
    salary_source, salary_interval, salary_min_amount, salary_max_amount,
    salary_currency, is_remote, job_level, job_function, listing_type, emails,
    company_industry, company_logo, company_url_direct, company_addresses,
    company_num_employees, company_revenue, company_description, skills,
    experience_range, company_rating, company_reviews_count, vacancy_count,
    work_from_home_type, title, employer, employer_url, job_url,
    application_link, disciplines, deadline, salary, location,
    location_evidence, degree_required, starting, job_description,
    CASE WHEN status = 'expired' THEN 'closed' ELSE status END AS status,
    CASE
      WHEN status = 'expired' AND outcome IS NULL THEN 'other'
      WHEN outcome = 'no_response' THEN 'ghosted'
      WHEN outcome IN ('offer_accepted', 'offer_declined') THEN 'other'
      ELSE outcome
    END AS outcome,
    closed_at, suitability_category, suitability_reason,
    tailored_fields,
    tailoring_matched, tailoring_skipped, cv_document_id,
    pdf_path, cover_letter_draft,
    COALESCE(reposted_at, NULL) AS reposted_at,
    COALESCE(repost_count, 0) AS repost_count,
    discovered_at, processed_at,
    ready_at, applied_at, created_at, updated_at
  FROM jobs`,
  `DROP TABLE jobs`,
  `ALTER TABLE jobs_new RENAME TO jobs`,
  `PRAGMA foreign_keys = ON`,

  // Indices.
  `CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_discovered_at ON jobs(discovered_at)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_status_discovered_at ON jobs(status, discovered_at)`,
  `CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started_at ON pipeline_runs(started_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_application_id ON tasks(application_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date)`,
  `CREATE INDEX IF NOT EXISTS idx_interviews_application_id ON interviews(application_id)`,
  `CREATE INDEX IF NOT EXISTS idx_job_notes_job_updated ON job_notes(job_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_job_chat_threads_job_updated ON job_chat_threads(job_id, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_job_chat_messages_thread_created ON job_chat_messages(thread_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_job_chat_messages_parent ON job_chat_messages(parent_message_id)`,
  `CREATE INDEX IF NOT EXISTS idx_job_chat_runs_thread_status ON job_chat_runs(thread_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_auth_sessions_revoked_at ON auth_sessions(revoked_at)`,

  // Backfill duplicate-running-runs guard rail.
  `WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY started_at DESC, id DESC) AS rank_in_thread
      FROM job_chat_runs
      WHERE status = 'running'
    )
    UPDATE job_chat_runs
    SET
      status = 'failed',
      error_code = COALESCE(error_code, 'CONFLICT'),
      error_message = COALESCE(error_message, 'Recovered duplicate running run during migration'),
      completed_at = COALESCE(completed_at, CAST(strftime('%s', 'now') AS INTEGER)),
      updated_at = datetime('now')
    WHERE id IN (SELECT id FROM ranked WHERE rank_in_thread > 1)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_job_chat_runs_thread_running_unique
   ON job_chat_runs(thread_id)
   WHERE status = 'running'`,

  // 5e CV substrate columns. Additive, idempotent via duplicate-column-name
  // skip below. The runtime path still uses flattened_tex + fields for
  // rendering until 5e.4 cuts over.
  `ALTER TABLE cv_documents ADD COLUMN templated_tex TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE cv_documents ADD COLUMN default_field_values TEXT NOT NULL DEFAULT '{}'`,
  `ALTER TABLE cv_documents ADD COLUMN last_compile_stderr TEXT`,
  `ALTER TABLE cv_documents ADD COLUMN compile_attempts INTEGER NOT NULL DEFAULT 0`,

  // 5e.3a: per-CV system prompt. The user can override the entire LLM
  // system prompt (default = the server's cv-template-extract YAML).
  // Empty value means "use the server default at extraction time".
  `ALTER TABLE cv_documents ADD COLUMN extraction_prompt TEXT NOT NULL DEFAULT ''`,

  // Drop legacy settings keys that are no longer read by the app.
  `DELETE FROM settings WHERE key IN (
     'jobspyHoursOld',
     'jobspySites',
     'jobspyLinkedinFetchDescription',
     'jobspyIsRemote',
     'openrouterApiKey',
     'webhookUrl',
     'pipelineWebhookUrl'
   )`,

];

console.log("🔧 Running database migrations...");

for (const migration of migrations) {
  try {
    sqlite.exec(migration);
    console.log("✅ Migration applied");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();

    const isAlterAdd = /alter table \S+ add column/i.test(migration);
    if (isAlterAdd && lower.includes("duplicate column name")) {
      console.log("↩️ Migration skipped (column already exists)");
      continue;
    }

    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

sqlite.close();
console.log("🎉 Database migrations complete!");
