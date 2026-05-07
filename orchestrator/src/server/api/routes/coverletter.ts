import {
  AppError,
  badRequest,
  notFound,
  toAppError,
  unprocessableEntity,
} from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import * as repo from "@server/repositories/cover-letter-documents";
import { FlattenInputError } from "@server/services/cv/flatten-input";
import {
  RenderTemplateError,
  renderTemplate,
} from "@server/services/cv/render-template";
import {
  RunTectonicError,
  runTectonic,
} from "@server/services/cv/run-tectonic";
import { getCoverLetterExtractionPromptDefault } from "@server/services/cover-letter/llm-template-extract";
import { runCoverLetterUploadPipeline } from "@server/services/cover-letter/upload-pipeline";
import busboy from "busboy";
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTION_PROMPT_BYTES = 50_000;

export const coverLetterRouter = Router();

const updateCoverLetterSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  extractionPrompt: z.string().max(MAX_EXTRACTION_PROMPT_BYTES).optional(),
});

interface ParsedUpload {
  filename: string;
  bytes: Uint8Array;
  fields: Record<string, string>;
}

/**
 * 5h gated upload: runs the templated-tex pipeline (compile original →
 * LLM template-extract loop with body-field-count check → compile
 * templated → pdftotext diff). On accept, persists the cover-letter
 * document with the new substrate columns populated; on reject, returns
 * 502 with the per-attempt log so the UI can surface tectonic stderr /
 * pdftotext diff to the user.
 */
coverLetterRouter.post(
  "/upload-template",
  async (req: Request, res: Response) => {
    try {
      const upload = await parseUpload(req);
      if (!upload) {
        return fail(res, badRequest("No file uploaded."));
      }

      const maxRetriesRaw = upload.fields.maxRetries;
      const maxRetries = maxRetriesRaw ? Number(maxRetriesRaw) : undefined;

      const extractionPromptRaw = upload.fields.extractionPrompt ?? "";
      if (extractionPromptRaw.length > MAX_EXTRACTION_PROMPT_BYTES) {
        return fail(
          res,
          badRequest(
            `extractionPrompt exceeds the ${MAX_EXTRACTION_PROMPT_BYTES}-byte limit.`,
          ),
        );
      }

      const result = await runCoverLetterUploadPipeline({
        archive: upload.bytes,
        filename: upload.filename,
        maxRetries,
        extractionPrompt: extractionPromptRaw || undefined,
      });

      if (!result.ok) {
        logger.warn("Cover-letter upload rejected", {
          filename: upload.filename,
          stage: result.stage,
          attempts: result.attempts?.length ?? 0,
        });
        const status = result.stage === "flatten" ? 400 : 502;
        return fail(
          res,
          new AppError({
            status,
            code:
              result.stage === "flatten"
                ? "INVALID_REQUEST"
                : result.stage === "compile-original"
                  ? "UNPROCESSABLE_ENTITY"
                  : "UPSTREAM_ERROR",
            message: result.message,
            details: {
              stage: result.stage,
              ...(result.flattenCode ? { flattenCode: result.flattenCode } : {}),
              ...(result.originalCompileStderr
                ? {
                    originalCompileStderr:
                      result.originalCompileStderr.slice(-2000),
                  }
                : {}),
              ...(result.attempts ? { attempts: result.attempts } : {}),
            },
          }),
        );
      }

      const document = await repo.createCoverLetterDocument({
        name:
          upload.fields.name?.trim() ||
          upload.filename.replace(/\.[^.]+$/, "") ||
          "Cover letter",
        originalArchive: upload.bytes,
        flattenedTex: result.flattenedTex,
        fields: result.fields,
        templatedTex: result.templatedTex,
        defaultFieldValues: result.defaultFieldValues,
        lastCompileStderr: result.compileStderr,
        compileAttempts: result.compileAttempts,
        extractionPrompt: extractionPromptRaw,
      });

      logger.info("Cover-letter document created", {
        coverLetterDocumentId: document.id,
        filename: upload.filename,
        assetCount: result.assetReferences.length,
        fieldCount: result.fields.length,
        compileAttempts: result.compileAttempts,
      });

      ok(
        res,
        {
          coverLetter: document,
          attempts: result.attempts,
        },
        201,
      );
    } catch (error) {
      handleError(res, error);
    }
  },
);

coverLetterRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const documents = await repo.listCoverLetterDocuments();
    ok(res, documents);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

/**
 * Returns the server's default extraction system prompt verbatim. Used
 * by the client to pre-fill the per-document textarea.
 */
coverLetterRouter.get(
  "/extraction-prompt-default",
  async (_req: Request, res: Response) => {
    try {
      const prompt = await getCoverLetterExtractionPromptDefault();
      ok(res, { prompt });
    } catch (error) {
      fail(res, toAppError(error));
    }
  },
);

coverLetterRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const document = await repo.getCoverLetterDocumentById(req.params.id);
    if (!document) {
      return fail(res, notFound("Cover-letter document not found."));
    }
    ok(res, document);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

coverLetterRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const input = updateCoverLetterSchema.parse(req.body ?? {});
    const updated = await repo.updateCoverLetterDocument(req.params.id, input);
    if (!updated) {
      return fail(res, notFound("Cover-letter document not found."));
    }
    ok(res, updated);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

coverLetterRouter.get(
  "/:id/render-preview",
  async (req: Request, res: Response) => {
    try {
      const archive = await repo.getCoverLetterDocumentArchive(req.params.id);
      const document = await repo.getCoverLetterDocumentById(req.params.id);
      if (!document || !archive) {
        return fail(res, notFound("Cover-letter document not found."));
      }

      const tex = renderTemplate(
        document.templatedTex,
        document.defaultFieldValues,
      );
      const result = await runTectonic({
        renderedTex: tex,
        archive: new Uint8Array(archive),
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${document.name}.pdf"`,
      );
      res.send(Buffer.from(result.pdf));
    } catch (error) {
      handleError(res, error);
    }
  },
);

coverLetterRouter.get(
  "/:id/render-original-preview",
  async (req: Request, res: Response) => {
    try {
      const archive = await repo.getCoverLetterDocumentArchive(req.params.id);
      const document = await repo.getCoverLetterDocumentById(req.params.id);
      if (!document || !archive) {
        return fail(res, notFound("Cover-letter document not found."));
      }

      const result = await runTectonic({
        renderedTex: document.flattenedTex,
        archive: new Uint8Array(archive),
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${document.name}-original.pdf"`,
      );
      res.send(Buffer.from(result.pdf));
    } catch (error) {
      handleError(res, error);
    }
  },
);

/**
 * Re-runs the gated pipeline against the existing archive. Same accept/
 * reject semantics as upload — returns 502 with the per-attempt log on
 * failure rather than mutating the document.
 */
coverLetterRouter.post(
  "/:id/re-extract-template",
  async (req: Request, res: Response) => {
    try {
      const archive = await repo.getCoverLetterDocumentArchive(req.params.id);
      if (!archive) {
        return fail(res, notFound("Cover-letter document not found."));
      }
      const existing = await repo.getCoverLetterDocumentById(req.params.id);
      if (!existing) {
        return fail(res, notFound("Cover-letter document not found."));
      }

      const body =
        typeof req.body === "object" && req.body !== null
          ? (req.body as Record<string, unknown>)
          : {};
      const maxRetriesRaw = body.maxRetries;
      const maxRetries =
        typeof maxRetriesRaw === "number" ? maxRetriesRaw : undefined;

      let effectivePrompt = existing.extractionPrompt;
      if (typeof body.extractionPrompt === "string") {
        const incoming = body.extractionPrompt;
        if (incoming.length > MAX_EXTRACTION_PROMPT_BYTES) {
          return fail(
            res,
            badRequest(
              `extractionPrompt exceeds the ${MAX_EXTRACTION_PROMPT_BYTES}-byte limit.`,
            ),
          );
        }
        effectivePrompt = incoming;
        await repo.updateCoverLetterDocument(req.params.id, {
          extractionPrompt: incoming,
        });
      }

      const result = await runCoverLetterUploadPipeline({
        archive: new Uint8Array(archive),
        filename: existing.name,
        maxRetries,
        extractionPrompt: effectivePrompt || undefined,
      });

      if (!result.ok) {
        logger.warn("Cover-letter re-extract-template rejected", {
          coverLetterDocumentId: req.params.id,
          stage: result.stage,
          attempts: result.attempts?.length ?? 0,
        });
        const status = result.stage === "flatten" ? 400 : 502;
        return fail(
          res,
          new AppError({
            status,
            code:
              result.stage === "flatten"
                ? "INVALID_REQUEST"
                : result.stage === "compile-original"
                  ? "UNPROCESSABLE_ENTITY"
                  : "UPSTREAM_ERROR",
            message: result.message,
            details: {
              stage: result.stage,
              ...(result.flattenCode
                ? { flattenCode: result.flattenCode }
                : {}),
              ...(result.originalCompileStderr
                ? {
                    originalCompileStderr:
                      result.originalCompileStderr.slice(-2000),
                  }
                : {}),
              ...(result.attempts ? { attempts: result.attempts } : {}),
            },
          }),
        );
      }

      const updated = await repo.updateCoverLetterDocument(req.params.id, {
        flattenedTex: result.flattenedTex,
        fields: result.fields,
        templatedTex: result.templatedTex,
        defaultFieldValues: result.defaultFieldValues,
        lastCompileStderr: result.compileStderr,
        compileAttempts: result.compileAttempts,
      });
      if (!updated) {
        return fail(res, notFound("Cover-letter document not found."));
      }

      logger.info("Cover-letter document re-extracted", {
        coverLetterDocumentId: req.params.id,
        fieldCount: result.fields.length,
        compileAttempts: result.compileAttempts,
      });
      ok(res, { coverLetter: updated, attempts: result.attempts });
    } catch (error) {
      handleError(res, error);
    }
  },
);

coverLetterRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const removed = await repo.deleteCoverLetterDocument(req.params.id);
    if (removed === 0) {
      return fail(res, notFound("Cover-letter document not found."));
    }
    ok(res, { deleted: removed });
  } catch (error) {
    fail(res, toAppError(error));
  }
});

function parseUpload(req: Request): Promise<ParsedUpload | null> {
  return new Promise((resolve, reject) => {
    let bb: ReturnType<typeof busboy>;
    try {
      bb = busboy({
        headers: req.headers,
        limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
      });
    } catch (error) {
      reject(error);
      return;
    }

    let upload: ParsedUpload | null = null;
    const fields: Record<string, string> = {};
    let truncated = false;

    bb.on("file", (_field, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("limit", () => {
        truncated = true;
        stream.resume();
      });
      stream.on("end", () => {
        upload = {
          filename: info.filename ?? "upload",
          bytes: new Uint8Array(Buffer.concat(chunks)),
          fields,
        };
      });
    });

    bb.on("field", (name, value) => {
      fields[name] = value;
    });

    bb.on("close", () => {
      if (truncated) {
        reject(
          badRequest(
            `Upload exceeded the ${MAX_UPLOAD_BYTES} byte limit.`,
          ),
        );
        return;
      }
      if (upload) upload.fields = fields;
      resolve(upload);
    });

    bb.on("error", reject);
    req.pipe(bb);
  });
}

function handleError(res: Response, error: unknown): void {
  if (error instanceof FlattenInputError) {
    fail(res, badRequest(error.message, { code: error.code }));
    return;
  }
  if (error instanceof RenderTemplateError) {
    fail(res, badRequest(error.message, { code: error.code }));
    return;
  }
  if (error instanceof RunTectonicError) {
    fail(
      res,
      unprocessableEntity(`LaTeX render failed: ${error.message}`, {
        code: error.code,
        stderr: error.stderr.slice(-2000),
      }),
    );
    return;
  }
  fail(res, toAppError(error));
}
