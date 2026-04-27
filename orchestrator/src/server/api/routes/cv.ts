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
  CvExtractError,
  extractCv,
} from "@server/services/cv/llm-extract-cv";
import {
  FlattenInputError,
  flattenInput,
} from "@server/services/cv/flatten-input";
import {
  RenderTemplateError,
  renderTemplate,
} from "@server/services/cv/render-template";
import {
  RunTectonicError,
  runTectonic,
} from "@server/services/cv/run-tectonic";
import { cvContentSchema } from "@shared/types";
import busboy from "busboy";
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const cvRouter = Router();

const updateCvSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  template: z.string().min(1).optional(),
  content: cvContentSchema.optional(),
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
      template: extracted.template,
      content: extracted.content,
    });

    logger.info("CV document created", {
      cvDocumentId: document.id,
      filename: upload.filename,
      assetCount: flattened.assetReferences.length,
    });

    ok(res, document, 201);
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
      template: extracted.template,
      content: extracted.content,
    });
    if (!updated) return fail(res, notFound("CV document not found."));

    logger.info("CV document re-extracted", { cvDocumentId: req.params.id });
    ok(res, updated);
  } catch (error) {
    handleCvError(res, error);
  }
});

cvRouter.post("/:id/render-preview", async (req: Request, res: Response) => {
  try {
    const archive = await cvRepo.getCvDocumentArchive(req.params.id);
    const document = await cvRepo.getCvDocumentById(req.params.id);
    if (!document || !archive) {
      return fail(res, notFound("CV document not found."));
    }

    const tex = renderTemplate(document.template, document.content);
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
