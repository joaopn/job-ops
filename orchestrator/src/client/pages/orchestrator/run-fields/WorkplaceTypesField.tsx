import { Checkbox } from "@/components/ui/checkbox";
import { WORKPLACE_TYPE_OPTIONS, type WorkplaceType } from "../automatic-run";
import { formatWorkplaceTypeLabel } from "./helpers";

interface WorkplaceTypesFieldProps {
  value: WorkplaceType[];
  /**
   * Fires per checkbox change. The parent owns the add/remove policy
   * (normalize-on-add, plain-filter-on-remove) — this component must NOT
   * re-normalize, or unchecking all three would refill to the full set.
   */
  onToggle: (workplaceType: WorkplaceType, checked: boolean) => void;
  invalid?: boolean;
}

export function WorkplaceTypesField({
  value,
  onToggle,
  invalid,
}: WorkplaceTypesFieldProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Work arrangement
      </p>
      <div className="flex flex-wrap gap-2 gap-x-4">
        {WORKPLACE_TYPE_OPTIONS.map((workplaceType) => {
          const checkboxId = `workplace-type-${workplaceType}`;
          const checked = value.includes(workplaceType);

          return (
            <label
              key={workplaceType}
              htmlFor={checkboxId}
              className="flex cursor-pointer items-center gap-3 text-sm transition-colors"
            >
              <Checkbox
                id={checkboxId}
                checked={checked}
                onCheckedChange={(nextChecked) => {
                  onToggle(workplaceType, nextChecked === true);
                }}
              />
              {formatWorkplaceTypeLabel(workplaceType)}
            </label>
          );
        })}
      </div>
      {invalid ? (
        <p className="text-xs text-destructive">
          Select at least one workplace type.
        </p>
      ) : null}
    </div>
  );
}
