import type React from "react";
import { cn } from "@/lib/utils";

interface TailorColumnSplitterProps {
  onDrag: (event: React.PointerEvent<HTMLElement>) => void;
  isDragging: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
}

export const TailorColumnSplitter: React.FC<TailorColumnSplitterProps> = ({
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
        "group relative flex cursor-col-resize select-none items-stretch justify-center self-stretch",
        "px-1",
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
