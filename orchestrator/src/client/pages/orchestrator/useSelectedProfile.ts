import * as api from "@client/api";
import { queryKeys } from "@client/lib/queryKeys";
import { toast } from "@client/lib/toast";
import type { Profile } from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export type UseSelectedProfileResult = {
  profiles: Profile[];
  selectedProfileId: string | null;
  setSelected: (id: string) => void;
  isLoading: boolean;
};

/**
 * Owns which Profile the header dropdown shows and drives runs with. The
 * selection is persisted server-side (`setDefaultProfile`) so it survives
 * reload and affects every future run, while a local `override` reflects the
 * pick synchronously — the run passes `selectedProfileId` explicitly so a
 * select-then-run can't race the in-flight set-default mutation.
 *
 * `selectedProfileId` mirrors the server resolver: an explicit local pick, else
 * the persisted default, else the most-recent profile (getProfiles is ordered
 * updated_at DESC), else null. There is no hydrate effect, so a local pick
 * wins over an external default change until remount — intended.
 */
export function useSelectedProfile(): UseSelectedProfileResult {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.profiles.list(),
    queryFn: api.getProfiles,
  });
  const [override, setOverride] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (id: string) => api.setDefaultProfile(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Failed to select profile",
      );
    },
  });

  const profiles = query.data?.profiles ?? [];
  const selectedProfileId =
    override ??
    query.data?.defaultProfileId ??
    query.data?.profiles[0]?.id ??
    null;

  const setSelected = (id: string) => {
    setOverride(id);
    mutation.mutate(id);
  };

  return {
    profiles,
    selectedProfileId,
    setSelected,
    isLoading: query.isLoading,
  };
}
