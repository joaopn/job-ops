import { badRequest, toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import {
  clearPromptCache,
  listPrompts,
  loadPrompt,
} from "@server/services/prompts";
import { type Request, type Response, Router } from "express";

export const promptsRouter = Router();

/**
 * GET /api/prompts — list every prompt YAML on disk with its mtime + description.
 */
promptsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const prompts = await listPrompts();
    ok(res, { prompts });
  } catch (error) {
    fail(res, toAppError(error));
  }
});

/**
 * POST /api/prompts/reload — drop a prompt's in-memory cache so the next
 * loadPrompt() picks up edits made directly on disk (the prompts/ dir is
 * bind-mounted into the container). With no body, drops every entry. Body:
 *   { name?: string }
 *
 * Validates by reloading once after the drop; reports parse/render failures
 * up the wire so the user sees the YAML mistake instead of the next caller.
 */
promptsRouter.post("/reload", async (req: Request, res: Response) => {
  try {
    const rawName = req.body?.name;
    const name =
      typeof rawName === "string" && rawName.trim().length > 0
        ? rawName.trim()
        : null;

    if (rawName != null && name == null) {
      return fail(res, badRequest("name must be a non-empty string"));
    }

    if (name == null) {
      clearPromptCache();
      ok(res, { reloaded: "all" });
      return;
    }

    clearPromptCache(name);
    // Re-validate immediately so a YAML mistake surfaces as a 400 instead of
    // bleeding into the next consumer (e.g. a pipeline run).
    await loadPrompt(name);
    ok(res, { reloaded: name });
  } catch (error) {
    fail(res, toAppError(error));
  }
});
