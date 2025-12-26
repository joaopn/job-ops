/**
 * API routes for the orchestrator.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import * as jobsRepo from '../repositories/jobs.js';
import * as pipelineRepo from '../repositories/pipeline.js';
import * as settingsRepo from '../repositories/settings.js';
import { runPipeline, processJob, getPipelineStatus, subscribeToProgress, getProgress } from '../pipeline/index.js';
import { createNotionEntry } from '../services/notion.js';
import { clearDatabase } from '../db/clear.js';
import {
  extractProjectsFromProfile,
  loadResumeProfile,
  normalizeResumeProjectsSettings,
  resolveResumeProjectsSettings,
} from '../services/resumeProjects.js';
import type { Job, JobStatus, ApiResponse, JobsListResponse, PipelineStatusResponse } from '../../shared/types.js';

export const apiRouter = Router();

async function notifyJobCompleteWebhook(job: Job) {
  const overrideWebhookUrl = await settingsRepo.getSetting('jobCompleteWebhookUrl')
  const webhookUrl = (overrideWebhookUrl || process.env.JOB_COMPLETE_WEBHOOK_URL || '').trim()
  if (!webhookUrl) return

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const secret = process.env.WEBHOOK_SECRET
    if (secret) headers.Authorization = `Bearer ${secret}`

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event: 'job.completed',
        sentAt: new Date().toISOString(),
        job,
      }),
    })

    if (!response.ok) {
      console.warn(`⚠️ Job complete webhook POST failed (${response.status}): ${await response.text()}`)
    }
  } catch (error) {
    console.warn('⚠️ Job complete webhook POST failed:', error)
  }
}

// ============================================================================
// Jobs API
// ============================================================================

/**
 * GET /api/jobs - List all jobs
 * Query params: status (comma-separated list of statuses to filter)
 */
apiRouter.get('/jobs', async (req: Request, res: Response) => {
  try {
    const statusFilter = req.query.status as string | undefined;
    const statuses = statusFilter?.split(',').filter(Boolean) as JobStatus[] | undefined;

    const jobs = await jobsRepo.getAllJobs(statuses);
    const stats = await jobsRepo.getJobStats();

    const response: ApiResponse<JobsListResponse> = {
      success: true,
      data: {
        jobs,
        total: jobs.length,
        byStatus: stats,
      },
    };

    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/jobs/:id - Get a single job
 */
apiRouter.get('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const job = await jobsRepo.getJobById(req.params.id);

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    res.json({ success: true, data: job });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * PATCH /api/jobs/:id - Update a job
 */
const updateJobSchema = z.object({
  status: z.enum(['discovered', 'processing', 'ready', 'applied', 'rejected', 'expired']).optional(),
  suitabilityScore: z.number().min(0).max(100).optional(),
  suitabilityReason: z.string().optional(),
  tailoredSummary: z.string().optional(),
  pdfPath: z.string().optional(),
});

apiRouter.patch('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const input = updateJobSchema.parse(req.body);
    const job = await jobsRepo.updateJob(req.params.id, input);

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    res.json({ success: true, data: job });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.message });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/jobs/:id/process - Process a single job (generate summary + PDF)
 */
apiRouter.post('/jobs/:id/process', async (req: Request, res: Response) => {
  try {
    const forceRaw = req.query.force as string | undefined;
    const force = forceRaw === '1' || forceRaw === 'true';

    const result = await processJob(req.params.id, { force });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    const job = await jobsRepo.getJobById(req.params.id);
    res.json({ success: true, data: job });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/jobs/:id/apply - Mark a job as applied and sync to Notion
 */
apiRouter.post('/jobs/:id/apply', async (req: Request, res: Response) => {
  try {
    const job = await jobsRepo.getJobById(req.params.id);

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    const appliedAt = new Date().toISOString();

    // Sync to Notion
    const notionResult = await createNotionEntry({
      id: job.id,
      title: job.title,
      employer: job.employer,
      applicationLink: job.applicationLink,
      deadline: job.deadline,
      salary: job.salary,
      location: job.location,
      pdfPath: job.pdfPath,
      appliedAt,
    });

    // Update job status
    const updatedJob = await jobsRepo.updateJob(job.id, {
      status: 'applied',
      appliedAt,
      notionPageId: notionResult.pageId,
    });

    if (updatedJob) {
      notifyJobCompleteWebhook(updatedJob).catch(console.warn)
    }

    res.json({ success: true, data: updatedJob });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/jobs/:id/reject - Mark a job as rejected
 */
apiRouter.post('/jobs/:id/reject', async (req: Request, res: Response) => {
  try {
    const job = await jobsRepo.updateJob(req.params.id, { status: 'rejected' });

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    res.json({ success: true, data: job });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

// ============================================================================
// Pipeline API
// ============================================================================

/**
 * GET /api/settings - Get app settings (effective + defaults)
 */
apiRouter.get('/settings', async (_req: Request, res: Response) => {
  try {
    const overrideModel = await settingsRepo.getSetting('model');
    const defaultModel = process.env.MODEL || 'openai/gpt-4o-mini';
    const model = overrideModel || defaultModel;

    const overridePipelineWebhookUrl = await settingsRepo.getSetting('pipelineWebhookUrl');
    const defaultPipelineWebhookUrl = process.env.PIPELINE_WEBHOOK_URL || process.env.WEBHOOK_URL || '';
    const pipelineWebhookUrl = overridePipelineWebhookUrl || defaultPipelineWebhookUrl;

    const overrideJobCompleteWebhookUrl = await settingsRepo.getSetting('jobCompleteWebhookUrl');
    const defaultJobCompleteWebhookUrl = process.env.JOB_COMPLETE_WEBHOOK_URL || '';
    const jobCompleteWebhookUrl = overrideJobCompleteWebhookUrl || defaultJobCompleteWebhookUrl;

    const profile = await loadResumeProfile();
    const { catalog } = extractProjectsFromProfile(profile);
    const overrideResumeProjectsRaw = await settingsRepo.getSetting('resumeProjects');
    const resumeProjectsData = resolveResumeProjectsSettings({ catalog, overrideRaw: overrideResumeProjectsRaw });

    res.json({
      success: true,
      data: {
        model,
        defaultModel,
        overrideModel,
        pipelineWebhookUrl,
        defaultPipelineWebhookUrl,
        overridePipelineWebhookUrl,
        jobCompleteWebhookUrl,
        defaultJobCompleteWebhookUrl,
        overrideJobCompleteWebhookUrl,
        ...resumeProjectsData,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

const updateSettingsSchema = z.object({
  model: z.string().trim().min(1).max(200).nullable().optional(),
  pipelineWebhookUrl: z.string().trim().min(1).max(2000).nullable().optional(),
  jobCompleteWebhookUrl: z.string().trim().min(1).max(2000).nullable().optional(),
  resumeProjects: z.object({
    maxProjects: z.number().int().min(0).max(50),
    lockedProjectIds: z.array(z.string().trim().min(1)).max(200),
    aiSelectableProjectIds: z.array(z.string().trim().min(1)).max(200),
  }).nullable().optional(),
});

/**
 * PATCH /api/settings - Update settings overrides
 */
apiRouter.patch('/settings', async (req: Request, res: Response) => {
  try {
    const input = updateSettingsSchema.parse(req.body);

    if ('model' in input) {
      const model = input.model ?? null;
      await settingsRepo.setSetting('model', model);
    }

    if ('pipelineWebhookUrl' in input) {
      const pipelineWebhookUrl = input.pipelineWebhookUrl ?? null;
      await settingsRepo.setSetting('pipelineWebhookUrl', pipelineWebhookUrl);
    }

    if ('jobCompleteWebhookUrl' in input) {
      const webhookUrl = input.jobCompleteWebhookUrl ?? null;
      await settingsRepo.setSetting('jobCompleteWebhookUrl', webhookUrl);
    }

    if ('resumeProjects' in input) {
      const resumeProjects = input.resumeProjects ?? null;

      if (resumeProjects === null) {
        await settingsRepo.setSetting('resumeProjects', null);
      } else {
        const profile = await loadResumeProfile();
        const { catalog } = extractProjectsFromProfile(profile);
        const allowed = new Set(catalog.map((p) => p.id));
        const normalized = normalizeResumeProjectsSettings(resumeProjects, allowed);
        await settingsRepo.setSetting('resumeProjects', JSON.stringify(normalized));
      }
    }

    const overrideModel = await settingsRepo.getSetting('model');
    const defaultModel = process.env.MODEL || 'openai/gpt-4o-mini';
    const model = overrideModel || defaultModel;

    const overridePipelineWebhookUrl = await settingsRepo.getSetting('pipelineWebhookUrl');
    const defaultPipelineWebhookUrl = process.env.PIPELINE_WEBHOOK_URL || process.env.WEBHOOK_URL || '';
    const pipelineWebhookUrl = overridePipelineWebhookUrl || defaultPipelineWebhookUrl;

    const overrideJobCompleteWebhookUrl = await settingsRepo.getSetting('jobCompleteWebhookUrl');
    const defaultJobCompleteWebhookUrl = process.env.JOB_COMPLETE_WEBHOOK_URL || '';
    const jobCompleteWebhookUrl = overrideJobCompleteWebhookUrl || defaultJobCompleteWebhookUrl;

    const profile = await loadResumeProfile();
    const { catalog } = extractProjectsFromProfile(profile);
    const overrideResumeProjectsRaw = await settingsRepo.getSetting('resumeProjects');
    const resumeProjectsData = resolveResumeProjectsSettings({ catalog, overrideRaw: overrideResumeProjectsRaw });

    res.json({
      success: true,
      data: {
        model,
        defaultModel,
        overrideModel,
        pipelineWebhookUrl,
        defaultPipelineWebhookUrl,
        overridePipelineWebhookUrl,
        jobCompleteWebhookUrl,
        defaultJobCompleteWebhookUrl,
        overrideJobCompleteWebhookUrl,
        ...resumeProjectsData,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ success: false, error: message });
  }
});

/**
 * GET /api/pipeline/status - Get pipeline status
 */
apiRouter.get('/pipeline/status', async (req: Request, res: Response) => {
  try {
    const { isRunning } = getPipelineStatus();
    const lastRun = await pipelineRepo.getLatestPipelineRun();

    const response: ApiResponse<PipelineStatusResponse> = {
      success: true,
      data: {
        isRunning,
        lastRun,
        nextScheduledRun: null, // Would come from n8n
      },
    };

    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/pipeline/progress - Server-Sent Events endpoint for live progress
 */
apiRouter.get('/pipeline/progress', (req: Request, res: Response) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering

  // Send initial progress
  const sendProgress = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Subscribe to progress updates
  const unsubscribe = subscribeToProgress(sendProgress);

  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  // Cleanup on close
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

/**
 * GET /api/pipeline/runs - Get recent pipeline runs
 */
apiRouter.get('/pipeline/runs', async (req: Request, res: Response) => {
  try {
    const runs = await pipelineRepo.getRecentPipelineRuns(20);
    res.json({ success: true, data: runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * POST /api/pipeline/run - Trigger the pipeline manually
 */
const runPipelineSchema = z.object({
  topN: z.number().min(1).max(50).optional(),
  minSuitabilityScore: z.number().min(0).max(100).optional(),
  sources: z.array(z.enum(['gradcracker', 'indeed', 'linkedin', 'ukvisajobs'])).min(1).optional(),
});

apiRouter.post('/pipeline/run', async (req: Request, res: Response) => {
  try {
    const config = runPipelineSchema.parse(req.body);

    // Start pipeline in background
    runPipeline(config).catch(console.error);

    res.json({
      success: true,
      data: { message: 'Pipeline started' }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: error.message });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

// ============================================================================
// Webhook for n8n
// ============================================================================

/**
 * POST /api/webhook/trigger - Webhook endpoint for n8n to trigger the pipeline
 */
apiRouter.post('/webhook/trigger', async (req: Request, res: Response) => {
  // Optional: Add authentication check
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.WEBHOOK_SECRET;

  if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  try {
    // Start pipeline in background
    runPipeline().catch(console.error);

    res.json({
      success: true,
      data: {
        message: 'Pipeline triggered',
        triggeredAt: new Date().toISOString(),
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

// ============================================================================
// Database Management
// ============================================================================

/**
 * DELETE /api/database - Clear all data from the database
 */
apiRouter.delete('/database', async (req: Request, res: Response) => {
  try {
    const result = clearDatabase();

    res.json({
      success: true,
      data: {
        message: 'Database cleared',
        jobsDeleted: result.jobsDeleted,
        runsDeleted: result.runsDeleted,
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});
