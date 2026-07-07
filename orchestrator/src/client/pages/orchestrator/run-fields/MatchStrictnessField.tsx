import type { LocationMatchStrictness } from "@shared/location-preferences.js";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { MATCH_STRICTNESS_OPTIONS } from "../automatic-run";
import { getRadioOptionClassName } from "./helpers";

interface MatchStrictnessFieldProps {
  value: LocationMatchStrictness;
  onChange: (value: LocationMatchStrictness) => void;
}

export function MatchStrictnessField({
  value,
  onChange,
}: MatchStrictnessFieldProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Match strictness
      </p>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as LocationMatchStrictness)}
        className="gap-2"
      >
        {MATCH_STRICTNESS_OPTIONS.map((option) => {
          const id = `match-strictness-${option.value}`;
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={getRadioOptionClassName(selected)}
            >
              <RadioGroupItem value={option.value} id={id} />
              <span className="text-sm font-medium">{option.label}</span>
            </label>
          );
        })}
      </RadioGroup>
    </div>
  );
}
