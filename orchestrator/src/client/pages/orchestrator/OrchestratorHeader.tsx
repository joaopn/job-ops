import { PageHeader, StatusIndicator } from "@client/components/layout";
import type { JobSource } from "@shared/types.js";
import { Activity, Link as LinkIcon, Loader2, Play, Square } from "lucide-react";
import type React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface OrchestratorHeaderProps {
  navOpen: boolean;
  onNavOpenChange: (open: boolean) => void;
  isPipelineRunning: boolean;
  isCancelling: boolean;
  pipelineSources: JobSource[];
  onOpenAutomaticRun: () => void;
  onOpenBatchUrlImport: () => void;
  onOpenLlmQueue: () => void;
  llmActiveCount: number;
  onCancelPipeline: () => void;
}

export const OrchestratorHeader: React.FC<OrchestratorHeaderProps> = ({
  navOpen,
  onNavOpenChange,
  isPipelineRunning,
  isCancelling,
  pipelineSources,
  onOpenAutomaticRun,
  onOpenBatchUrlImport,
  onOpenLlmQueue,
  llmActiveCount,
  onCancelPipeline,
}) => {
  const queueButton = (
    <Button
      size="sm"
      variant="outline"
      onClick={onOpenLlmQueue}
      className="relative gap-2"
      aria-label="LLM call queue"
    >
      <Activity className="h-4 w-4" />
      <span className="hidden sm:inline">LLM</span>
      {llmActiveCount > 0 && (
        <Badge
          variant="default"
          className="h-5 min-w-[1.25rem] justify-center px-1 text-[10px]"
        >
          {llmActiveCount}
        </Badge>
      )}
    </Button>
  );

  const actions = isPipelineRunning ? (
    <div className="flex items-center gap-2">
      {queueButton}
      <Button
        size="sm"
        onClick={onCancelPipeline}
        disabled={isCancelling}
        variant="destructive"
        className="gap-2"
      >
        {isCancelling ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Square className="h-4 w-4" />
        )}
        <span className="hidden sm:inline">
          {isCancelling
            ? `Cancelling (${pipelineSources.length})`
            : `Cancel run`}
        </span>
      </Button>
    </div>
  ) : (
    <div className="flex items-center gap-2">
      {queueButton}
      <Button
        size="sm"
        variant="outline"
        onClick={onOpenBatchUrlImport}
        className="gap-2"
      >
        <LinkIcon className="h-4 w-4" />
        <span className="hidden sm:inline">Fetch URLs</span>
      </Button>
      <Button size="sm" onClick={onOpenAutomaticRun} className="gap-2">
        <Play className="h-4 w-4" />
        <span className="hidden sm:inline">Run pipeline</span>
      </Button>
    </div>
  );

  return (
    <PageHeader
      icon={() => (
        <img src="/favicon.png" alt="" className="size-8 rounded-lg" />
      )}
      title="Job Ops"
      subtitle="Orchestrator"
      navOpen={navOpen}
      onNavOpenChange={onNavOpenChange}
      statusIndicator={
        isPipelineRunning ? (
          <StatusIndicator label="Pipeline running" variant="amber" />
        ) : undefined
      }
      actions={actions}
    />
  );
};
