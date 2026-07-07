import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface NumberFieldProps {
  id: string;
  label: string;
  min: number;
  max: number;
  /** String-valued to preserve the draft/typing behavior of the Run modal. */
  value: string;
  onChange: (value: string) => void;
}

export function NumberField({
  id,
  label,
  min,
  max,
  value,
  onChange,
}: NumberFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
