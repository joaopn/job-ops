import type { Profile } from "@shared/types";
import type React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProfileSelectProps {
  profiles: Profile[];
  selectedProfileId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

/**
 * Header dropdown that picks the active Profile. Presentational — the query,
 * selection state, and set-default mutation live in `useSelectedProfile`.
 */
export const ProfileSelect: React.FC<ProfileSelectProps> = ({
  profiles,
  selectedProfileId,
  onSelect,
  disabled,
}) => {
  if (profiles.length === 0) return null;

  return (
    <Select
      value={selectedProfileId ?? undefined}
      onValueChange={onSelect}
      disabled={disabled}
    >
      <SelectTrigger className="h-8 w-[10rem]" aria-label="Active profile">
        <SelectValue placeholder="Profile" />
      </SelectTrigger>
      <SelectContent>
        {profiles.map((profile) => (
          <SelectItem key={profile.id} value={profile.id}>
            {profile.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
