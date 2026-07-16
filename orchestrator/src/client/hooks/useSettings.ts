import type { AppSettings } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { queryClient as appQueryClient } from "@/client/lib/queryClient";
import { queryKeys } from "@/client/lib/queryKeys";
import * as api from "../api";

export function useSettings() {
  const {
    data: settings = null,
    error,
    isLoading,
    isFetching,
    refetch,
  } = useQuery<AppSettings | null>({
    queryKey: queryKeys.settings.current(),
    queryFn: api.getSettings,
  });

  const refreshSettings = async () => {
    const result = await refetch();
    if (result.error) throw result.error;
    return result.data ?? null;
  };

  return {
    settings,
    error: error ?? null,
    isLoading: isLoading || (!!isFetching && !settings && !error),
    showSponsorInfo: settings?.showSponsorInfo?.value ?? true,
    renderMarkdownInJobDescriptions:
      settings?.renderMarkdownInJobDescriptions?.value ?? true,
    inboxStaleThresholdDays:
      settings?.inboxStaleThresholdDays?.value ?? 7,
    maxBulkActionJobs: settings?.maxBulkActionJobs?.value ?? 1000,
    // Mirrors the server's resolveCvSourceFormat: an unset format is latex.
    cvSourceFormat: settings?.cvSourceFormat ?? "latex",
    refreshSettings,
  };
}

/** @internal For testing only */
export function _resetSettingsCache() {
  appQueryClient.removeQueries({ queryKey: queryKeys.settings.all });
}
