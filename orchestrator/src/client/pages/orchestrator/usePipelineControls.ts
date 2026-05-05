import * as api from "@client/api";
import { useSettings } from "@client/hooks/useSettings";
import {
  createLocationIntent,
  planLocationSources,
} from "@shared/location-intelligence.js";
import type {
  AppSettings,
  JobSource,
  SuitabilityCategory,
} from "@shared/types.js";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { AutomaticRunValues } from "./automatic-run";
import {
  deriveExtractorLimits,
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
      runBudget: number;
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
          runBudget: config.runBudget,
          searchTerms: config.searchTerms,
          country: config.country,
          cityLocations: config.cityLocations,
          workplaceTypes: config.workplaceTypes,
          searchScope: config.searchScope,
          matchStrictness: config.matchStrictness,
        });
        toast.message("Pipeline started", {
          description: `Sources: ${config.sources.join(", ")}. This may take a few minutes.`,
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

      const limits = deriveExtractorLimits({
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
        jobspyResultsWanted: limits.jobspyResultsWanted,
        startupjobsMaxJobsPerTerm: limits.startupjobsMaxJobsPerTerm,
        jobspyCountryIndeed: values.country,
        searchCities,
      });
      await refreshSettings();
      await startPipelineRun({
        ...values,
        sources: compatibleSources,
        topN: values.topN,
        minSuitabilityCategory: values.minSuitabilityCategory,
      });
      setIsRunModeModalOpen(false);
    },
    [pipelineSources, refreshSettings, startPipelineRun],
  );

  return {
    isRunModeModalOpen,
    setIsRunModeModalOpen,
    isCancelling,
    openRunMode,
    handleCancelPipeline,
    handleSaveAndRunAutomatic,
    refreshSettings,
  };
}
