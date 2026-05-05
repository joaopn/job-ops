# Batch URL Import

## Context

You manually find job ads on boards (LinkedIn, Glassdoor, etc.) and want to drop a list of URLs into the app and have each one fetched + parsed into a `Job` row, with **live progress** as the batch runs and **clear per-URL failure detail** when something doesn't parse. The current path is single-job at a time inside the RunModeModal "Manual" tab — no batch, no streaming.

A new "Fetch URLs" button next to "Run pipeline" opens a sheet that takes a textarea of URLs, streams progress over SSE, shows a per-URL list with status + error, and auto-dismisses to a toast on full success / stays open on any failure. The existing single-URL Manual tab is **subsumed** (the new flow handles N=1 too).

**Note on tradeoff:** the Manual tab also currently supports a *paste-JD-text* path (no URL, just paste a description, LLM infers fields). Subsuming the tab drops that path. Documented here so it's an explicit decision.

## Design

### Server

**New endpoint:** `POST /api/manual-jobs/import-batch/stream` in [orchestrator/src/server/api/routes/manual-jobs.ts](orchestrator/src/server/api/routes/manual-jobs.ts)

- Request: `{ urls: string[] }`. Zod-validated: each URL trimmed, deduplicated input-side, length 1–50 (cap to bound LLM cost / DoS).
- Per URL: fetch HTML (reuse the fetch helper currently inline at `/api/manual-jobs/fetch`, lift to `services/manualJob.ts` if needed) → `inferManualJobDetails(html)` ([orchestrator/src/server/services/manualJob.ts](orchestrator/src/server/services/manualJob.ts)) → `createJob(input)` ([orchestrator/src/server/repositories/jobs.ts:523](orchestrator/src/server/repositories/jobs.ts) — single-job overload, returns existing on URL collision so duplicates are detectable by checking whether `discoveredAt < now-1s`).
- Concurrency: **3** via existing [`asyncPool`](orchestrator/src/server/utils/async-pool.ts) (LLM-bound, conservative).
- Streaming: reuse [`infra/sse.ts`](orchestrator/src/server/infra/sse.ts) (`setupSse` + `writeSseData` + `startSseHeartbeat`) and the disconnect-detection pattern from `POST /api/jobs/actions/stream` in [api/routes/jobs.ts:744](orchestrator/src/server/api/routes/jobs.ts).
- No global pipeline lock — runs independently; safe to fire while a normal pipeline run is in flight.
- Post-import scoring: gated on the new `enableJobScoring` flag (consistent with bulk pipeline behavior). When on, queue async score per imported job mirroring how `/api/manual-jobs/import` does it today.

**New event type** in [shared/src/types/pipeline.ts](shared/src/types/pipeline.ts):

```ts
type BatchUrlImportItemResult =
  | { ok: true; status: "created";   url; jobId; title; employer }
  | { ok: true; status: "duplicate"; url; jobId; title; employer }
  | { ok: false; status: "failed";   url; code; message };

type BatchUrlImportStreamEvent =
  | { type: "started";   requested; requestId }
  | { type: "progress";  result: BatchUrlImportItemResult;
                         completed; succeeded; duplicates; failed; requestId }
  | { type: "completed"; results: BatchUrlImportItemResult[];
                         succeeded; duplicates; failed; requestId }
  | { type: "error";     code; message; requestId };
```

Failure `code` mirrors `AppError` codes (`UPSTREAM_ERROR`, `REQUEST_TIMEOUT`, `INTERNAL_ERROR`, etc.) plus a new `PARSE_FAILED` for LLM-inference failure where the model returned but fields were unusable.

### Client

**New button** in [orchestrator/src/client/pages/orchestrator/OrchestratorHeader.tsx](orchestrator/src/client/pages/orchestrator/OrchestratorHeader.tsx):
- Add `onOpenBatchUrlImport: () => void` prop.
- Render a secondary `<Button variant="outline">` labelled "Fetch URLs" with a `Link` icon, immediately to the left of "Run pipeline" (same `actions` slot, hidden behind the Cancel button while a pipeline is running — keep header tight).

**New component** `orchestrator/src/client/pages/orchestrator/BatchUrlImportSheet.tsx`:
- Sheet (right side, width parallel to RunModeModal).
- Initial state: textarea "Paste job URLs (one per line)" + "Fetch jobs" submit. Counter shows N urls detected, dedup info, "X invalid" if any line isn't a URL.
- In-flight state: header with progress chip (`X/N · ✓Y · ⤴Z duplicates · ✗W failed`), then a virtualized-or-not list of per-URL rows. Each row: truncated URL, status badge (`pending` → `fetching` → `parsing` → `saved` / `duplicate` / `failed`), and on failure an inline error line (`code: message`).
- Completion behavior:
  - Zero failures → close sheet, toast "N jobs imported" (or "N imported, M duplicates").
  - Any failure → keep open, set header to red "Done with W failures", scroll to first failure. User can click the URL to copy, or click "Retry failed only" to re-submit just the failed URLs.
- Cancel: closing the sheet aborts the SSE stream (the server's heartbeat-with-disconnect-detection terminates the loop cleanly).

**API client** in [orchestrator/src/client/api.ts](orchestrator/src/client/api.ts):
- Add `streamBatchUrlImport(input: { urls: string[] }, handlers: { onEvent: (e: BatchUrlImportStreamEvent) => void })` mirroring [`streamJobAction`](orchestrator/src/client/api.ts) (uses [`subscribeToEventSource`](orchestrator/src/client/lib/sse.ts)).

**Subsume the Manual tab** in [orchestrator/src/client/pages/orchestrator/RunModeModal.tsx](orchestrator/src/client/pages/orchestrator/RunModeModal.tsx):
- Drop the `<Tabs>` wrapper; the modal becomes the AutomaticRunTab content directly. Rename header to "Run pipeline".
- Delete `orchestrator/src/client/components/ManualImportFlow.tsx` and any unused exports it owns.
- Trim `usePipelineControls.ts` `RunMode` type if it only had `automatic | manual`.
- Drop the `onManualImported` prop from RunModeModal + drop its handler in OrchestratorPage.
- The `/api/manual-jobs/{fetch,infer,import}` server endpoints become orphaned (no client caller). **Leave them in place for now** — flag in [plan/phase-9-cleanup.md](plan/phase-9-cleanup.md) as dead-weight to remove.

### Files touched

Server:
- [orchestrator/src/server/api/routes/manual-jobs.ts](orchestrator/src/server/api/routes/manual-jobs.ts) — add streaming batch endpoint
- [orchestrator/src/server/services/manualJob.ts](orchestrator/src/server/services/manualJob.ts) — possibly extract HTML-fetch helper if needed
- [shared/src/types/pipeline.ts](shared/src/types/pipeline.ts) — add `BatchUrlImportStreamEvent` types

Client:
- [orchestrator/src/client/api.ts](orchestrator/src/client/api.ts) — `streamBatchUrlImport`
- [orchestrator/src/client/pages/orchestrator/OrchestratorHeader.tsx](orchestrator/src/client/pages/orchestrator/OrchestratorHeader.tsx) — second button + prop
- [orchestrator/src/client/pages/OrchestratorPage.tsx](orchestrator/src/client/pages/OrchestratorPage.tsx) — wire `onOpenBatchUrlImport`, render sheet, `loadJobs()` after batch completes
- NEW [orchestrator/src/client/pages/orchestrator/BatchUrlImportSheet.tsx](orchestrator/src/client/pages/orchestrator/BatchUrlImportSheet.tsx)
- DELETE [orchestrator/src/client/components/ManualImportFlow.tsx](orchestrator/src/client/components/ManualImportFlow.tsx)
- [orchestrator/src/client/pages/orchestrator/RunModeModal.tsx](orchestrator/src/client/pages/orchestrator/RunModeModal.tsx) — drop Manual tab
- [orchestrator/src/client/pages/orchestrator/usePipelineControls.ts](orchestrator/src/client/pages/orchestrator/usePipelineControls.ts) — clean RunMode if narrowed

## Verification

After `docker compose up --build`:

1. **Happy path:** click "Fetch URLs" → paste 2 fresh job URLs (real LinkedIn / Indeed) → submit → sheet shows live `pending → fetching → parsing → saved` per row → on completion, sheet auto-closes, toast "2 jobs imported" → switch to Inbox tab, verify both rows present.
2. **Mixed batch:** paste 4 URLs — 1 valid, 1 already-in-DB, 1 garbage URL (404), 1 page that LLM cannot parse → sheet stays open, header shows `Done with 1–2 failures`, rows show the right status per URL with error messages.
3. **Concurrent with pipeline:** start a normal pipeline run → fire batch import → both run, no conflict, no global-lock rejection.
4. **Cancellation:** mid-batch, close the sheet → server logs a clean disconnect, in-flight LLM requests finish or abort, no orphaned heartbeats.
5. **Scoring respect:** with `enableJobScoring` off, freshly imported jobs land unscored. With it on, scores arrive shortly after.
6. **Manual tab gone:** open Run pipeline modal → only the Automatic config is visible, no tabs.

## Open knobs (defaults assumed)

- **Concurrency 3** — change in `asyncPool` call if too slow / too aggressive.
- **Max URLs per batch 50** — bound on Zod schema; lift later if needed.
- **Retry-failed button** — included in spec; trivial since failed URLs are just an array filter.
- **Paste-JD-text path retired** — drop with the Manual tab. Re-add later as a "+ paste description" affordance inside the new sheet if you miss it.
- **Old `/api/manual-jobs/{fetch,infer,import}` endpoints** — left orphaned; tracked for Phase 9 cleanup.
