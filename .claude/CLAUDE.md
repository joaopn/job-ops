# Project memory

Baseline instructions for any Claude session working on this repo.

## What this is

A private fork of JobOps being pivoted from a Reactive-Resume-based CV
tailoring flow to a LaTeX-native one. The fork is intentionally independent
of the upstream repo — no GHCR pulls, no upstream pings, no analytics.

If you're starting a new session, read `plan/README.md` first. It's the
only authoritative status doc and tracks the multi-session refactor across
phase files.

## Hard rules

- **Never run `npm install`, `npm ci`, `npm rebuild`, or any package manager on the host.** Everything runs containerized via `docker compose up -d --build`. The user has rejected host-side installs.
- **Never `git commit` anything.** When a commit is requested, paste the message in a fenced block and let the user commit manually. Do not run `git commit`, `git push`, or any history-modifying command.
- **Never reintroduce upstream coupling.** No links to `jobops.dakheera47.com`, `try.jobops.app`, `umami.dakheera47.com`, `ghcr.io/dakheera47/...`, `github.com/DaKheera47/...`. No telemetry, no version-polling, no GHCR images. The first post-fork commit explicitly stripped all of this.
- **Never re-add CI.** `.github/workflows/` is intentionally empty. CI is treated as untrusted attack surface.
- **`plan/` is gitignored and not part of commits.** Don't reference phase numbers in commit messages or PR descriptions. Phases exist only inside `plan/` for internal session tracking.
- **Do not invoke `ultrareview` yourself** — it's user-triggered and billed.

## Workflow defaults

- The user runs the app via `docker compose up -d --build`. Verification commands use `docker compose exec job-ops ...` or `docker compose run --rm job-ops ...`.
- Type-checking, tests, biome — only inside the container.
- When making structural changes that span many files, work in clear batches. After each batch, grep for zombie references rather than blindly continuing.
- Multi-day refactors: be honest about pacing. Mid-task is a fine place to checkpoint and ask the user how to proceed.
- Default to writing no comments. Don't create planning/decision docs (`plan/` aside) unless asked.
- Don't add features, refactors, or abstractions beyond what was requested.
- Tone: terse, no emoji unless the user uses them first.

## Stripping features (rules learned the hard way)

- The server runs through `tsx`, not pre-built JS. **Missing-module imports are fatal at boot — they are not "type errors you can defer."** Whenever you delete a service file, immediately grep `orchestrator/src/server/{api,pipeline}` for `from "@server/services/<deleted-name>"` and gut the call sites in the same pass, or the next `docker compose up` won't start.
- Pure type errors (e.g. a function still references a deleted setting key in shared types) are tolerable mid-strip — `check:types` will list them as the punch list for the next phase.
- Test files that exist purely to exercise deleted UI/services should be **deleted**, not patched. Rewriting them to fit a stub of a stub wastes effort. Note the deletion in the commit message so it's auditable.
- Settings-registry deletions cascade: registry → `shared/src/types/settings.ts` (`AppSettings`) → `shared/src/testing/factories.ts` (`createAppSettings`) → client `mapSettingsToForm` / `getDerivedSettings` / `DEFAULT_FORM_VALUES` / `NULL_SETTINGS_PAYLOAD`. Update all five spots together or types drift.

## Commit message style

When the user asks for a commit message:

- Paste it in a fenced code block. Don't execute the commit.
- **Conventional Commits** format: `<type>(<scope>)?: <subject>`. Common types in this repo: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `build`. Scope is optional but useful (e.g. `refactor(server)`, `chore(deps)`). Subject is imperative, lowercase, ≤72 chars.
- Body: bullet list of what changed, grouped by area (Removed / Added / Modified). One concept per bullet, **each bullet on a single line — never wrap to a second line**. If a bullet would exceed one line, split it into multiple bullets or shorten it.
- **No phase numbers, no references to `plan/` files** — the plan is internal scaffolding.
- No `Co-Authored-By:` trailer unless the user asks.
- No "🤖 Generated with Claude Code" footer.

## Repo facts (post-fork)

What's here:
- `orchestrator/` — Express server + React/Vite client, single workspace.
- `extractors/` — kept: `jobspy` (LinkedIn/Indeed/Glassdoor), `hiringcafe`, `workingnomads`, `startupjobs`, `golangjobs`. Stripped: `adzuna`, `gradcracker`, `ukvisajobs`, `seek`.
- `shared/` — types, settings registry, location intelligence.
- `prompts/` — (planned) user-editable YAML prompts. Bind-mounted into the container.
- `Dockerfile`, `docker-compose.yml` — single image, builds locally, no registry pull.
- `data/` — gitignored. SQLite DB + generated PDFs + JWT secret (mode 0o600).

What's been stripped (do not try to "restore" missing references — they're intentionally gone):
- All telemetry (Umami client/server, fingerprint, reverse proxy, deps).
- All CI workflows + FUNDING.yml.
- Bundled documentation site (`docs-site/`).
- Reactive Resume integration (services/rxresume, services/design-resume, DesignResumePage, design-resume client components, shared types).
- Gmail / Tracking Inbox / post-application stack.
- In-progress kanban + application stage tracking.
- Tracer links (URL rewriting + click analytics).
- Visa sponsorship.
- Demo mode.
- Conversion analytics dashboard.
- Outbound webhooks.
- DB backup system.
- Region-specific extractors above.
- `prompt-templates.ts` (will be replaced by user-editable YAML).
- RxResume-era tailoring UI (TailoringEditor, TailorMode, JobHeader, etc.).
- Third-party agent skills (`.agents/`, `.codex/`, `.opencode/`, `AGENTS.md`, `skills-lock.json`).

## Code conventions

These are the ones worth keeping from the previous `AGENTS.md`:

### API response contract

For all `/api/*` routes:
- Success: `{ ok: true, data, meta?: { requestId } }`
- Error: `{ ok: false, error: { code, message, details? }, meta: { requestId } }`

Status / code mapping:
- `400 INVALID_REQUEST`
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `404 NOT_FOUND`
- `408 REQUEST_TIMEOUT`
- `409 CONFLICT`
- `422 UNPROCESSABLE_ENTITY`
- `500 INTERNAL_ERROR`
- `502 UPSTREAM_ERROR`
- `503 SERVICE_UNAVAILABLE`

### Logging

- Use `infra/logger.ts` in core server paths. No direct `console.log/warn/error`.
- Log structured objects with context (`requestId`, `pipelineRunId`, `jobId`, `route`, `status`).
- Sanitize before logging — `infra/sanitize.ts:sanitizeUnknown` redacts `authorization` / `cookie` / `password` / `secret` / `token` / `apiKey` / `credential` keys.
- Truncate large payloads.

### SSE

- Use `orchestrator/src/server/infra/sse.ts` (server) and `orchestrator/src/client/lib/sse.ts` (client).
- Don't duplicate raw `Content-Type` / heartbeat / event-parsing plumbing.

### Correlation IDs

- Honor inbound `x-request-id`; otherwise generate one.
- Always return `x-request-id` and include it in `meta.requestId` and logs.
- Propagate into async flows so logs include `pipelineRunId` / `jobId` when available.

### Webhook + LLM payloads

- Webhooks: minimal whitelisted payloads.
- LLM prompts: only required fields. No PII unless required.
- Run payloads through `sanitize` before send.

## Tooling

- **Lint / format**: Biome (`./orchestrator/node_modules/.bin/biome` inside container).
- **Tests**: Vitest. Run `npm --workspace orchestrator run test:run` inside the container.
- **Types**: `npm --workspace orchestrator run check:types` and `npm run check:types:shared` inside the container.
- **DB**: SQLite via Drizzle. Migrations in `orchestrator/src/server/db/migrations/`. Generate with drizzle-kit.
- **LaTeX**: Tectonic, installed in the Dockerfile. Never pass `--shell-escape`.
- **LLM providers**: OpenAI / Gemini / OpenRouter / Codex / OpenAI-compatible — abstraction in `orchestrator/src/server/services/llm/`.

## Security defaults

Treat these as deferred but applicable when touching the relevant code:

- `crypto.timingSafeEqual` instead of plain `!==` on credential comparisons.
- Don't echo secrets back from `GET /api/settings` — only the `*Hint` fields.
- Rate-limit `/api/auth/login`.
- Reject `\write18`, `\immediate\write18`, abs-path or traversal `\input{` in user-supplied LaTeX before invoking Tectonic.
- JWT secret stays in `$DATA_DIR/jwt-secret` (mode 0o600).
- No keys in logs, no keys in webhook payloads, no keys in LLM prompts.

## Pivot summary (current direction)

User uploads a LaTeX CV (single `.tex` or zip with `\input{}`). Server flattens, LLM extracts into a structured `CvContent` JSON + an Eta template. Per-JD tailoring: LLM adjusts the JSON; the user's template renders deterministically through Eta + Tectonic. Per-application feedback loop: a single ghostwriter chat panel shows the tailored CV and a cover-letter draft side by side; chat can propose CV edits (accept/reject diff cards) or update the cover letter.

For details, files, schema, and per-batch checklists: read `plan/`.
