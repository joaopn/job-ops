import { PipelineProgress } from "@client/components";
import type { JobStatus } from "@shared/types.js";
import type React from "react";

interface OrchestratorSummaryProps {
  stats: Record<JobStatus, number>;
  isPipelineRunning: boolean;
}

export const OrchestratorSummary: React.FC<OrchestratorSummaryProps> = ({
  isPipelineRunning,
}) => {
  if (!isPipelineRunning) return null;

  return (
    <section className="space-y-4">
      <div className="max-w-3xl">
        <PipelineProgress isRunning={isPipelineRunning} />
      </div>
    </section>
  );
};
