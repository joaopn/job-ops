import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

const DEFAULT_TIMEOUT_MS = 60_000;
const TECTONIC_BIN = process.env.TECTONIC_BIN ?? "tectonic";

export interface RunTectonicArgs {
  renderedTex: string;
  /** Original archive bytes — extracted into the temp dir so referenced assets resolve. */
  archive?: Uint8Array;
  /** Entrypoint name (path inside the archive). Defaults to "main.tex". */
  entrypoint?: string;
  /** Timeout in ms. Default: 60_000. */
  timeoutMs?: number;
}

export interface RunTectonicResult {
  pdf: Uint8Array;
  log: string;
}

export class RunTectonicError extends Error {
  readonly code: string;
  readonly stderr: string;
  constructor(message: string, code: string, stderr: string) {
    super(message);
    this.name = "RunTectonicError";
    this.code = code;
    this.stderr = stderr;
  }
}

export async function runTectonic(
  args: RunTectonicArgs,
): Promise<RunTectonicResult> {
  const entrypoint = args.entrypoint ?? "main.tex";
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "cv-tectonic-"));
  try {
    if (args.archive && looksLikeZip(args.archive)) {
      const zip = new AdmZip(Buffer.from(args.archive));
      zip.extractAllTo(tempDir, /* overwrite */ true);
    }

    const entrypointPath = path.join(tempDir, entrypoint);
    await fs.mkdir(path.dirname(entrypointPath), { recursive: true });
    await fs.writeFile(entrypointPath, args.renderedTex, "utf8");

    const stderr = await spawnTectonic(entrypointPath, tempDir, timeoutMs);

    const pdfPath = path.join(
      path.dirname(entrypointPath),
      `${path.basename(entrypoint, ".tex")}.pdf`,
    );
    const pdf = await fs.readFile(pdfPath);
    return { pdf: new Uint8Array(pdf), log: stderr };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function looksLikeZip(buf: Uint8Array): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04
  );
}

function spawnTectonic(
  entrypointPath: string,
  outdir: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      TECTONIC_BIN,
      [
        "--keep-logs",
        "--outdir",
        path.dirname(entrypointPath),
        "--chatter",
        "minimal",
        entrypointPath,
      ],
      { cwd: outdir, stdio: ["ignore", "pipe", "pipe"] },
    );

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.stdout.on("data", () => {
      // tectonic writes progress to stderr; stdout is normally empty.
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new RunTectonicError(
          `tectonic timed out after ${timeoutMs} ms.`,
          "TIMEOUT",
          stderr,
        ),
      );
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new RunTectonicError(
          `Failed to spawn tectonic: ${err.message}`,
          "SPAWN_FAILED",
          stderr,
        ),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stderr);
        return;
      }
      reject(
        new RunTectonicError(
          `tectonic exited with code ${code}.`,
          "NON_ZERO_EXIT",
          stderr,
        ),
      );
    });
  });
}
