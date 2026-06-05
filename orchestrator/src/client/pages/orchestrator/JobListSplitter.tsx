import { ChevronLeft, ChevronRight } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";

interface JobListSplitterProps {
  onDrag: (event: React.PointerEvent<HTMLElement>) => void;
  isDragging: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
}

/**
 * Thin drag-only hairline between the job list and the detail panel.
 * Show/hide is handled by `JobListToggleBar`, which sits as a separate
 * column to the right of this splitter and is always visible (so the
 * collapse and reveal affordances share the same clickable bar).
 */
export const JobListSplitter: React.FC<JobListSplitterProps> = ({
  onDrag,
  isDragging,
  width,
  minWidth,
  maxWidth,
}) => {
  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: separator role on a div is the correct ARIA mapping for a resizable splitter
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      onPointerDown={onDrag}
      className={cn(
        "group relative flex cursor-col-resize select-none items-stretch justify-center self-stretch px-1",
        isDragging && "bg-foreground/5",
      )}
    >
      <div
        className={cn(
          "h-full w-px bg-border/60 transition-colors",
          "group-hover:bg-foreground/40",
          isDragging && "bg-foreground/60",
        )}
      />
    </div>
  );
};

interface JobListToggleBarProps {
  isVisible: boolean;
  onClick: () => void;
}

/**
 * Always-visible bar that toggles the job list panel. Same dimensions
 * and click target in both states — the only thing that changes is the
 * chevron direction (left = currently visible, click to hide; right =
 * currently hidden, click to show).
 */
export const JobListToggleBar: React.FC<JobListToggleBarProps> = ({
  isVisible,
  onClick,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isVisible ? "Hide job list" : "Show job list"}
      title={isVisible ? "Hide job list" : "Show job list"}
      className={cn(
        "flex w-6 cursor-pointer items-center justify-center self-stretch",
        "rounded-l-md border border-r-0 border-border/40 bg-muted/30 text-muted-foreground",
        "transition-colors hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {isVisible ? (
        <ChevronLeft className="h-4 w-4" />
      ) : (
        <ChevronRight className="h-4 w-4" />
      )}
    </button>
  );
};
