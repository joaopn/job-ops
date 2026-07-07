import {
  formatCountryLabel,
  SUPPORTED_COUNTRY_KEYS,
} from "@shared/location-support.js";
import { type ReactNode, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { SearchableDropdown } from "@/components/ui/searchable-dropdown";

const HIDDEN_COUNTRY_KEYS = new Set(["usa/ca"]);

interface CountryFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Suggestion/validation-dependent message rendered below the dropdown. */
  error?: ReactNode;
}

export function CountryField({ value, onChange, error }: CountryFieldProps) {
  const options = useMemo(
    () =>
      SUPPORTED_COUNTRY_KEYS.filter(
        (country) => !HIDDEN_COUNTRY_KEYS.has(country),
      ).map((country) => ({
        value: country,
        label: formatCountryLabel(country),
      })),
    [],
  );

  return (
    <div className="space-y-2">
      <Label className="text-base font-semibold">Country</Label>
      <SearchableDropdown
        value={value}
        options={options}
        onValueChange={onChange}
        placeholder="Select country"
        searchPlaceholder="Search country..."
        emptyText="No matching countries."
        triggerClassName="h-10 w-full"
        ariaLabel={value ? formatCountryLabel(value) : "Select country"}
      />
      {error}
    </div>
  );
}
