import * as api from "@client/api";
import { useSettings } from "@client/hooks/useSettings";
import { isExtractorSourceId } from "@shared/extractors";
import {
  createLocationIntent,
  planLocationSources,
} from "@shared/location-intelligence.js";
import { parseSearchCitiesSetting } from "@shared/search-cities.js";
import type {
  AppSettings,
  JobSource,
  SuitabilityCategory,
} from "@shared/types.js";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@client/lib/toast";
import type { AutomaticRunValues } from "./automatic-run";
import {
  deriveMaxJobsPerTerm,
  loadAutomaticRunMemory,
  serializeCityLocationsSetting,
} from "./automatic-run";

type UsePipelineControlsArgs = {
  isPipelineRunning: boolean;
  setIsPipelineRunning: (value: boolean) => void;
  pipelineTerminalEvent: { status: string; errorMessage: string | null } | null;
  pipelineSources: JobSource[];
};

export type UsePipelineControlsResult = {
  isRunModeModalOpen: boolean;
  setIsRunModeModalOpen: (open: boolean) => void;
  isCancelling: boolean;
  openRunMode: () => void;
  handleCancelPipeline: () => Promise<void>;
  handleSaveAndRunAutomatic: (values: AutomaticRunValues) => Promise<void>;
  handleRerunSource: (source: JobSource) => Promise<void>;
  refreshSettings: () => Promise<AppSettings | null>;
};

export function usePipelineControls(
  args: UsePipelineControlsArgs,
): UsePipelineControlsResult {
  const {
    isPipelineRunning,
    setIsPipelineRunning,
    pipelineTerminalEvent,
    pipelineSources,
  } = args;

  const [isRunModeModalOpen, setIsRunModeModalOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const { refreshSettings } = useSettings();

  useEffect(() => {
    if (!pipelineTerminalEvent) return;
    setIsPipelineRunning(false);
    setIsCancelling(false);

    if (pipelineTerminalEvent.status === "cancelled") {
      toast.message("Pipeline cancelled");
      return;
    }

    if (pipelineTerminalEvent.status === "failed") {
      toast.error(pipelineTerminalEvent.errorMessage || "Pipeline failed");
      return;
    }

    toast.success("Pipeline completed");
  }, [pipelineTerminalEvent, setIsPipelineRunning]);

  const openRunMode = useCallback(() => {
    setIsRunModeModalOpen(true);
  }, []);

  const startPipelineRun = useCallback(
    async (config: {
      topN: number;
      minSuitabilityCategory: SuitabilityCategory;
      sources: JobSource[];
      providerInstanceIds?: string[];
      maxJobsPerTerm: number;
      searchTerms: string[];
      country: string;
      cityLocations: string[];
      workplaceTypes: Array<"remote" | "hybrid" | "onsite">;
      searchScope: AutomaticRunValues["searchScope"];
      matchStrictness: AutomaticRunValues["matchStrictness"];
    }) => {
      try {
        setIsPipelineRunning(true);
        setIsCancelling(false);
        await api.runPipeline({
          topN: config.topN,
          minSuitabilityCategory: config.minSuitabilityCategory,
          sources: config.sources,
          providerInstanceIds: config.providerInstanceIds,
          maxJobsPerTerm: config.maxJobsPerTerm,
          searchTerms: config.searchTerms,
          country: config.country,
          cityLocations: config.cityLocations,
          workplaceTypes: config.workplaceTypes,
          searchScope: config.searchScope,
          matchStrictness: config.matchStrictness,
        });
        const scopeCount =
          config.sources.length + (config.providerInstanceIds?.length ?? 0);
        const scopeLabel =
          config.sources.length > 0
            ? `Sources: ${config.sources.join(", ")}`
            : `${scopeCount} source(s)`;
        toast.message("Pipeline started", {
          description: `${scopeLabel}. This may take a few minutes.`,
        });
      } catch (error) {
        setIsPipelineRunning(false);
        setIsCancelling(false);
        const message =
          error instanceof Error ? error.message : "Failed to start pipeline";
        toast.error(message);
      }
    },
    [setIsPipelineRunning],
  );

  const handleCancelPipeline = useCallback(async () => {
    if (isCancelling || !isPipelineRunning) return;

    try {
      setIsCancelling(true);
      const result = await api.cancelPipeline();
      toast.message(result.message);
    } catch (error) {
      setIsCancelling(false);
      const message =
        error instanceof Error ? error.message : "Failed to cancel pipeline";
      toast.error(message);
    }
  }, [isCancelling, isPipelineRunning]);

  const handleSaveAndRunAutomatic = useCallback(
    async (values: AutomaticRunValues) => {
      const locationIntent = createLocationIntent({
        selectedCountry: values.country,
        cityLocations: values.cityLocations,
        workplaceTypes: values.workplaceTypes,
        searchScope: values.searchScope,
        matchStrictness: values.matchStrictness,
      });
      const sourcePlan = planLocationSources({
        intent: locationIntent,
        sources: pipelineSources,
      });
      const incompatiblePlans = sourcePlan.plans.filter((plan) => !plan.canRun);
      const compatibleSources = sourcePlan.compatibleSources as JobSource[];

      if (incompatiblePlans.length > 0) {
        toast.error(
          incompatiblePlans[0]?.reasons[0] ??
            "Some selected sources do not support this location setup.",
        );
        return;
      }

      if (compatibleSources.length === 0) {
        toast.error(
          "No compatible sources for the selected location setup. Choose another country, city, or source.",
        );
        return;
      }

      const { maxJobsPerTerm } = deriveMaxJobsPerTerm({
        budget: values.runBudget,
        searchTerms: values.searchTerms,
        sources: compatibleSources,
      });
      const searchCities = serializeCityLocationsSetting(values.cityLocations);
      await api.updateSettings({
        searchTerms: values.searchTerms,
        workplaceTypes: values.workplaceTypes,
        locationSearchScope: values.searchScope,
        locationMatchStrictness: values.matchStrictness,
        searchCountry: values.country,
        searchCities,
      });
      await refreshSettings();
      await startPipelineRun({
        ...values,
        sources: compatibleSources,
        maxJobsPerTerm,
        topN: values.topN,
        minSuitabilityCategory: values.minSuitabilityCategory,
      });
      setIsRunModeModalOpen(false);
    },
    [pipelineSources, refreshSettings, startPipelineRun],
  );

  const handleRerunSource = useCallback(
    async (source: JobSource) => {
      // Re-run a single source using the latest saved run settings (location,
      // search terms, budget), scoped to just this one source. Built-in
      // extractors go through `sources`; provider instances through
      // `providerInstanceIds` — each path suppresses the other so nothing
      // else runs.
      let settings: AppSettings | null = null;
      try {
        settings = await refreshSettings();
      } catch {
        settings = null;
      }
      const memory = loadAutomaticRunMemory();
      const searchTerms = settings?.searchTerms?.value ?? ["web developer"];
      const country = settings?.searchCountry?.value ?? "";
      const cityLocations = parseSearchCitiesSetting(
        settings?.searchCities?.value,
      );
      const workplaceTypes = settings?.workplaceTypes?.value ?? [
        "remote",
        "hybrid",
        "onsite",
      ];
      const searchScope = settings?.locationSearchScope?.value ?? "selected_only";
      const matchStrictness =
        settings?.locationMatchStrictness?.value ?? "exact_only";
      const runBudget = memory?.runBudget ?? 200;

      const isExtractor = isExtractorSourceId(source);
      const colonIndex = source.indexOf(":");
      const instanceId = colonIndex > 0 ? source.slice(colonIndex + 1) : source;

      const { maxJobsPerTerm } = deriveMaxJobsPerTerm({
        budget: runBudget,
        searchTerms,
        sources: [source],
      });

      await startPipelineRun({
        topN: memory?.topN ?? 10,
        minSuitabilityCategory: memory?.minSuitabilityCategory ?? "good_fit",
        sources: isExtractor ? [source] : [],
        providerInstanceIds: isExtractor ? [] : [instanceId],
        maxJobsPerTerm,
        searchTerms,
        country,
        cityLocations,
        workplaceTypes,
        searchScope,
        matchStrictness,
      });
    },
    [refreshSettings, startPipelineRun],
  );

  return {
    isRunModeModalOpen,
    setIsRunModeModalOpen,
    isCancelling,
    openRunMode,
    handleCancelPipeline,
    handleSaveAndRunAutomatic,
    handleRerunSource,
    refreshSettings,
  };
}
