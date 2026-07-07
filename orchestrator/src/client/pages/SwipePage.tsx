/**
 * Mobile-first "Swipe" surface: a Tinder-style deck for triaging the
 * discovered-job inbox. Shares the job-status model and pipeline with the
 * full "Manage" orchestrator; only the presentation differs.
 */

import { PageHeader } from "@client/components/layout";
import { PipelineProgressStrip } from "@client/components/PipelineProgressStrip";
import { ViewToggle } from "@client/components/ViewToggle";
import { Loader2, Play, Square } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import { useOrchestratorData } from "./orchestrator/useOrchestratorData";
import { usePipelineControls } from "./orchestrator/usePipelineControls";
import { SwipeDeck } from "./swipe/SwipeDeck";

export const SwipePage: React.FC = () => {
  const { isPipelineRunning, setIsPipelineRunning, pipelineTerminalEvent } =
    useOrchestratorData(null);

  const { isCancelling, runPipelineNow, handleCancelPipeline } =
    usePipelineControls({
      isPipelineRunning,
      setIsPipelineRunning,
      pipelineTerminalEvent,
    });

  const actions = isPipelineRunning ? (
    <Button
      size="sm"
      variant="destructive"
      onClick={handleCancelPipeline}
      disabled={isCancelling}
      className="gap-2"
    >
      {isCancelling ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Square className="h-4 w-4" />
      )}
      <span className="hidden sm:inline">Cancel run</span>
    </Button>
  ) : (
    <Button size="sm" onClick={runPipelineNow} className="gap-2">
      <Play className="h-4 w-4" />
      <span className="hidden sm:inline">Run pipeline</span>
    </Button>
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      <PageHeader
        icon={() => (
          <img src="/favicon.png" alt="" className="size-8 rounded-lg" />
        )}
        title="Job Ops"
        subtitle="Swipe"
        titleSlot={<ViewToggle />}
        actions={actions}
        fullWidth
        inlineActions
      />

      <PipelineProgressStrip isRunning={isPipelineRunning} />

      <main className="flex min-h-0 flex-1 flex-col px-4 pb-[env(safe-area-inset-bottom)] pt-4">
        <SwipeDeck
          pipelineTerminalEvent={pipelineTerminalEvent}
          isPipelineRunning={isPipelineRunning}
          onRunPipeline={runPipelineNow}
        />
      </main>
    </div>
  );
};
