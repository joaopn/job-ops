import { spawn } from "node:child_process";

const PDFTOTEXT_BIN = process.env.PDFTOTEXT_BIN ?? "pdftotext";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_DIFF_CHARS = 2000;

export class PdftotextDiffError extends Error {
  readonly code: string;
  readonly stderr?: string;
  constructor(message: string, code: string, stderr?: string) {
    super(message);
    this.name = "PdftotextDiffError";
    this.code = code;
    this.stderr = stderr;
  }
}

export interface PdftotextDiffArgs {
  original: Uint8Array;
  candidate: Uint8Array;
  /** Timeout per pdftotext invocation in ms. Default: 15_000. */
  timeoutMs?: number;
}

export interface PdftotextDiffResult {
  ok: boolean;
  /**
   * Unified-format diff between the normalised text of `original` and
   * `candidate`, capped at ~`MAX_DIFF_CHARS`. Empty string when `ok`.
   */
  diff: string;
  /** Number of differing lines (after normalisation). 0 when `ok`. */
  divergentLines: number;
}

/**
 * 5e content-equivalence gate. Extracts text from both PDFs via
 * `pdftotext -layout`, normalises whitespace per line, and compares.
 * Strict: any diff after normalisation = `ok: false`.
 *
 * Threshold can be loosened later (Levenshtein ratio etc.) but starts
 * strict; loosening is cheaper than tightening once a gate has shipped.
 *
 * The poppler `pdftotext` binary is installed in the runtime image (see
 * Dockerfile). Tests bind-mount the host source into the same image, so
 * the binary is available there too.
 */
export async function pdftotextDiff(
  args: PdftotextDiffArgs,
): Promise<PdftotextDiffResult> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const [originalText, candidateText] = await Promise.all([
    runPdftotext(args.original, timeoutMs),
    runPdftotext(args.candidate, timeoutMs),
  ]);

  return comparePdftotextOutput(originalText, candidateText);
}

/**
 * Pure comparison: normalise both inputs the same way `pdftotextDiff`
 * does and report content equivalence. Exported for unit tests that
 * shouldn't pay for a real `pdftotext` invocation.
 */
export function comparePdftotextOutput(
  originalText: string,
  candidateText: string,
): PdftotextDiffResult {
  const originalLines = normalise(originalText);
  const candidateLines = normalise(candidateText);

  if (linesEqual(originalLines, candidateLines)) {
    return { ok: true, diff: "", divergentLines: 0 };
  }

  const diff = unifiedDiff(originalLines, candidateLines);
  const truncated =
    diff.length > MAX_DIFF_CHARS
      ? `${diff.slice(0, MAX_DIFF_CHARS)}\n…(truncated)`
      : diff;

  return {
    ok: false,
    diff: truncated,
    divergentLines: countDivergentLines(originalLines, candidateLines),
  };
}

function normalise(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

function linesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function countDivergentLines(a: string[], b: string[]): number {
  const aSet = new Set(a);
  const bSet = new Set(b);
  let count = 0;
  for (const line of a) if (!bSet.has(line)) count++;
  for (const line of b) if (!aSet.has(line)) count++;
  return count;
}

/**
 * Minimal unified-style diff. Not a real LCS — just emits "- line" /
 * "+ line" pairs for lines that differ at matching indices, plus
 * leading/trailing additions or deletions when lengths differ. Good
 * enough for surfacing 1–10 line divergences in a UI; not a substitute
 * for `diff(1)` on large changes.
 */
function unifiedDiff(a: string[], b: string[]): string {
  const lines: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const left = a[i];
    const right = b[i];
    if (left === right) continue;
    if (left !== undefined) lines.push(`- ${left}`);
    if (right !== undefined) lines.push(`+ ${right}`);
  }
  return lines.join("\n");
}

function runPdftotext(pdf: Uint8Array, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      PDFTOTEXT_BIN,
      ["-layout", "-enc", "UTF-8", "-", "-"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new PdftotextDiffError(
          `pdftotext timed out after ${timeoutMs} ms.`,
          "TIMEOUT",
          stderr,
        ),
      );
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new PdftotextDiffError(
          `Failed to spawn pdftotext: ${err.message}`,
          "SPAWN_FAILED",
          stderr,
        ),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new PdftotextDiffError(
          `pdftotext exited with code ${code}.`,
          "NON_ZERO_EXIT",
          stderr,
        ),
      );
    });

    child.stdin.write(Buffer.from(pdf));
    child.stdin.end();
  });
}
