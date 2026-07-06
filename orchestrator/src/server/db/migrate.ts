/**
 * Database migration script - creates tables if they don't exist
 * and brings legacy schemas up to the current shape.
 */

import { randomUUID } from "node:crypto";
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

  // Cover-letter substrate. Mirrors cv_documents' shape (post-5e); the upload
  // pipeline reuses the same flatten → compile → extract-loop machinery.
  // No personal_brief column — that lives on the CV side and is fed into
  // the cover-letter generate prompt at request time.
  `CREATE TABLE IF NOT EXISTS cover_letter_documents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    original_archive BLOB NOT NULL,
    flattened_tex TEXT NOT NULL,
    fields TEXT NOT NULL DEFAULT '[]',
    templated_tex TEXT NOT NULL DEFAULT '',
    default_field_values TEXT NOT NULL DEFAULT '{}',
    last_compile_stderr TEXT,
    compile_attempts INTEGER NOT NULL DEFAULT 0,
    extraction_prompt TEXT NOT NULL DEFAULT '',
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
    interview_prep TEXT NOT NULL DEFAULT '',
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

  // Phase 5d dropped the legacy LLM-generated `template` / `content` columns
  // on cv_documents (replaced by per-field `fields`). That rebuild used to
  // live here in the SQL array and ran UNCONDITIONALLY every boot — but the
  // rebuilt table only listed the pre-5e columns, so it silently dropped the
  // 5e columns (`templated_tex`, `default_field_values`, `last_compile_stderr`,
  // `compile_attempts`, `extraction_prompt`), and the additive ALTERs further
  // down then re-added them with empty defaults. Net effect: every reboot
  // wiped `templated_tex`, flipping every CV back to "Older CV format" and
  // demanding a re-extract. The rebuild now lives in a guarded JS block near
  // the bottom of this file that only fires when the legacy columns actually
  // still exist, and carries the full current shape forward.
  //
  // This defensive ALTER stays: legacy DBs predating `fields` need the column
  // before the guarded rebuild's SELECT can reference it. Idempotent via the
  // duplicate-column skip.
  `ALTER TABLE cv_documents ADD COLUMN fields TEXT NOT NULL DEFAULT '[]'`,

  // 5g repost-tracking columns. Additive, idempotent via duplicate-column
  // skip below. Has to run BEFORE the rebuild block — the rebuild's
  // INSERT SELECT references `reposted_at` / `repost_count` from `jobs`, so
  // legacy DBs without those columns would otherwise fail the SELECT.
  `ALTER TABLE jobs ADD COLUMN reposted_at TEXT`,
  `ALTER TABLE jobs ADD COLUMN repost_count INTEGER NOT NULL DEFAULT 0`,

  // Cover-letter columns. Same defensive-ALTER pattern as 5g — must run
  // BEFORE the rebuild block so the INSERT SELECT can reference them.
  // Idempotent via the duplicate-column-name skip below.
  `ALTER TABLE jobs ADD COLUMN cover_letter_document_id TEXT REFERENCES cover_letter_documents(id) ON DELETE SET NULL`,
  `ALTER TABLE jobs ADD COLUMN cover_letter_field_overrides TEXT NOT NULL DEFAULT '{}'`,
  `ALTER TABLE jobs ADD COLUMN cover_letter_pdf_path TEXT`,

  // 5i: per-job CV field locks (JSON array of fieldIds the LLM tailoring
  // and chat accept-edit paths must leave alone). Defensive ALTER before
  // the canonical rebuild so the INSERT SELECT can reference it on legacy
  // DBs. Idempotent via the duplicate-column-name skip below.
  `ALTER TABLE jobs ADD COLUMN cv_field_locks TEXT NOT NULL DEFAULT '[]'`,

  // Interview QA: per-job, user-generated interview strategy (freeform
  // markdown). Same defensive-ALTER-before-rebuild pattern — the rebuild's
  // INSERT SELECT references `interview_prep` from `jobs`, so legacy DBs
  // need the column first. Idempotent via the duplicate-column-name skip.
  `ALTER TABLE jobs ADD COLUMN interview_prep TEXT NOT NULL DEFAULT ''`,

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
    status TEXT NOT NULL DEFAULT 'discovered' CHECK(status IN ('discovered', 'selected', 'processing', 'ready', 'applied', 'in_progress', 'backlog', 'stale', 'skipped', 'closed')),
    outcome TEXT CHECK(outcome IS NULL OR outcome IN ('rejected', 'withdrawn', 'ghosted', 'duplicated', 'other')),
    closed_at INTEGER,
    suitability_category TEXT CHECK(suitability_category IS NULL OR suitability_category IN ('very_good_fit', 'good_fit', 'bad_fit')),
    suitability_reason TEXT,
    tailored_fields TEXT NOT NULL DEFAULT '{}',
    cv_field_locks TEXT NOT NULL DEFAULT '[]',
    tailoring_matched TEXT,
    tailoring_skipped TEXT,
    cv_document_id TEXT REFERENCES cv_documents(id) ON DELETE SET NULL,
    pdf_path TEXT,
    cover_letter_draft TEXT NOT NULL DEFAULT '',
    cover_letter_document_id TEXT REFERENCES cover_letter_documents(id) ON DELETE SET NULL,
    cover_letter_field_overrides TEXT NOT NULL DEFAULT '{}',
    cover_letter_pdf_path TEXT,
    interview_prep TEXT NOT NULL DEFAULT '',
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
    cv_field_locks,
    tailoring_matched, tailoring_skipped, cv_document_id,
    pdf_path, cover_letter_draft,
    cover_letter_document_id, cover_letter_field_overrides, cover_letter_pdf_path,
    interview_prep,
    reposted_at, repost_count,
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
    COALESCE(cv_field_locks, '[]') AS cv_field_locks,
    tailoring_matched, tailoring_skipped, cv_document_id,
    pdf_path, cover_letter_draft,
    cover_letter_document_id,
    COALESCE(cover_letter_field_overrides, '{}') AS cover_letter_field_overrides,
    cover_letter_pdf_path,
    COALESCE(interview_prep, '') AS interview_prep,
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

  // Tailoring failure reason. Set on any failed processJob, cleared on the
  // next successful summarizeJob. Nullable; null = "no recorded failure".
  `ALTER TABLE jobs ADD COLUMN tailoring_failure_reason TEXT`,

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

  // Per-extractor configuration. One row per *extractor* (manifest.id):
  // jobspy / hiringcafe / startupjobs / workingnomads. The
  // original phase-10 schema keyed on `source_id` (per-platform: indeed /
  // linkedin / glassdoor / hiringcafe / ...). The collapse from per-platform
  // to per-extractor happens in the JS-driven rebuild below — it merges
  // legacy per-platform rows into per-extractor rows, picking the
  // first-priority config row and OR'ing the `enabled` flag across each
  // extractor's sub-platforms. Per CLAUDE.md's "one canonical rebuild only"
  // rule, this CREATE TABLE IF NOT EXISTS now declares the post-rename
  // shape directly — no parallel rebuild block appended.
  `CREATE TABLE IF NOT EXISTS source_configs (
     extractor_id TEXT PRIMARY KEY,
     enabled INTEGER NOT NULL DEFAULT 0,
     config_json TEXT NOT NULL DEFAULT '{}',
     mappings_json TEXT NOT NULL DEFAULT '{}',
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,

  // User-managed instances of marketplace-provider actors (Apify today,
  // extensible to other providers). Each row is one configured actor; the
  // pipeline iterates enabled rows alongside built-in extractor manifests.
  `CREATE TABLE IF NOT EXISTS provider_instances (
     id TEXT PRIMARY KEY,
     provider_id TEXT NOT NULL,
     actor_ref TEXT NOT NULL,
     label TEXT NOT NULL,
     template_id TEXT,
     enabled INTEGER NOT NULL DEFAULT 0,
     input_template_json TEXT NOT NULL,
     output_mapping_json TEXT NOT NULL DEFAULT '{}',
     mappings_json TEXT NOT NULL DEFAULT '{}',
     max_jobs INTEGER,
     max_age_days INTEGER,
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_provider_instances_provider
     ON provider_instances(provider_id)`,
  // Additive: existing DBs predate max_jobs (skipped on dup-column, see loop).
  `ALTER TABLE provider_instances ADD COLUMN max_jobs INTEGER`,
  // Additive: existing DBs predate max_age_days (skipped on dup-column).
  `ALTER TABLE provider_instances ADD COLUMN max_age_days INTEGER`,

  // Profiles: named, selectable scrape sets (location + terms + run knobs +
  // pinned sources) that become the runtime source of truth for a run. One
  // JSON config blob per row, UUID PK — mirrors provider_instances. No
  // rebuild block per the "one canonical rebuild only" rule; the first-boot
  // seed of a "Default" profile lives in the guarded JS block near the
  // bottom of this file (after the SQL array, so later ALTERs exist).
  `CREATE TABLE IF NOT EXISTS profiles (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     config_json TEXT NOT NULL DEFAULT '{}',
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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

// Source-configs migration + backfill.
//
// Two scenarios funnel through here:
//
// 1. Legacy per-platform shape (`source_id` PK, one row per platform —
//    indeed / linkedin / glassdoor / hiringcafe / ...). Phase 10b collapse
//    folds those into per-extractor rows (manifest.id): jobspy carries
//    Indeed + LinkedIn + Glassdoor; everything else is 1:1. First-priority
//    platform's config wins; `enabled` is OR'd across sub-platforms; the
//    legacy `location_override` config key is renamed to `searchCities`
//    in-place (matches the field rename in the extractor manifests).
//
// 2. Fresh DB or already-migrated. SQL migrations created the
//    `extractor_id`-shaped table already; this block backfills one row per
//    pipeline extractor with default enabled=1 and any pre-Phase-10 legacy
//    AppSettings keys folded in. Idempotent via INSERT OR IGNORE.
try {
  const PLATFORM_TO_EXTRACTOR: Record<string, string> = {
    indeed: "jobspy",
    linkedin: "jobspy",
    glassdoor: "jobspy",
    hiringcafe: "hiringcafe",
    workingnomads: "workingnomads",
    startupjobs: "startupjobs",
    manual: "manual",
  };
  // Mirrors EXTRACTOR_SOURCE_METADATA[*].order in shared/extractors. Inlined
  // here so migrate.ts doesn't need to import shared TS at boot. The
  // first-priority platform's config wins when collapsing per-extractor.
  const PLATFORM_ORDER: Record<string, number> = {
    indeed: 20,
    linkedin: 30,
    glassdoor: 40,
    hiringcafe: 70,
    startupjobs: 80,
    workingnomads: 90,
    manual: 110,
  };
  const PIPELINE_EXTRACTOR_IDS = [
    "jobspy",
    "hiringcafe",
    "startupjobs",
    "workingnomads",
  ];

  const tableCols = sqlite
    .prepare("PRAGMA table_info(source_configs)")
    .all() as Array<{ name: string }>;
  const colNames = new Set(tableCols.map((c) => c.name));
  const isLegacyShape =
    colNames.has("source_id") && !colNames.has("extractor_id");

  const remapLegacyConfigKey = (raw: string): string => {
    if (!raw) return "{}";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return "{}";
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "{}";
    }
    if (
      typeof parsed.location_override === "string" &&
      parsed.searchCities === undefined
    ) {
      parsed.searchCities = parsed.location_override;
    }
    delete parsed.location_override;
    return JSON.stringify(parsed);
  };

  if (isLegacyShape) {
    const legacyRows = sqlite
      .prepare(
        `SELECT source_id, enabled, config_json, mappings_json, updated_at
         FROM source_configs`,
      )
      .all() as Array<{
      source_id: string;
      enabled: number;
      config_json: string;
      mappings_json: string;
      updated_at: string;
    }>;

    legacyRows.sort(
      (a, b) =>
        (PLATFORM_ORDER[a.source_id] ?? 9999) -
        (PLATFORM_ORDER[b.source_id] ?? 9999),
    );

    type Aggregated = {
      config_json: string;
      mappings_json: string;
      enabled: number;
      updated_at: string;
    };
    const merged = new Map<string, Aggregated>();
    for (const row of legacyRows) {
      const extractorId = PLATFORM_TO_EXTRACTOR[row.source_id];
      if (!extractorId) continue;
      const existing = merged.get(extractorId);
      if (!existing) {
        merged.set(extractorId, {
          config_json: remapLegacyConfigKey(row.config_json),
          mappings_json: row.mappings_json || "{}",
          enabled: row.enabled ? 1 : 0,
          updated_at: row.updated_at,
        });
      } else {
        existing.enabled = existing.enabled || row.enabled ? 1 : 0;
      }
    }

    sqlite.exec("DROP TABLE IF EXISTS source_configs_new");
    sqlite.exec(
      `CREATE TABLE source_configs_new (
         extractor_id TEXT PRIMARY KEY,
         enabled INTEGER NOT NULL DEFAULT 0,
         config_json TEXT NOT NULL DEFAULT '{}',
         mappings_json TEXT NOT NULL DEFAULT '{}',
         updated_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    );
    const insertNew = sqlite.prepare(
      `INSERT INTO source_configs_new
         (extractor_id, enabled, config_json, mappings_json, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const [extractorId, row] of merged) {
      insertNew.run(
        extractorId,
        row.enabled,
        row.config_json,
        row.mappings_json,
        row.updated_at,
      );
    }
    sqlite.exec("DROP TABLE source_configs");
    sqlite.exec("ALTER TABLE source_configs_new RENAME TO source_configs");
    console.log(
      "✅ source_configs collapsed per-platform → per-extractor",
    );
  }

  const getSetting = sqlite.prepare(
    "SELECT value FROM settings WHERE key = ?",
  );
  const readSetting = (key: string): string | null => {
    const row = getSetting.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  };

  const sharedMaxPerTerm = readSetting("jobspyResultsWanted");
  const jobspyCountryIndeed = readSetting("jobspyCountryIndeed");
  const jobspyLocation = readSetting("jobspyLocation");
  const searchCities = readSetting("searchCities");
  const startupjobsMaxJobsPerTerm = readSetting("startupjobsMaxJobsPerTerm");

  const insertRow = sqlite.prepare(
    `INSERT OR IGNORE INTO source_configs
       (extractor_id, enabled, config_json, mappings_json, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  );

  for (const extractorId of PIPELINE_EXTRACTOR_IDS) {
    const config: Record<string, string> = {};
    if (sharedMaxPerTerm) config.max_jobs_per_term = sharedMaxPerTerm;
    if (extractorId === "jobspy") {
      if (jobspyCountryIndeed) config.country_indeed = jobspyCountryIndeed;
      if (jobspyLocation && jobspyLocation !== searchCities) {
        config.searchCities = jobspyLocation;
      }
    }
    if (extractorId === "startupjobs" && startupjobsMaxJobsPerTerm) {
      config.max_jobs_per_term = startupjobsMaxJobsPerTerm;
    }
    insertRow.run(extractorId, 1, JSON.stringify(config), "{}");
  }
  console.log("✅ source_configs backfill applied");

  // Rename jobspyCountryIndeed → searchCountry, then drop the four legacy
  // settings keys. Must run AFTER the source_configs backfill above, which
  // reads these keys; running it as part of the SQL `migrations[]` array
  // would fire before the JS backfill and clobber the values.
  if (jobspyCountryIndeed) {
    const existingSearchCountry = readSetting("searchCountry");
    if (!existingSearchCountry) {
      const insertSetting = sqlite.prepare(
        `INSERT INTO settings (key, value, created_at, updated_at)
         VALUES (?, ?, datetime('now'), datetime('now'))`,
      );
      insertSetting.run("searchCountry", jobspyCountryIndeed);
    }
  }

  sqlite
    .prepare(
      `DELETE FROM settings WHERE key IN (
         'jobspyResultsWanted',
         'jobspyCountryIndeed',
         'jobspyLocation',
         'startupjobsMaxJobsPerTerm'
       )`,
    )
    .run();
  console.log("✅ legacy settings keys dropped");

  // Drop the golangjobs extractor. Idempotent — re-runs are no-ops once
  // the rows are gone. The jobs delete cascades to dependent rows via
  // the existing ON DELETE CASCADE on tasks / interviews / job_notes /
  // job_chat_*.
  const removedSourceConfig = sqlite
    .prepare(`DELETE FROM source_configs WHERE extractor_id = 'golangjobs'`)
    .run();
  const removedJobs = sqlite
    .prepare(`DELETE FROM jobs WHERE source = 'golangjobs'`)
    .run();
  if (removedSourceConfig.changes > 0 || removedJobs.changes > 0) {
    console.log(
      `✅ golangjobs dropped (source_configs rows: ${removedSourceConfig.changes}, jobs rows: ${removedJobs.changes})`,
    );
  }
} catch (error) {
  console.error("❌ source_configs backfill failed:", error);
  process.exit(1);
}

// Phase 5d legacy-column drop on cv_documents — guarded.
//
// Only rebuilds when the legacy `template` / `content` columns are still
// present (a pre-5d DB). Once they're gone the block no-ops forever, so it
// can never clobber columns added by later ALTERs. The rebuild carries the
// FULL current shape forward (including the 5e columns), which is why it has
// to run here, AFTER the SQL `migrations[]` array has ensured those columns
// exist — selecting them in the array would fail on legacy DBs.
try {
  const cvCols = sqlite
    .prepare("PRAGMA table_info(cv_documents)")
    .all() as Array<{ name: string }>;
  const cvColNames = new Set(cvCols.map((c) => c.name));
  const hasLegacyCvColumns =
    cvColNames.has("template") || cvColNames.has("content");

  if (hasLegacyCvColumns) {
    sqlite.exec("PRAGMA foreign_keys = OFF");
    sqlite.exec("DROP TABLE IF EXISTS cv_documents_new");
    sqlite.exec(`CREATE TABLE cv_documents_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      original_archive BLOB NOT NULL,
      flattened_tex TEXT NOT NULL,
      fields TEXT NOT NULL DEFAULT '[]',
      personal_brief TEXT NOT NULL DEFAULT '',
      templated_tex TEXT NOT NULL DEFAULT '',
      default_field_values TEXT NOT NULL DEFAULT '{}',
      last_compile_stderr TEXT,
      compile_attempts INTEGER NOT NULL DEFAULT 0,
      extraction_prompt TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    sqlite.exec(`INSERT INTO cv_documents_new (
      id, name, original_archive, flattened_tex, fields, personal_brief,
      templated_tex, default_field_values, last_compile_stderr,
      compile_attempts, extraction_prompt, created_at, updated_at
    )
    SELECT
      id, name, original_archive, flattened_tex, fields, personal_brief,
      templated_tex, default_field_values, last_compile_stderr,
      compile_attempts, extraction_prompt, created_at, updated_at
    FROM cv_documents`);
    sqlite.exec("DROP TABLE cv_documents");
    sqlite.exec("ALTER TABLE cv_documents_new RENAME TO cv_documents");
    sqlite.exec("PRAGMA foreign_keys = ON");
    console.log("✅ cv_documents legacy template/content columns dropped");
  }
} catch (error) {
  console.error("❌ cv_documents legacy-column rebuild failed:", error);
  process.exit(1);
}

// Seed a "Default" profile from the current effective scrape settings —
// guarded + empty-only.
//
// Runs ONLY when `profiles` is empty, so it can never overwrite a
// user-created profile or re-run per boot (the cv_documents per-boot-wipe
// lesson). Lives here, after the SQL `migrations[]` array, so the
// source_configs / provider_instances backfills above have already populated
// the rows this reads. Values are inlined (no @shared import at boot),
// matching `defaultProfileConfig()` field-for-field; a bad/missing setting
// falls back to the same default the shared parser would use on read.
try {
  const profileCount = (
    sqlite.prepare("SELECT COUNT(*) AS n FROM profiles").get() as { n: number }
  ).n;

  if (profileCount === 0) {
    const readSetting = (key: string): string | null => {
      const row = sqlite
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get(key) as { value: string } | undefined;
      return row?.value ?? null;
    };
    const parseStringArray = (raw: string | null): string[] => {
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
          ? parsed.filter((v): v is string => typeof v === "string")
          : [];
      } catch {
        return [];
      }
    };
    const parseIntOrNull = (raw: string | null): number | null => {
      if (!raw) return null;
      const parsed = parseInt(raw, 10);
      return Number.isNaN(parsed) ? null : parsed;
    };

    const enabledSourceIds = (
      sqlite
        .prepare("SELECT extractor_id FROM source_configs WHERE enabled = 1")
        .all() as Array<{ extractor_id: string }>
    ).map((r) => r.extractor_id);
    const providerInstanceIds = (
      sqlite
        .prepare("SELECT id FROM provider_instances WHERE enabled = 1")
        .all() as Array<{ id: string }>
    ).map((r) => r.id);

    const workplaceTypes = parseStringArray(readSetting("workplaceTypes"));

    const config = {
      searchTerms: parseStringArray(readSetting("searchTerms")),
      searchCountry: readSetting("searchCountry") ?? "",
      searchCities: readSetting("searchCities") ?? "",
      workplaceTypes:
        workplaceTypes.length > 0
          ? workplaceTypes
          : ["remote", "hybrid", "onsite"],
      locationSearchScope: readSetting("locationSearchScope") ?? "selected_only",
      locationMatchStrictness:
        readSetting("locationMatchStrictness") ?? "exact_only",
      scrapeMaxAgeDays: parseIntOrNull(readSetting("scrapeMaxAgeDays")),
      blockedCompanyKeywords: parseStringArray(
        readSetting("blockedCompanyKeywords"),
      ),
      runBudget: 500,
      topN: 10,
      minSuitabilityCategory: readSetting("minSuitabilityCategory") ?? "good_fit",
      enabledSourceIds,
      providerInstanceIds,
    };

    const id = randomUUID();
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO profiles (id, name, config_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, "Default", JSON.stringify(config), now, now);

    // Point defaultProfileId at the seed unless one is already set.
    if (!readSetting("defaultProfileId")) {
      sqlite
        .prepare(
          `INSERT INTO settings (key, value, created_at, updated_at)
           VALUES (?, ?, datetime('now'), datetime('now'))
           ON CONFLICT(key) DO UPDATE SET
             value = excluded.value, updated_at = datetime('now')`,
        )
        .run("defaultProfileId", id);
    }
    console.log("✅ seeded Default profile from current settings");
  }
} catch (error) {
  console.error("❌ profiles seed failed:", error);
  process.exit(1);
}

sqlite.close();
console.log("🎉 Database migrations complete!");
