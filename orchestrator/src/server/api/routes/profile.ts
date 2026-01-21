import { Router, Request, Response } from 'express';
import { extractProjectsFromProfile, loadResumeProfile } from '../../services/resumeProjects.js';

export const profileRouter = Router();

/**
 * GET /api/profile/projects - Get all projects available in the base resume
 */
profileRouter.get('/projects', async (req: Request, res: Response) => {
  try {
    const profile = await loadResumeProfile();
    const { catalog } = extractProjectsFromProfile(profile);
    res.json({ success: true, data: catalog });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/profile - Get the full base resume profile
 */
profileRouter.get('/', async (req: Request, res: Response) => {
  try {
    const profile = await loadResumeProfile();
    res.json({ success: true, data: profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});
