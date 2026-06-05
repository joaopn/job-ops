/**
 * Bottom action bar for the Swipe deck — tap-target equivalents of the
 * swipe gestures, plus the gesture-less Backlog action.
 */

import { Archive, Check, X } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";

interface SwipeActionBarProps {
  disabled: boolean;
  onSkip: () => void;
  onBacklog: () => void;
  onSelect: () => void;
}

export const SwipeActionBar: React.FC<SwipeActionBarProps> = ({
  disabled,
  onSkip,
  onBacklog,
  onSelect,
}) => {
  return (
    <div className="flex items-center justify-center gap-6 px-4">
      <Button
        type="button"
        size="icon"
        variant="outline"
        disabled={disabled}
        onClick={onSkip}
        aria-label="Skip"
        className="h-14 w-14 rounded-full border-rose-500/40 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
      >
        <X className="h-6 w-6" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="outline"
        disabled={disabled}
        onClick={onBacklog}
        aria-label="Move to backlog"
        className="h-12 w-12 rounded-full text-muted-foreground"
      >
        <Archive className="h-5 w-5" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="outline"
        disabled={disabled}
        onClick={onSelect}
        aria-label="Select"
        className="h-14 w-14 rounded-full border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
      >
        <Check className="h-6 w-6" />
      </Button>
    </div>
  );
};
