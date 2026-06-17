/**
 * Composes the Swipe deck: the top draggable card (with a peek of the next
 * one behind), the action bar, and the loading / empty / error states.
 */

import { Loader2, Play } from "lucide-react";
import type React from "react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { FitCountChips } from "./FitCountChips";
import { SwipeActionBar } from "./SwipeActionBar";
import { SwipeCard, SwipeCardContent, type SwipeCardHandle } from "./SwipeCard";
import { useSwipeDeck } from "./useSwipeDeck";

interface SwipeDeckProps {
  pipelineTerminalEvent: { status: string; errorMessage: string | null } | null;
  isPipelineRunning: boolean;
  onRunPipeline: () => void;
}

export const SwipeDeck: React.FC<SwipeDeckProps> = ({
  pipelineTerminalEvent,
  isPipelineRunning,
  onRunPipeline,
}) => {
  const { cards, isLoading, isError, act, canUndo, undo, refetch } =
    useSwipeDeck({
      pipelineTerminalEvent,
      isPipelineRunning,
    });
  const cardRef = useRef<SwipeCardHandle>(null);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">Couldn't load the inbox.</p>
        <Button variant="outline" size="sm" onClick={refetch}>
          Retry
        </Button>
      </div>
    );
  }

  const top = cards[0];
  const next = cards[1];

  if (!top) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-base font-medium">Inbox empty</p>
        <p className="text-sm text-muted-foreground">
          Run the pipeline to discover new jobs to triage.
        </p>
        <Button onClick={onRunPipeline} disabled={isPipelineRunning} className="gap-2">
          {isPipelineRunning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {isPipelineRunning ? "Running…" : "Run pipeline"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pb-4">
      <FitCountChips jobs={cards} />
      <div className="relative mx-auto min-h-0 w-full max-w-md flex-1">
        {next && (
          <div className="pointer-events-none absolute inset-0 scale-[0.97] opacity-90">
            <SwipeCardContent job={next} />
          </div>
        )}
        <SwipeCard
          key={top.id}
          ref={cardRef}
          job={top}
          onCommit={(action) => act(top, action)}
        />
      </div>
      <SwipeActionBar
        disabled={false}
        canUndo={canUndo}
        onSkip={() => cardRef.current?.flyOut("skip")}
        onBacklog={() => cardRef.current?.flyOut("move_to_backlog")}
        onTailor={() => cardRef.current?.flyOut("move_to_ready")}
        onUndo={undo}
      />
    </div>
  );
};
