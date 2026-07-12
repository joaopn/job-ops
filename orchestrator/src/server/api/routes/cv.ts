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
  ConvertDocxError,
  convertDocxToPdf,
} from "@server/services/cv/docx/convert-docx-pdf";
import { runDocxUploadPipeline } from "@server/services/cv/docx/docx-upload-pipeline";
import { getDocxExtractionPromptDefault } from "@server/services/cv/docx/llm-docx-extract";
import {
  looksLikeDocx,
  ParseDocxError,
} from "@server/services/cv/docx/parse-docx";
import {
  RenderDocxError,
  renderDocx,
} from "@server/services/cv/docx/render-docx";
import {
  FlattenInputError,
  flattenInput,
} from "@server/services/cv/flatten-input";
import { CvExtractError, extractCv } from "@server/services/cv/llm-extract-cv";
import { RenderCvError, renderCv } from "@server/services/cv/render";
import {
  RenderTemplateError,
  renderTemplate,
} from "@server/services/cv/render-template";
import {
  RunTectonicError,
  runTectonic,
} from "@server/services/cv/run-tectonic";
import {
  GenerateBriefError,
  generateBrief,
} from "@server/services/cv/llm-generate-brief";
import { getExtractionPromptDefault } from "@server/services/cv/llm-template-extract";
import { runUploadPipeline } from "@server/services/cv/upload-pipeline";
import { getEffectiveSettings } from "@server/services/settings";
import type {
  AppSettings,
  CvSourceFormat,
  CvUploadPipelineAttempt,
} from "@shared/types";
import busboy from "busboy";
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";

export const cvRouter = Router();

const updateCvSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  personalBrief: z.string().optional(),
  extractionPrompt: z.string().optional(),
});

function exceedsCharCap(
  field: string,
  observed: number,
  max: number,
): AppError {
  return unprocessableEntity(
    `${field} exceeds the configured limit (${observed} > ${max} chars).`,
    { field, observed, max },
  );
}

function exceedsByteCap(
  field: string,
  observed: number,
  max: number,
): AppError {
  return unprocessableEntity(
    `${field} exceeds the configured limit (${observed} > ${max} bytes).`,
    { field, observed, max },
  );
}

interface ParsedUpload {
  filename: string;
  bytes: Uint8Array;
  fields: Record<string, string>;
}

function resolveFormat(settings: AppSettings): CvSourceFormat {
  return settings.cvSourceFormat ?? "latex";
}

function formatMismatch(format: CvSourceFormat): AppError {
  return unprocessableEntity(
    format === "latex"
      ? "This profile uses LaTeX CVs; to work with Word CVs, create a user profile for them."
      : "This profile uses Word CVs; to work with LaTeX CVs, create a user profile for them.",
  );
}

// Both upload pipelines (LaTeX and docx) emit this exact failure shape —
// the docx pipeline aliases its stages to the LaTeX vocabulary by contract
// — so one mapper serves every call site. Quirk preserved deliberately: a
// compile-original failure is HTTP 502 with body-code UNPROCESSABLE_ENTITY.
interface UploadPipelineFailureShape {
  stage: "flatten" | "compile-original" | "extract-loop";
  message: string;
  flattenCode?: string;
  originalCompileStderr?: string;
  attempts?: CvUploadPipelineAttempt[];
}

function uploadFailureError(result: UploadPipelineFailureShape): AppError {
  const status = result.stage === "flatten" ? 400 : 502;
  return new AppError({
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
            originalCompileStderr: result.originalCompileStderr.slice(-2000),
          }
        : {}),
      ...(result.attempts ? { attempts: result.attempts } : {}),
    },
  });
}

cvRouter.post("/", async (req: Request, res: Response) => {
  try {
    const settings = await getEffectiveSettings();
    // Legacy ungated path is LaTeX-only: a row it inserted into a docx
    // profile would be misinterpreted as docx by every dispatch site.
    if (resolveFormat(settings) === "docx") {
      return fail(
        res,
        unprocessableEntity(
          "This profile uses Word CVs; this endpoint only accepts LaTeX uploads.",
        ),
      );
    }
    const upload = await parseUpload(req, settings.maxCvUploadBytes.value);
    if (!upload) {
      return fail(res, badRequest("No file uploaded."));
    }

    const flattened = flattenInput({
      archive: upload.bytes,
      filename: upload.filename,
      maxExpandedBytes: settings.maxExpandedLatexBytes.value,
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
    const settings = await getEffectiveSettings();
    const upload = await parseUpload(req, settings.maxCvUploadBytes.value);
    if (!upload) {
      return fail(res, badRequest("No file uploaded."));
    }

    const maxRetriesRaw = upload.fields.maxRetries;
    const maxRetries = maxRetriesRaw ? Number(maxRetriesRaw) : undefined;

    const extractionPromptRaw = upload.fields.extractionPrompt ?? "";
    const maxExtractionPromptChars = settings.maxExtractionPromptChars.value;
    if (extractionPromptRaw.length > maxExtractionPromptChars) {
      return fail(
        res,
        exceedsCharCap(
          "extractionPrompt",
          extractionPromptRaw.length,
          maxExtractionPromptChars,
        ),
      );
    }

    // F5 hard gate: the sniff only enforces format-vs-setting agreement;
    // it never selects a pipeline — dispatch is by the setting.
    const format = resolveFormat(settings);
    if (looksLikeDocx(upload.bytes) !== (format === "docx")) {
      return fail(res, formatMismatch(format));
    }

    const result =
      format === "docx"
        ? await runDocxUploadPipeline({
            archive: upload.bytes,
            maxRetries,
            extractionPrompt: extractionPromptRaw || undefined,
            maxExpandedBytes: settings.maxExpandedLatexBytes.value,
          })
        : await runUploadPipeline({
            archive: upload.bytes,
            filename: upload.filename,
            maxRetries,
            extractionPrompt: extractionPromptRaw || undefined,
            maxExpandedBytes: settings.maxExpandedLatexBytes.value,
          });

    if (!result.ok) {
      logger.warn("CV upload rejected", {
        filename: upload.filename,
        stage: result.stage,
        attempts: result.attempts?.length ?? 0,
      });
      return fail(res, uploadFailureError(result));
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
      assetCount:
        "assetReferences" in result && Array.isArray(result.assetReferences)
          ? result.assetReferences.length
          : 0,
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
      const settings = await getEffectiveSettings();
      const prompt =
        resolveFormat(settings) === "docx"
          ? await getDocxExtractionPromptDefault()
          : await getExtractionPromptDefault();
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
    const settings = await getEffectiveSettings();

    if (input.personalBrief !== undefined) {
      const max = settings.maxBriefChars.value;
      if (input.personalBrief.length > max) {
        return fail(
          res,
          exceedsCharCap("personalBrief", input.personalBrief.length, max),
        );
      }
    }

    if (input.extractionPrompt !== undefined) {
      const max = settings.maxExtractionPromptChars.value;
      if (input.extractionPrompt.length > max) {
        return fail(
          res,
          exceedsCharCap(
            "extractionPrompt",
            input.extractionPrompt.length,
            max,
          ),
        );
      }
    }

    const updated = await cvRepo.updateCvDocument(req.params.id, input);
    if (!updated) return fail(res, notFound("CV document not found."));
    ok(res, updated);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

cvRouter.post("/:id/re-extract", async (req: Request, res: Response) => {
  try {
    const settings = await getEffectiveSettings();
    // The 5d cursor-walk extractor is LaTeX-only; on a docx profile it
    // would silently misroute the stored .docx bytes into flattenInput.
    if (resolveFormat(settings) === "docx") {
      return fail(
        res,
        unprocessableEntity(
          "This profile uses Word CVs; use re-extract-template instead.",
        ),
      );
    }
    const archive = await cvRepo.getCvDocumentArchive(req.params.id);
    if (!archive) return fail(res, notFound("CV document not found."));
    const existing = await cvRepo.getCvDocumentById(req.params.id);
    if (!existing) return fail(res, notFound("CV document not found."));

    const flattened = flattenInput({
      archive: new Uint8Array(archive),
      filename: existing.name,
      maxExpandedBytes: settings.maxExpandedLatexBytes.value,
    });
    const extracted = await extractCv({
      flattenedTex: flattened.flattenedTex,
      assetReferences: flattened.assetReferences,
    });
    // Preserve the user's existing personalBrief — re-extract recovers
    // template/fields, but the brief is user-editable scratch and gets
    // its own regenerate-brief endpoint.
    const updated = await cvRepo.updateCvDocument(req.params.id, {
      flattenedTex: flattened.flattenedTex,
      fields: extracted.fields,
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
    const settings = await getEffectiveSettings();
    const archive = await cvRepo.getCvDocumentArchive(req.params.id);
    const document = await cvRepo.getCvDocumentById(req.params.id);
    if (!document || !archive) {
      return fail(res, notFound("CV document not found."));
    }

    let pdf: Uint8Array;
    if (resolveFormat(settings) === "docx") {
      // Defensive: docx rows only exist via the gated path, which always
      // persists a template envelope. A corrupt envelope (JSON.parse
      // throw) falls through to a 500 — invariant violation, same
      // posture as the pipeline's stage-4d comment.
      if (!document.templatedTex) {
        return fail(
          res,
          badRequest("This Word CV has no template — re-upload it."),
        );
      }
      const envelope = JSON.parse(document.templatedTex) as {
        parts: Record<string, string>;
      };
      const rendered = renderDocx({
        originalArchive: new Uint8Array(archive),
        templatedParts: new Map(Object.entries(envelope.parts)),
        effectiveValues: document.defaultFieldValues,
      });
      pdf = await convertDocxToPdf({ docx: rendered });
    } else {
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
      pdf = result.pdf;
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${document.name}.pdf"`,
    );
    res.send(Buffer.from(pdf));
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
      const settings = await getEffectiveSettings();
      const archive = await cvRepo.getCvDocumentArchive(req.params.id);
      const document = await cvRepo.getCvDocumentById(req.params.id);
      if (!document || !archive) {
        return fail(res, notFound("CV document not found."));
      }

      let pdf: Uint8Array;
      if (resolveFormat(settings) === "docx") {
        pdf = await convertDocxToPdf({ docx: new Uint8Array(archive) });
      } else {
        const result = await runTectonic({
          renderedTex: document.flattenedTex,
          archive: new Uint8Array(archive),
        });
        pdf = result.pdf;
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${document.name}-original.pdf"`,
      );
      res.send(Buffer.from(pdf));
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
      const settings = await getEffectiveSettings();
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
        const max = settings.maxExtractionPromptChars.value;
        if (incoming.length > max) {
          return fail(
            res,
            exceedsCharCap("extractionPrompt", incoming.length, max),
          );
        }
        effectivePrompt = incoming;
        await cvRepo.updateCvDocument(req.params.id, {
          extractionPrompt: incoming,
        });
      }

      // No sniff here: the stored archive passed the F5 gate at upload,
      // so the setting alone dispatches.
      const result =
        resolveFormat(settings) === "docx"
          ? await runDocxUploadPipeline({
              archive: new Uint8Array(archive),
              maxRetries,
              extractionPrompt: effectivePrompt || undefined,
              maxExpandedBytes: settings.maxExpandedLatexBytes.value,
            })
          : await runUploadPipeline({
              archive: new Uint8Array(archive),
              filename: existing.name,
              maxRetries,
              extractionPrompt: effectivePrompt || undefined,
              maxExpandedBytes: settings.maxExpandedLatexBytes.value,
            });

      if (!result.ok) {
        logger.warn("CV re-extract-template rejected", {
          cvDocumentId: req.params.id,
          stage: result.stage,
          attempts: result.attempts?.length ?? 0,
        });
        return fail(res, uploadFailureError(result));
      }

      // Preserve the user's existing personalBrief — re-extract recovers
      // template/fields, but the brief is user-editable scratch and gets
      // its own regenerate-brief endpoint.
      const updated = await cvRepo.updateCvDocument(req.params.id, {
        flattenedTex: result.flattenedTex,
        fields: result.fields,
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

/**
 * Stand-alone brief regeneration. Decoupled from re-extract so the
 * user's free-form brief edits don't get clobbered by every template
 * re-extract. Invokes a small dedicated LLM call (cv-generate-brief
 * prompt) against the persisted flattened tex and overwrites only the
 * `personal_brief` column.
 */
cvRouter.post(
  "/:id/regenerate-brief",
  async (req: Request, res: Response) => {
    try {
      const existing = await cvRepo.getCvDocumentById(req.params.id);
      if (!existing) return fail(res, notFound("CV document not found."));

      const brief = await generateBrief({
        flattenedTex: existing.flattenedTex,
      });
      const updated = await cvRepo.updateCvDocument(req.params.id, {
        personalBrief: brief,
      });
      if (!updated) return fail(res, notFound("CV document not found."));

      logger.info("CV personal brief regenerated", {
        cvDocumentId: req.params.id,
        briefLength: brief.length,
      });
      ok(res, updated);
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

function parseUpload(
  req: Request,
  maxBytes: number,
): Promise<ParsedUpload | null> {
  return new Promise((resolve, reject) => {
    let bb: ReturnType<typeof busboy>;
    try {
      bb = busboy({
        headers: req.headers,
        limits: { fileSize: maxBytes, files: 1 },
      });
    } catch (error) {
      reject(error);
      return;
    }

    let upload: ParsedUpload | null = null;
    const fields: Record<string, string> = {};
    let truncated = false;
    let observedBytes = 0;

    bb.on("file", (_field, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => {
        observedBytes += chunk.length;
        chunks.push(chunk);
      });
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
        reject(exceedsByteCap("upload", observedBytes, maxBytes));
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
  if (error instanceof ParseDocxError) {
    fail(res, badRequest(error.message, { code: error.code }));
    return;
  }
  if (error instanceof RenderDocxError) {
    fail(res, badRequest(error.message, { code: error.code }));
    return;
  }
  // RunTectonicError parity for the docx preview paths. UNAVAILABLE
  // (unoserver daemon down) deliberately conflates into the same 422 —
  // same acknowledged posture as the upload pipeline's convert-original.
  if (error instanceof ConvertDocxError) {
    fail(
      res,
      unprocessableEntity(`PDF conversion failed: ${error.message}`, {
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
  if (error instanceof GenerateBriefError) {
    fail(
      res,
      new AppError({
        status: 502,
        code: "UPSTREAM_ERROR",
        message: error.message,
        details: { code: error.code },
      }),
    );
    return;
  }
  fail(res, toAppError(error));
}
