import {
  AppError,
  badRequest,
  notFound,
  toAppError,
  unprocessableEntity,
} from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import * as cvRepo from "@server/repositories/cv-documents";
import {
  FlattenInputError,
  flattenInput,
} from "@server/services/cv/flatten-input";
import {
  CvExtractError,
  extractCv,
} from "@server/services/cv/llm-extract-cv";
import { RenderCvError, renderCv } from "@server/services/cv/render";
import {
  RenderTemplateError,
  renderTemplate,
} from "@server/services/cv/render-template";
import {
  RunTectonicError,
  runTectonic,
} from "@server/services/cv/run-tectonic";
import { getExtractionPromptDefault } from "@server/services/cv/llm-template-extract";
import { runUploadPipeline } from "@server/services/cv/upload-pipeline";
import busboy from "busboy";
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PERSONAL_BRIEF_BYTES = 50_000;
const MAX_EXTRACTION_PROMPT_BYTES = 50_000;

export const cvRouter = Router();

const updateCvSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  personalBrief: z.string().max(MAX_PERSONAL_BRIEF_BYTES).optional(),
  extractionPrompt: z
    .string()
    .max(MAX_EXTRACTION_PROMPT_BYTES)
    .optional(),
});

interface ParsedUpload {
  filename: string;
  bytes: Uint8Array;
  fields: Record<string, string>;
}

cvRouter.post("/", async (req: Request, res: Response) => {
  try {
    const upload = await parseUpload(req);
    if (!upload) {
      return fail(res, badRequest("No file uploaded."));
    }

    const flattened = flattenInput({
      archive: upload.bytes,
      filename: upload.filename,
    });
    const extracted = await extractCv({
      flattenedTex: flattened.flattenedTex,
      assetReferences: flattened.assetReferences,
    });

    const document = await cvRepo.createCvDocument({
      name:
        upload.fields.name?.trim() ||
        upload.filename.replace(/\.[^.]+$/, "") ||
        "CV",
      originalArchive: upload.bytes,
      flattenedTex: flattened.flattenedTex,
      fields: extracted.fields,
      personalBrief: extracted.personalBrief,
    });

    logger.info("CV document created", {
      cvDocumentId: document.id,
      filename: upload.filename,
      assetCount: flattened.assetReferences.length,
      fieldCount: extracted.fields.length,
    });

    ok(res, document, 201);
  } catch (error) {
    handleCvError(res, error);
  }
});

/**
 * 5e gated upload: runs the templated-tex pipeline (compile original →
 * LLM template-extract loop → compile templated → pdftotext diff). On
 * accept, persists the CV with the new substrate columns populated; on
 * reject, returns 502 with the per-attempt log so the UI can surface
 * tectonic stderr / pdftotext diff to the user. The 5d POST `/` route
 * stays untouched until 5e.4 cuts over.
 */
cvRouter.post("/upload-template", async (req: Request, res: Response) => {
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

    const result = await runUploadPipeline({
      archive: upload.bytes,
      filename: upload.filename,
      maxRetries,
      extractionPrompt: extractionPromptRaw || undefined,
    });

    if (!result.ok) {
      logger.warn("CV upload rejected", {
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
              ? { originalCompileStderr: result.originalCompileStderr.slice(-2000) }
              : {}),
            ...(result.attempts ? { attempts: result.attempts } : {}),
          },
        }),
      );
    }

    const document = await cvRepo.createCvDocument({
      name:
        upload.fields.name?.trim() ||
        upload.filename.replace(/\.[^.]+$/, "") ||
        "CV",
      originalArchive: upload.bytes,
      flattenedTex: result.flattenedTex,
      fields: result.fields,
      personalBrief: result.personalBrief,
      templatedTex: result.templatedTex,
      defaultFieldValues: result.defaultFieldValues,
      lastCompileStderr: result.compileStderr,
      compileAttempts: result.compileAttempts,
      extractionPrompt: extractionPromptRaw,
    });

    logger.info("CV document created", {
      cvDocumentId: document.id,
      filename: upload.filename,
      assetCount: result.assetReferences.length,
      fieldCount: result.fields.length,
      compileAttempts: result.compileAttempts,
    });

    ok(
      res,
      {
        cv: document,
        attempts: result.attempts,
      },
      201,
    );
  } catch (error) {
    handleCvError(res, error);
  }
});

cvRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const documents = await cvRepo.listCvDocuments();
    ok(res, documents);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

/**
 * 5e.3a: returns the server's default extraction system prompt verbatim.
 * The client uses this to pre-fill the per-CV textarea on first upload
 * (so the user sees the entire prompt, can edit it, and submits the full
 * text). Listed before the `/:id` routes so the literal path isn't
 * shadowed.
 */
cvRouter.get(
  "/extraction-prompt-default",
  async (_req: Request, res: Response) => {
    try {
      const prompt = await getExtractionPromptDefault();
      ok(res, { prompt });
    } catch (error) {
      fail(res, toAppError(error));
    }
  },
);

cvRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const document = await cvRepo.getCvDocumentById(req.params.id);
    if (!document) return fail(res, notFound("CV document not found."));
    ok(res, document);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

cvRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const input = updateCvSchema.parse(req.body ?? {});
    const updated = await cvRepo.updateCvDocument(req.params.id, input);
    if (!updated) return fail(res, notFound("CV document not found."));
    ok(res, updated);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

cvRouter.post("/:id/re-extract", async (req: Request, res: Response) => {
  try {
    const archive = await cvRepo.getCvDocumentArchive(req.params.id);
    if (!archive) return fail(res, notFound("CV document not found."));
    const existing = await cvRepo.getCvDocumentById(req.params.id);
    if (!existing) return fail(res, notFound("CV document not found."));

    const flattened = flattenInput({
      archive: new Uint8Array(archive),
      filename: existing.name,
    });
    const extracted = await extractCv({
      flattenedTex: flattened.flattenedTex,
      assetReferences: flattened.assetReferences,
    });
    const updated = await cvRepo.updateCvDocument(req.params.id, {
      flattenedTex: flattened.flattenedTex,
      fields: extracted.fields,
      personalBrief: extracted.personalBrief,
    });
    if (!updated) return fail(res, notFound("CV document not found."));

    logger.info("CV document re-extracted", {
      cvDocumentId: req.params.id,
      fieldCount: extracted.fields.length,
    });
    ok(res, updated);
  } catch (error) {
    handleCvError(res, error);
  }
});

cvRouter.get("/:id/render-preview", async (req: Request, res: Response) => {
  try {
    const archive = await cvRepo.getCvDocumentArchive(req.params.id);
    const document = await cvRepo.getCvDocumentById(req.params.id);
    if (!document || !archive) {
      return fail(res, notFound("CV document not found."));
    }

    // 5e CVs render via marker-replace against `defaultFieldValues`.
    // 5d CVs (no `templatedTex`) keep the cursor-walk path. Cutover to
    // single substrate happens in 5e.4.
    const tex = document.templatedTex
      ? renderTemplate(document.templatedTex, document.defaultFieldValues)
      : renderCv(document.flattenedTex, document.fields, {});
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
    handleCvError(res, error);
  }
});

/**
 * Compile the unmodified `flattened_tex` so the user can compare the
 * 5e templated render against the original CV PDF in the verification
 * view ("Show original PDF" link).
 */
cvRouter.get(
  "/:id/render-original-preview",
  async (req: Request, res: Response) => {
    try {
      const archive = await cvRepo.getCvDocumentArchive(req.params.id);
      const document = await cvRepo.getCvDocumentById(req.params.id);
      if (!document || !archive) {
        return fail(res, notFound("CV document not found."));
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
      handleCvError(res, error);
    }
  },
);

/**
 * 5e re-extract: re-runs the templated upload pipeline against the
 * existing archive. Same accept/reject semantics as the upload route —
 * returns 502 with the per-attempt log on failure rather than mutating
 * the document. The 5d POST `/:id/re-extract` route stays for 5d-era
 * documents until 5e.4 cuts over.
 */
cvRouter.post(
  "/:id/re-extract-template",
  async (req: Request, res: Response) => {
    try {
      const archive = await cvRepo.getCvDocumentArchive(req.params.id);
      if (!archive) return fail(res, notFound("CV document not found."));
      const existing = await cvRepo.getCvDocumentById(req.params.id);
      if (!existing) return fail(res, notFound("CV document not found."));

      const body =
        typeof req.body === "object" && req.body !== null
          ? (req.body as Record<string, unknown>)
          : {};
      const maxRetriesRaw = body.maxRetries;
      const maxRetries =
        typeof maxRetriesRaw === "number" ? maxRetriesRaw : undefined;

      // 5e.3a: a re-extract may carry a fresh per-CV prompt. Persist it
      // BEFORE running the pipeline so a failed re-extract still saves
      // the user's edited prompt (next attempt sees the new text).
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
        await cvRepo.updateCvDocument(req.params.id, {
          extractionPrompt: incoming,
        });
      }

      const result = await runUploadPipeline({
        archive: new Uint8Array(archive),
        filename: existing.name,
        maxRetries,
        extractionPrompt: effectivePrompt || undefined,
      });

      if (!result.ok) {
        logger.warn("CV re-extract-template rejected", {
          cvDocumentId: req.params.id,
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

      const updated = await cvRepo.updateCvDocument(req.params.id, {
        flattenedTex: result.flattenedTex,
        fields: result.fields,
        personalBrief: result.personalBrief,
        templatedTex: result.templatedTex,
        defaultFieldValues: result.defaultFieldValues,
        lastCompileStderr: result.compileStderr,
        compileAttempts: result.compileAttempts,
      });
      if (!updated) return fail(res, notFound("CV document not found."));

      logger.info("CV document re-extracted via template pipeline", {
        cvDocumentId: req.params.id,
        fieldCount: result.fields.length,
        compileAttempts: result.compileAttempts,
      });
      ok(res, { cv: updated, attempts: result.attempts });
    } catch (error) {
      handleCvError(res, error);
    }
  },
);

cvRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const removed = await cvRepo.deleteCvDocument(req.params.id);
    if (removed === 0) return fail(res, notFound("CV document not found."));
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

function handleCvError(res: Response, error: unknown): void {
  if (error instanceof FlattenInputError) {
    fail(res, badRequest(error.message, { code: error.code }));
    return;
  }
  if (error instanceof RenderCvError) {
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
  if (error instanceof CvExtractError) {
    fail(
      res,
      new AppError({
        status: 502,
        code: "UPSTREAM_ERROR",
        message: error.message,
        details: { code: error.code, detail: error.detail },
      }),
    );
    return;
  }
  fail(res, toAppError(error));
}
