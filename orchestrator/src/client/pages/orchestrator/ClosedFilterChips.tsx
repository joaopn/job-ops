import type React from "react";
import { Button } from "@/components/ui/button";
import type { ClosedSubFilter } from "./constants";

const CHIPS: Array<{ value: ClosedSubFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "skipped", label: "Skipped" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
  { value: "ghosted", label: "Ghosted" },
  { value: "other", label: "Other" },
];

interface ClosedFilterChipsProps {
  value: ClosedSubFilter;
  onChange: (next: ClosedSubFilter) => void;
}

export const ClosedFilterChips: React.FC<ClosedFilterChipsProps> = ({
  value,
  onChange,
}) => (
  <div className="flex flex-wrap items-center gap-1.5 border-b border-border/40 px-4 py-2">
    {CHIPS.map((chip) => (
      <Button
        key={chip.value}
        type="button"
        size="sm"
        variant={value === chip.value ? "default" : "outline"}
        className="h-7 px-2.5 text-xs"
        onClick={() => onChange(chip.value)}
      >
        {chip.label}
      </Button>
    ))}
  </div>
);
