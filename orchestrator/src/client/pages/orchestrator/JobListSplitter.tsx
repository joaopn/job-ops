import { ChevronLeft, ChevronRight } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";

interface JobListSplitterProps {
  onDrag: (event: React.PointerEvent<HTMLElement>) => void;
  onCollapse: () => void;
  isDragging: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
}

export const JobListSplitter: React.FC<JobListSplitterProps> = ({
  onDrag,
  onCollapse,
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
        "group relative flex cursor-col-resize select-none items-stretch justify-center self-stretch",
        "lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)]",
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
      <button
        type="button"
        onClick={onCollapse}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label="Hide job list"
        title="Hide job list"
        className={cn(
          "absolute top-6 left-1/2 -translate-x-1/2",
          "flex h-6 w-6 cursor-pointer items-center justify-center rounded-full",
          "border border-border bg-background text-muted-foreground shadow-sm",
          "opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

interface JobListRevealTabProps {
  onClick: () => void;
}

export const JobListRevealTab: React.FC<JobListRevealTabProps> = ({
  onClick,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Show job list"
      title="Show job list"
      className={cn(
        "flex w-6 cursor-pointer items-center justify-center self-stretch",
        "rounded-l-md border border-r-0 border-border/40 bg-muted/30 text-muted-foreground",
        "transition-colors hover:bg-muted/60 hover:text-foreground",
        "lg:sticky lg:top-24 lg:h-[calc(100vh-8rem)] lg:self-start",
      )}
    >
      <ChevronRight className="h-4 w-4" />
    </button>
  );
};
