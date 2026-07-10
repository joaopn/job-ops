/**
 * Restart detection for user-profile switches.
 *
 * The server exits only after the activate/new response has flushed, so an
 * early poll can still reach the dying process and get a 200 — a bare "poll
 * until healthy" would reload against the OLD server. Down-then-up instead:
 * only a success observed AFTER at least one failed poll counts as the
 * restarted server. `/health` is the target because it is auth-exempt; the
 * per-profile JWT secret makes any `/api/*` poll 401 after a switch.
 */

// Fast enough to feel instant and to never miss a multi-second node boot;
// slow enough not to spam a server mid-startup.
const POLL_INTERVAL_MS = 500;
// Comfortably covers boot + migrations on slow disks. Beyond this, "the app
// isn't coming back on its own" (e.g. dev without docker, where the exited
// process stays down) is the likelier truth — surface manual-restart copy.
const RESTART_TIMEOUT_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForServerRestart(): Promise<
  "restarted" | "timeout"
> {
  const deadline = Date.now() + RESTART_TIMEOUT_MS;
  let sawDown = false;

  while (Date.now() < deadline) {
    try {
      const response = await fetch("/health", { cache: "no-store" });
      if (response.ok && sawDown) {
        return "restarted";
      }
    } catch {
      sawDown = true;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return "timeout";
}

/** Thin wrapper so component tests can mock the reload away (jsdom cannot
 * execute a real navigation). */
export function reloadApp(): void {
  window.location.reload();
}
