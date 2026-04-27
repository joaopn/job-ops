/**
 * API routes for the orchestrator.
 */

import { Router } from "express";
import { authRouter } from "./routes/auth";
import { cvRouter } from "./routes/cv";
import { databaseRouter } from "./routes/database";
import { extractorHealthRouter } from "./routes/extractor-health";
import { ghostwriterRouter } from "./routes/ghostwriter";
import { jobsRouter } from "./routes/jobs";
import { manualJobsRouter } from "./routes/manual-jobs";
import { onboardingRouter } from "./routes/onboarding";
import { pipelineRouter } from "./routes/pipeline";
import { settingsRouter } from "./routes/settings";

export const apiRouter = Router();

apiRouter.use("/jobs", jobsRouter);
apiRouter.use("/jobs/:id/chat", ghostwriterRouter);
apiRouter.use("/settings", settingsRouter);
apiRouter.use("/pipeline", pipelineRouter);
apiRouter.use("/manual-jobs", manualJobsRouter);
apiRouter.use("/cv", cvRouter);
apiRouter.use("/database", databaseRouter);
apiRouter.use("/onboarding", onboardingRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/", extractorHealthRouter);
