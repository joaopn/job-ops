import { createWriteStream } from "node:fs";
import busboy from "busboy";
import type { Request } from "express";

/** Stream a single uploaded file straight to `destPath`. Resolves to the
 * destination path on success, or null if no file part was present. */
export function receiveUpload(
  req: Request,
  destPath: string,
): Promise<string | null> {
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
