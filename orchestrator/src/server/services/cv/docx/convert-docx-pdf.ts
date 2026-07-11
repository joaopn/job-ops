import { type ChildProcess, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { logger } from "@infra/logger";

// docx→PDF preview conversion through a lazy unoserver daemon (the
// run-tectonic.ts analog for the Word-CV substrate).
//
// The daemon is MANDATORY, not an optimization: a real-world CV hangs cold
// `soffice --convert-to` indefinitely yet converts through the UNO bridge in
// ~300ms (W1 spike). One instance; unoserver serializes conversions
// internally, adequate at measured latencies for the app's concurrency.
//
// Failure-class distinction (load-bearing for the startup path):
// - connection-class unoconvert failures (the daemon isn't accepting
//   connections yet) are retried while the daemon is within its startup
//   grace window — that retry loop IS the readiness probe; there is no
//   probe document (test fixtures don't exist in the production image).
// - a spawn failure of either binary (ENOENT and kin) is UNAVAILABLE
//   immediately — no amount of waiting makes a missing binary appear.
// - TIMEOUT is never grace-retried: a hung conversion can wedge the daemon
//   (W1 finding), so it kills BOTH the unoconvert client and the daemon;
//   the next conversion respawns with a fresh profile dir.

const DEFAULT_TIMEOUT_MS = 60_000;
// W1 spike: unoserver accepted its first conversion within 5–15s cold;
// 30s is the observed ceiling with headroom.
const STARTUP_GRACE_MS = 30_000;
// Each readiness probe is a full unoconvert client run (~100–300ms of
// Python startup), so probing much faster than this buys nothing.
const STARTUP_RETRY_INTERVAL_MS = 500;
// Enough for a full Python traceback while bounding memory on a daemon
// that lives for the server's lifetime.
const DAEMON_STDERR_TAIL_MAX = 8_192;
const UNOSERVER_HOST = "127.0.0.1";

// unoconvert is a Python UNO-bridge client: before the daemon accepts
// connections it dies with com.sun.star.connection.NoConnectException
// ("Connector : couldn't connect to socket"); plain socket refusals surface
// as "Connection refused"/ECONNREFUSED.
const CONNECTION_FAILURE_PATTERN =
  /ECONNREFUSED|ECONNRESET|Connection refused|Connection reset|NoConnectException|couldn'?t connect/i;

// Belt-and-braces only: parse-docx.ts already hard-rejects macro-bearing
// packages before anything reaches LibreOffice, and LibreOffice silently
// ignores a malformed xcu — do not treat this file as verified hardening.
// MacroSecurityLevel is on a 0–3 scale; 3 = Very High.
const MACRO_SECURITY_XCU = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
</oor:items>
`;

export type ConvertDocxErrorCode = "UNAVAILABLE" | "TIMEOUT" | "CONVERT_FAILED";

export class ConvertDocxError extends Error {
  readonly code: ConvertDocxErrorCode;
  readonly stderr: string;
  constructor(message: string, code: ConvertDocxErrorCode, stderr: string) {
    super(message);
    this.name = "ConvertDocxError";
    this.code = code;
    this.stderr = stderr;
  }
}

export interface ConvertDocxArgs {
  docx: Uint8Array;
  /** Timeout in ms for the conversion itself. Default: 60_000. */
  timeoutMs?: number;
}

interface UnoserverDaemon {
  child: ChildProcess;
  profileDir: string;
  spawnedAt: number;
  stderrTail: string;
  exited: boolean;
  stopping: boolean;
}

let daemonPromise: Promise<UnoserverDaemon> | null = null;
let activeDaemon: UnoserverDaemon | null = null;
let exitHookInstalled = false;

export async function convertDocxToPdf(
  args: ConvertDocxArgs,
): Promise<Uint8Array> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "cv-unoconvert-"));
  try {
    const inputPath = path.join(tempDir, "in.docx");
    const outputPath = path.join(tempDir, "out.pdf");
    await fs.writeFile(inputPath, args.docx);
    const stderr = await convertWithRetry(inputPath, outputPath, timeoutMs);
    let pdf: Buffer;
    try {
      pdf = await fs.readFile(outputPath);
    } catch {
      throw new ConvertDocxError(
        "unoconvert exited 0 but produced no output file.",
        "CONVERT_FAILED",
        stderr,
      );
    }
    return new Uint8Array(pdf);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

/** Kills the daemon (if running) and removes its profile dir. Idempotent. */
export async function stopUnoserver(): Promise<void> {
  const pending = daemonPromise;
  daemonPromise = null;
  if (!pending) return;
  let daemon: UnoserverDaemon;
  try {
    daemon = await pending;
  } catch {
    return;
  }
  daemon.stopping = true;
  if (activeDaemon === daemon) activeDaemon = null;
  if (!daemon.exited) daemon.child.kill("SIGKILL");
  logger.info("unoserver daemon stopped", { pid: daemon.child.pid });
  await removeProfileDir(daemon.profileDir);
}

/** The running daemon's PID, or null. Exposed for the warm-reuse test. */
export function getUnoserverPid(): number | null {
  return activeDaemon?.child.pid ?? null;
}

async function convertWithRetry(
  inputPath: string,
  outputPath: string,
  timeoutMs: number,
): Promise<string> {
  // Pin one daemon generation per conversion call: a daemon that dies under
  // us fails THIS call (typed), and the next call respawns fresh — no
  // unbounded respawn loop inside a single conversion.
  const daemon = await ensureDaemon();
  for (;;) {
    try {
      return await runUnoconvert(inputPath, outputPath, timeoutMs);
    } catch (err) {
      if (!(err instanceof UnoconvertFailure)) throw err;
      if (err.kind === "spawn") {
        throw new ConvertDocxError(
          `Failed to spawn unoconvert: ${err.message}`,
          "UNAVAILABLE",
          err.stderr,
        );
      }
      if (err.kind === "timeout") {
        await killDaemon(daemon, "conversion timeout");
        throw new ConvertDocxError(
          `docx to PDF conversion timed out after ${timeoutMs} ms.`,
          "TIMEOUT",
          err.stderr,
        );
      }
      if (CONNECTION_FAILURE_PATTERN.test(err.stderr)) {
        if (daemon.exited) {
          throw new ConvertDocxError(
            "unoserver daemon exited before accepting the conversion.",
            "UNAVAILABLE",
            daemon.stderrTail || err.stderr,
          );
        }
        if (Date.now() - daemon.spawnedAt < STARTUP_GRACE_MS) {
          await sleep(STARTUP_RETRY_INTERVAL_MS);
          continue;
        }
        // Alive but refusing connections past the grace window: a wedged
        // daemon would otherwise fail every future call — kill it so the
        // next conversion self-heals with a fresh spawn.
        await killDaemon(daemon, "never became ready");
        throw new ConvertDocxError(
          `unoserver did not accept connections within ${STARTUP_GRACE_MS} ms.`,
          "UNAVAILABLE",
          daemon.stderrTail || err.stderr,
        );
      }
      throw new ConvertDocxError(
        `unoconvert exited with code ${err.exitCode}.`,
        "CONVERT_FAILED",
        err.stderr,
      );
    }
  }
}

function ensureDaemon(): Promise<UnoserverDaemon> {
  if (!daemonPromise) {
    daemonPromise = spawnDaemon().catch((err) => {
      daemonPromise = null;
      throw err;
    });
  }
  return daemonPromise;
}

async function spawnDaemon(): Promise<UnoserverDaemon> {
  const profileDir = await fs.mkdtemp(path.join(tmpdir(), "cv-unoserver-"));
  await writeMacroSecurityProfile(profileDir);
  const bin = process.env.UNOSERVER_BIN ?? "unoserver";
  const child = spawn(
    bin,
    ["--interface", UNOSERVER_HOST, "--user-installation", profileDir],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const daemon: UnoserverDaemon = {
    child,
    profileDir,
    spawnedAt: Date.now(),
    stderrTail: "",
    exited: false,
    stopping: false,
  };
  child.stderr?.on("data", (chunk: Buffer) => {
    daemon.stderrTail = (daemon.stderrTail + chunk.toString("utf8")).slice(
      -DAEMON_STDERR_TAIL_MAX,
    );
  });
  child.on("exit", (code, signal) => {
    daemon.exited = true;
    if (activeDaemon === daemon) {
      activeDaemon = null;
      daemonPromise = null;
    }
    if (!daemon.stopping) {
      logger.warn("unoserver daemon exited unexpectedly", {
        code,
        signal,
        stderr: daemon.stderrTail,
      });
    }
    void removeProfileDir(profileDir);
  });
  await new Promise<void>((resolve, reject) => {
    const onSpawn = () => {
      child.off("error", onError);
      resolve();
    };
    const onError = (err: Error) => {
      child.off("spawn", onSpawn);
      void removeProfileDir(profileDir);
      reject(
        new ConvertDocxError(
          `Failed to spawn unoserver (${bin}): ${err.message}`,
          "UNAVAILABLE",
          daemon.stderrTail,
        ),
      );
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
  child.on("error", (err) => {
    logger.warn("unoserver daemon error", { message: err.message });
  });
  activeDaemon = daemon;
  installExitHook();
  // Don't let the daemon handle keep an otherwise-empty event loop alive
  // (vitest workers); the exit hook still reaps it on process exit.
  child.unref();
  (child.stderr as Socket | null)?.unref();
  logger.info("unoserver daemon spawned", { pid: child.pid, profileDir });
  return daemon;
}

async function killDaemon(
  daemon: UnoserverDaemon,
  reason: string,
): Promise<void> {
  daemon.stopping = true;
  if (activeDaemon === daemon) {
    activeDaemon = null;
    daemonPromise = null;
  }
  logger.warn("killing unoserver daemon", { pid: daemon.child.pid, reason });
  if (!daemon.exited) daemon.child.kill("SIGKILL");
  await removeProfileDir(daemon.profileDir);
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    activeDaemon?.child.kill("SIGKILL");
  });
}

// The kill paths and the child's own exit handler can both reach for the
// same profile dir; a lost fs race here must never replace a typed error
// or surface as an unhandled rejection.
function removeProfileDir(profileDir: string): Promise<void> {
  return fs
    .rm(profileDir, { recursive: true, force: true })
    .catch(() => undefined);
}

async function writeMacroSecurityProfile(profileDir: string): Promise<void> {
  const userDir = path.join(profileDir, "user");
  await fs.mkdir(userDir, { recursive: true });
  await fs.writeFile(
    path.join(userDir, "registrymodifications.xcu"),
    MACRO_SECURITY_XCU,
    "utf8",
  );
}

type UnoconvertFailureKind = "spawn" | "timeout" | "exit";

class UnoconvertFailure extends Error {
  readonly kind: UnoconvertFailureKind;
  readonly stderr: string;
  readonly exitCode: number | null;
  constructor(
    kind: UnoconvertFailureKind,
    message: string,
    stderr: string,
    exitCode: number | null,
  ) {
    super(message);
    this.name = "UnoconvertFailure";
    this.kind = kind;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

function runUnoconvert(
  inputPath: string,
  outputPath: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const bin = process.env.UNOCONVERT_BIN ?? "unoconvert";
    const child = spawn(
      bin,
      ["--host", UNOSERVER_HOST, "--convert-to", "pdf", inputPath, outputPath],
      { stdio: ["ignore", "ignore", "pipe"] },
    );

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new UnoconvertFailure(
          "timeout",
          `unoconvert timed out after ${timeoutMs} ms.`,
          stderr,
          null,
        ),
      );
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new UnoconvertFailure("spawn", err.message, stderr, null));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stderr);
        return;
      }
      reject(
        new UnoconvertFailure(
          "exit",
          `unoconvert exited with code ${code}.`,
          stderr,
          code,
        ),
      );
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
