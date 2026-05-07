import { useLlmCallQueue } from "@client/hooks/useLlmCallQueue";
import { LlmCallQueueSheet } from "@client/pages/orchestrator/LlmCallQueueSheet";
import { Activity } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Self-contained "LLM" button + queue sheet. Subscribes to the live
 * LLM call SSE feed, shows a small badge with the active count, and
 * opens the existing `LlmCallQueueSheet` on click. Drops into any
 * page's `PageHeader` actions slot so users can monitor in-flight
 * extraction / tailoring / generate calls from anywhere — not just
 * the orchestrator page.
 */
export const LlmStatusButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const { active, recent, connected } = useLlmCallQueue(true);

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="relative gap-2"
        aria-label="LLM call queue"
      >
        <Activity className="h-4 w-4" />
        <span className="hidden sm:inline">LLM</span>
        {active.length > 0 && (
          <Badge
            variant="default"
            className="h-5 min-w-[1.25rem] justify-center px-1 text-[10px]"
          >
            {active.length}
          </Badge>
        )}
      </Button>
      <LlmCallQueueSheet
        open={open}
        onOpenChange={setOpen}
        active={active}
        recent={recent}
        connected={connected}
      />
    </>
  );
};
