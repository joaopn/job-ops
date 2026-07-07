import type { WorkplaceType } from "../automatic-run";

export function formatWorkplaceTypeLabel(workplaceType: WorkplaceType): string {
  if (workplaceType === "onsite") return "Onsite";
  return workplaceType.charAt(0).toUpperCase() + workplaceType.slice(1);
}

export function getRadioOptionClassName(selected: boolean): string {
  return `flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 text-sm transition-colors ${
    selected
      ? "border-border/70 bg-muted/20 text-foreground"
      : "border-border/60 text-foreground hover:bg-muted/20"
  }`;
}
