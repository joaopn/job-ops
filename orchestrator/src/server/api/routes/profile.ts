import { toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { clearProfileCache, getProfile } from "@server/services/profile";
import { type Request, type Response, Router } from "express";

export const profileRouter = Router();

/**
 * GET /api/profile/projects - Get all projects available in the base resume.
 *
 * Returns an empty list while the resume layer is being rewritten on top of
 * a user-uploaded LaTeX CV.
 */
profileRouter.get("/projects", async (_req: Request, res: Response) => {
  try {
    ok(res, []);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

/**
 * GET /api/profile - Get the full base resume profile
 */
profileRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const profile = await getProfile();
    ok(res, profile);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

/**
 * GET /api/profile/status - Check if base resume is configured and accessible
 */
profileRouter.get("/status", async (_req: Request, res: Response) => {
  ok(res, {
    exists: false,
    error:
      "No resume uploaded yet. Upload a LaTeX CV to enable scoring and tailoring.",
  });
});

/**
 * POST /api/profile/refresh - Clear profile cache and reload
 */
profileRouter.post("/refresh", async (_req: Request, res: Response) => {
  try {
    clearProfileCache();
    const profile = await getProfile(true);
    ok(res, profile);
  } catch (error) {
    fail(res, toAppError(error));
  }
});
