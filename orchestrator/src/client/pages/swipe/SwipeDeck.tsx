/**
 * Composes the Swipe deck: the top draggable card (with a peek of the next
 * one behind), the action bar, and the loading / empty / error states.
 */

import { Loader2, Play } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import { SwipeActionBar } from "./SwipeActionBar";
import { SwipeCard } from "./SwipeCard";
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
  const { cards, isLoading, isError, act, refetch } = useSwipeDeck({
    pipelineTerminalEvent,
  });

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
    <div className="flex min-h-0 flex-1 flex-col gap-4 pb-4">
      <div className="relative mx-auto min-h-0 w-full max-w-md flex-1">
        {next && (
          <div className="absolute inset-0 translate-y-2 scale-[0.96] rounded-xl border bg-card/60" />
        )}
        <SwipeCard
          key={top.id}
          job={top}
          onSelect={() => act(top, "move_to_selected")}
          onSkip={() => act(top, "skip")}
        />
      </div>
      <SwipeActionBar
        disabled={false}
        onSkip={() => act(top, "skip")}
        onBacklog={() => act(top, "move_to_backlog")}
        onSelect={() => act(top, "move_to_selected")}
      />
    </div>
  );
};
