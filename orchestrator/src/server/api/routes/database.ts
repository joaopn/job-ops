import { createWriteStream, existsSync, rmSync } from "node:fs";
import { badRequest, toAppError, unprocessableEntity } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { clearDatabase } from "@server/db/clear";
import { closeDb } from "@server/db/index";
import {
  applyRestore,
  exportSnapshot,
  restoreStagingPath,
  validateSnapshot,
} from "@server/db/snapshot";
import busboy from "busboy";
import { type Request, type Response, Router } from "express";

export const databaseRouter = Router();

/**
 * DELETE /api/database - Clear all data from the database
 */
databaseRouter.delete("/", async (_req: Request, res: Response) => {
  try {
    const result = clearDatabase();

    ok(res, {
      message: "Database cleared",
      jobsDeleted: result.jobsDeleted,
      runsDeleted: result.runsDeleted,
    });
  } catch (error) {
    fail(res, toAppError(error));
  }
});

/**
 * GET /api/database/export?includeSecrets=0|1 - Download a consistent
 * single-file snapshot of the DB. With `includeSecrets=1` the snapshot
 * carries LLM/Apify credentials + basic-auth password in plaintext; default
 * strips them.
 */
databaseRouter.get("/export", (req: Request, res: Response) => {
  const includeSecrets = req.query.includeSecrets === "1";
  let snapshot: ReturnType<typeof exportSnapshot> | null = null;
  try {
    snapshot = exportSnapshot({ includeSecrets });
  } catch (error) {
    fail(res, toAppError(error));
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `jobops-backup-${stamp}.db`;
  logger.info("DB snapshot exported", { includeSecrets });

  res.download(snapshot.path, filename, (err) => {
    snapshot?.cleanup();
    if (err && !res.headersSent) {
      fail(res, toAppError(err));
    }
  });
});

/**
 * POST /api/database/restore - Upload a snapshot (multipart) and swap it in
 * as the live DB. Validates before swapping; on success the app must be
 * restarted to re-open the connection (migrations re-run on boot).
 */
databaseRouter.post("/restore", async (req: Request, res: Response) => {
  const staging = restoreStagingPath();
  try {
    const received = await receiveUpload(req, staging);
    if (!received) {
      return fail(res, badRequest("No file uploaded."));
    }

    const validation = validateSnapshot(staging);
    if (!validation.ok) {
      rmSync(staging, { force: true });
      return fail(res, unprocessableEntity(validation.reason));
    }

    // Close the live connection, then swap the file in. The process must
    // restart to re-open against the restored DB.
    closeDb();
    applyRestore(staging);

    logger.warn("DB restored from snapshot — restart required", {
      formatVersion: validation.formatVersion,
    });
    ok(res, {
      message: "Database restored. Restart the app to finish.",
      restartRequired: true,
    });
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { force: true });
    fail(res, toAppError(error));
  }
});

/** Stream a single uploaded file straight to `destPath`. Resolves to the
 * destination path on success, or null if no file part was present. */
function receiveUpload(req: Request, destPath: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let bb: ReturnType<typeof busboy>;
    try {
      bb = busboy({ headers: req.headers, limits: { files: 1 } });
    } catch (error) {
      reject(error);
      return;
    }

    let sawFile = false;
    let fileFinished = false;
    let parsingDone = false;
    let writeError: Error | null = null;

    const settle = () => {
      if (writeError) {
        reject(writeError);
        return;
      }
      // Resolve only once both the parser is done AND the destination stream
      // has fully flushed (or no file part ever arrived).
      if (parsingDone && (fileFinished || !sawFile)) {
        resolve(sawFile ? destPath : null);
      }
    };

    bb.on("file", (_field, stream, _info) => {
      sawFile = true;
      const out = createWriteStream(destPath);
      out.on("error", (err) => {
        writeError = err;
        stream.resume();
        settle();
      });
      out.on("finish", () => {
        fileFinished = true;
        settle();
      });
      stream.pipe(out);
    });

    bb.on("close", () => {
      parsingDone = true;
      settle();
    });

    bb.on("error", reject);
    req.pipe(bb);
  });
}
