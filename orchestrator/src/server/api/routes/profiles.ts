import { conflict, notFound, toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import * as profilesRepo from "@server/repositories/profiles";
import * as profilesService from "@server/services/profiles";
import { profileConfigSchema } from "@shared/types";
import type { Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";

export const profilesRouter = Router();

const configPatchSchema = profileConfigSchema.partial();

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  config: configPatchSchema.optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  config: configPatchSchema.optional(),
});

profilesRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const profiles = await profilesRepo.getAllProfiles();
    const defaultProfile = await profilesService.getDefaultProfile();
    ok(res, { profiles, defaultProfileId: defaultProfile?.id ?? null });
  } catch (error) {
    fail(res, toAppError(error));
  }
});

profilesRouter.post("/", async (req: Request, res: Response) => {
  try {
    const input = createSchema.parse(req.body ?? {});
    const created = await profilesRepo.createProfile(input);
    ok(res, created);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

profilesRouter.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const patch = updateSchema.parse(req.body ?? {});
    const updated = await profilesRepo.updateProfile(id, patch);
    if (!updated) {
      return fail(res, notFound(`Profile not found: ${id}`));
    }
    ok(res, updated);
  } catch (error) {
    fail(res, toAppError(error));
  }
});

profilesRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await profilesService.deleteProfileById(id);
    if (!result.ok) {
      if (result.reason === "last") {
        return fail(
          res,
          conflict(
            "Cannot delete the last profile — at least one is required.",
          ),
        );
      }
      return fail(res, notFound(`Profile not found: ${id}`));
    }
    ok(res, { id });
  } catch (error) {
    fail(res, toAppError(error));
  }
});

profilesRouter.post("/:id/set-default", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const profile = await profilesService.setDefaultProfile(id);
    if (!profile) {
      return fail(res, notFound(`Profile not found: ${id}`));
    }
    ok(res, { defaultProfileId: profile.id });
  } catch (error) {
    fail(res, toAppError(error));
  }
});

profilesRouter.post("/:id/duplicate", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const duplicated = await profilesService.duplicateProfile(id);
    if (!duplicated) {
      return fail(res, notFound(`Profile not found: ${id}`));
    }
    ok(res, duplicated);
  } catch (error) {
    fail(res, toAppError(error));
  }
});
