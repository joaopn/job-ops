import type { JobOutcome } from "@shared/types.js";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const REASONS: Array<{ outcome: JobOutcome; label: string }> = [
  { outcome: "rejected", label: "Rejected" },
  { outcome: "withdrawn", label: "Withdrew" },
  { outcome: "ghosted", label: "Ghosted" },
  { outcome: "other", label: "Other" },
];

interface MarkClosedPopoverProps {
  trigger: React.ReactNode;
  onSelect: (outcome: JobOutcome) => void | Promise<void>;
  disabled?: boolean;
}

export const MarkClosedPopover: React.FC<MarkClosedPopoverProps> = ({
  trigger,
  onSelect,
  disabled,
}) => {
  const [open, setOpen] = useState(false);

  const handleSelect = async (outcome: JobOutcome) => {
    setOpen(false);
    await onSelect(outcome);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="end">
        <div className="px-2 pb-1 pt-1 text-xs text-muted-foreground">
          Reason to close:
        </div>
        <div className="flex flex-col gap-1">
          {REASONS.map(({ outcome, label }) => (
            <Button
              key={outcome}
              type="button"
              size="sm"
              variant="ghost"
              className="justify-start"
              onClick={() => {
                void handleSelect(outcome);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
