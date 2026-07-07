import {
  createLocationIntent,
  planLocationSources,
} from "@shared/location-intelligence.js";
import type {
  LocationMatchStrictness,
  LocationSearchScope,
} from "@shared/location-preferences.js";
import {
  formatCountryLabel,
  normalizeCountryKey,
} from "@shared/location-support.js";
import type {
  AppSettings,
  JobSource,
  SuitabilityCategory,
} from "@shared/types";
import { Info, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { getDetectedCountryKey } from "@/lib/user-location";
import { sourceLabel } from "@/lib/utils";
import {
  AUTOMATIC_PRESETS,
  type AutomaticPresetId,
  type AutomaticPresetSelection,
  type AutomaticRunValues,
  calculateAutomaticEstimate,
  loadAutomaticRunMemory,
  normalizeWorkplaceTypes,
  parseCityLocationsInput,
  parseCityLocationsSetting,
  parseSearchTermsInput,
  saveAutomaticRunMemory,
  summarizeLocationPreferences,
  type WorkplaceType,
} from "./automatic-run";
import {
  CountryField,
  LocationScopeField,
  MatchStrictnessField,
  MinFitField,
  NumberField,
  TokenizedField,
  WorkplaceTypesField,
} from "./run-fields";

interface AutomaticRunTabProps {
  open: boolean;
  settings: AppSettings | null;
  enabledSources: JobSource[];
  isPipelineRunning: boolean;
  onSaveAndRun: (values: AutomaticRunValues) => Promise<void>;
}

const DEFAULT_VALUES: AutomaticRunValues = {
  topN: 10,
  minSuitabilityCategory: "good_fit",
  searchTerms: ["web developer"],
  runBudget: 200,
  country: "",
  cityLocations: [],
  workplaceTypes: ["remote", "hybrid", "onsite"],
  searchScope: "selected_only",
  matchStrictness: "exact_only",
};

interface AutomaticRunFormValues {
  topN: string;
  minSuitabilityCategory: SuitabilityCategory;
  runBudget: string;
  country: string;
  cityLocations: string[];
  cityLocationDraft: string;
  workplaceTypes: WorkplaceType[];
  searchScope: LocationSearchScope;
  matchStrictness: LocationMatchStrictness;
  searchTerms: string[];
  searchTermDraft: string;
}

const MIN_RUN_BUDGET = 50;
const MAX_RUN_BUDGET = 1000;

function normalizeUiCountryKey(value: string): string {
  const normalized = normalizeCountryKey(value);
  if (normalized === "usa/ca") return "united states";
  return normalized;
}

function toNumber(input: string, min: number, max: number, fallback: number) {
  const parsed = Number.parseInt(input, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeRunBudget(value: number): number {
  return Math.min(MAX_RUN_BUDGET, Math.max(MIN_RUN_BUDGET, Math.round(value)));
}

export const AutomaticRunTab: React.FC<AutomaticRunTabProps> = ({
  open,
  settings,
  enabledSources,
  isPipelineRunning,
  onSaveAndRun,
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [browserCountrySuggestion, setBrowserCountrySuggestion] = useState<
    string | null
  >(null);
  const [selectedPreset, setSelectedPreset] =
    useState<AutomaticPresetSelection>("custom");
  const { watch, reset, setValue } = useForm<AutomaticRunFormValues>({
    defaultValues: {
      topN: String(DEFAULT_VALUES.topN),
      minSuitabilityCategory: DEFAULT_VALUES.minSuitabilityCategory,
      runBudget: String(DEFAULT_VALUES.runBudget),
      country: DEFAULT_VALUES.country,
      cityLocations: [],
      cityLocationDraft: "",
      workplaceTypes: DEFAULT_VALUES.workplaceTypes,
      searchScope: DEFAULT_VALUES.searchScope,
      matchStrictness: DEFAULT_VALUES.matchStrictness,
      searchTerms: DEFAULT_VALUES.searchTerms,
      searchTermDraft: "",
    },
  });

  const topNInput = watch("topN");
  const minCategoryInput = watch("minSuitabilityCategory");
  const runBudgetInput = watch("runBudget");
  const countryInput = watch("country");
  const cityLocations = watch("cityLocations");
  const cityLocationDraft = watch("cityLocationDraft");
  const workplaceTypes = watch("workplaceTypes");
  const searchScope = watch("searchScope");
  const matchStrictness = watch("matchStrictness");
  const searchTerms = watch("searchTerms");
  const searchTermDraft = watch("searchTermDraft");

  useEffect(() => {
    if (!open) return;
    const memory = loadAutomaticRunMemory();
    const fallbackRunBudget = normalizeRunBudget(DEFAULT_VALUES.runBudget);
    const rememberedPresetValues =
      memory?.presetId && memory.presetId !== "custom"
        ? AUTOMATIC_PRESETS[memory.presetId]
        : null;
    const rememberedTopN =
      rememberedPresetValues?.topN ?? memory?.topN ?? DEFAULT_VALUES.topN;
    const rememberedMinSuitabilityCategory =
      rememberedPresetValues?.minSuitabilityCategory ??
      memory?.minSuitabilityCategory ??
      DEFAULT_VALUES.minSuitabilityCategory;
    const rememberedRunBudget = normalizeRunBudget(
      rememberedPresetValues?.runBudget ??
        memory?.runBudget ??
        fallbackRunBudget,
    );
    const hasExplicitLocationOverride = Boolean(
      settings?.searchCountry?.override || settings?.searchCities?.override,
    );
    const rememberedCountry = normalizeUiCountryKey(
      settings?.searchCountry?.value ??
        settings?.searchCities?.value ??
        DEFAULT_VALUES.country,
    );
    const detectedCountry = !hasExplicitLocationOverride
      ? getDetectedCountryKey()
      : null;
    const countryValue = rememberedCountry || DEFAULT_VALUES.country;
    const suggestion =
      !countryValue && detectedCountry ? detectedCountry : null;
    const rememberedLocations = parseCityLocationsSetting(
      settings?.searchCities?.value,
    ).filter(
      (location) =>
        normalizeCountryKey(location) !== normalizeCountryKey(countryValue),
    );
    const rememberedWorkplaceTypes = normalizeWorkplaceTypes(
      settings?.workplaceTypes?.value,
    );
    const rememberedSearchScope =
      settings?.locationSearchScope?.value ?? DEFAULT_VALUES.searchScope;
    const rememberedMatchStrictness =
      settings?.locationMatchStrictness?.value ??
      DEFAULT_VALUES.matchStrictness;

    setBrowserCountrySuggestion(suggestion);
    reset({
      topN: String(rememberedTopN),
      minSuitabilityCategory: rememberedMinSuitabilityCategory,
      runBudget: String(rememberedRunBudget),
      country: countryValue,
      cityLocations: rememberedLocations,
      cityLocationDraft: "",
      workplaceTypes: rememberedWorkplaceTypes,
      searchScope: rememberedSearchScope,
      matchStrictness: rememberedMatchStrictness,
      searchTerms: settings?.searchTerms?.value ?? DEFAULT_VALUES.searchTerms,
      searchTermDraft: "",
    });
    setSelectedPreset(memory?.presetId ?? "custom");
    setAdvancedOpen(false);
  }, [open, settings, reset]);

  const values = useMemo<AutomaticRunValues>(() => {
    const normalizedCountry = normalizeUiCountryKey(countryInput);
    return {
      topN: toNumber(topNInput, 1, 50, DEFAULT_VALUES.topN),
      minSuitabilityCategory: minCategoryInput,
      runBudget: toNumber(
        runBudgetInput,
        MIN_RUN_BUDGET,
        MAX_RUN_BUDGET,
        DEFAULT_VALUES.runBudget,
      ),
      country: normalizedCountry || DEFAULT_VALUES.country,
      cityLocations,
      workplaceTypes: normalizeWorkplaceTypes(workplaceTypes),
      searchScope,
      matchStrictness,
      searchTerms,
    };
  }, [
    topNInput,
    minCategoryInput,
    runBudgetInput,
    countryInput,
    cityLocations,
    workplaceTypes,
    searchScope,
    matchStrictness,
    searchTerms,
  ]);

  const workplaceTypeSelectionInvalid = workplaceTypes.length === 0;

  const locationIntent = useMemo(
    () =>
      createLocationIntent({
        selectedCountry: values.country,
        cityLocations: values.cityLocations,
        workplaceTypes: values.workplaceTypes,
        searchScope: values.searchScope,
        matchStrictness: values.matchStrictness,
      }),
    [
      values.cityLocations,
      values.country,
      values.matchStrictness,
      values.searchScope,
      values.workplaceTypes,
    ],
  );

  const sourcePlans = useMemo(
    () =>
      planLocationSources({ intent: locationIntent, sources: enabledSources }),
    [enabledSources, locationIntent],
  );

  const sourcePlanBySource = useMemo(
    () =>
      new Map(
        sourcePlans.plans.map((plan) => [plan.source as JobSource, plan]),
      ),
    [sourcePlans.plans],
  );

  const isSourceAvailableForRun = useCallback(
    (source: JobSource) => sourcePlanBySource.get(source)?.canRun ?? false,
    [sourcePlanBySource],
  );

  const compatibleEnabledSources = useMemo(
    () =>
      sourcePlans.compatibleSources.filter((source): source is JobSource =>
        enabledSources.includes(source as JobSource),
      ),
    [enabledSources, sourcePlans.compatibleSources],
  );

  const incompatibleEnabledSources = useMemo(
    () =>
      enabledSources.filter((source) => !isSourceAvailableForRun(source)),
    [enabledSources, isSourceAvailableForRun],
  );
  const countrySelectionInvalid = values.country.length === 0;
  const countrySuggestion =
    browserCountrySuggestion && browserCountrySuggestion !== values.country
      ? browserCountrySuggestion
      : null;

  const estimate = useMemo(
    () =>
      calculateAutomaticEstimate({
        values,
        sources: compatibleEnabledSources,
      }),
    [values, compatibleEnabledSources],
  );

  const locationSummary = useMemo(
    () => summarizeLocationPreferences(values),
    [values],
  );

  const runDisabled =
    isPipelineRunning ||
    isSaving ||
    compatibleEnabledSources.length === 0 ||
    values.searchTerms.length === 0 ||
    countrySelectionInvalid ||
    workplaceTypeSelectionInvalid;

  const toggleWorkplaceType = (
    workplaceType: WorkplaceType,
    checked: boolean,
  ) => {
    const next = checked
      ? normalizeWorkplaceTypes([...workplaceTypes, workplaceType])
      : workplaceTypes.filter((value) => value !== workplaceType);

    setValue("workplaceTypes", next, { shouldDirty: true });
  };

  const applyPreset = (presetId: AutomaticPresetId) => {
    const preset = AUTOMATIC_PRESETS[presetId];
    setSelectedPreset(presetId);
    setValue("topN", String(preset.topN), { shouldDirty: true });
    setValue("minSuitabilityCategory", preset.minSuitabilityCategory, {
      shouldDirty: true,
    });
    setValue("runBudget", String(preset.runBudget), { shouldDirty: true });
  };

  const handleSaveAndRun = async () => {
    setIsSaving(true);
    try {
      saveAutomaticRunMemory({
        topN: values.topN,
        minSuitabilityCategory: values.minSuitabilityCategory,
        runBudget: values.runBudget,
        presetId: selectedPreset,
      });
      await onSaveAndRun(values);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <Card>
          <CardContent className="space-y-6 pt-6">
            <div className="grid items-center gap-3 md:grid-cols-[120px_1fr]">
              <Label className="text-base font-semibold">Preset</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={selectedPreset === "fast" ? "default" : "outline"}
                  aria-pressed={selectedPreset === "fast"}
                  onClick={() => applyPreset("fast")}
                >
                  Fast
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    selectedPreset === "balanced" ? "default" : "outline"
                  }
                  aria-pressed={selectedPreset === "balanced"}
                  onClick={() => applyPreset("balanced")}
                >
                  Balanced
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    selectedPreset === "detailed" ? "default" : "outline"
                  }
                  aria-pressed={selectedPreset === "detailed"}
                  onClick={() => applyPreset("detailed")}
                >
                  Detailed
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    selectedPreset === "custom" ? "secondary" : "outline"
                  }
                  aria-pressed={selectedPreset === "custom"}
                  onClick={() => setSelectedPreset("custom")}
                >
                  Custom
                </Button>
              </div>
            </div>
            <Separator />
            <Accordion
              type="single"
              collapsible
              defaultValue="location-intent"
              className="w-full"
            >
              <AccordionItem value="location-intent" className="border-b-0">
                <AccordionTrigger
                  aria-label="Review and edit location intent"
                  className="gap-4 py-2 hover:no-underline"
                >
                  <div className="flex w-full flex-col gap-3 text-left sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <p className="py-0 text-base font-semibold hover:no-underline">
                        Location preferences
                      </p>
                      <p className="truncate text-sm text-muted-foreground whitespace-pre-wrap">
                        {locationSummary}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {countrySuggestion ? (
                        <Badge
                          variant="outline"
                          className="rounded-full border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200"
                        >
                          Browser suggestion
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-4">
                  {countrySuggestion ? (
                    <Alert className="border-sky-500/20 bg-sky-500/5">
                      <Info className="h-4 w-4" />
                      <AlertTitle>Detected from your browser</AlertTitle>
                      <AlertDescription>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-sm leading-6 text-muted-foreground">
                            We detected{" "}
                            <span className="font-medium text-foreground">
                              {formatCountryLabel(countrySuggestion)}
                            </span>{" "}
                            as a helpful starting point. Apply it to unlock
                            country-specific sources, or choose another country.
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() =>
                              setValue("country", countrySuggestion, {
                                shouldDirty: true,
                              })
                            }
                          >
                            Use suggestion
                          </Button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="grid gap-4 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                    <CountryField
                      value={values.country}
                      onChange={(country) =>
                        setValue("country", country, { shouldDirty: true })
                      }
                      error={
                        countrySelectionInvalid ? (
                          <p className="text-xs text-destructive">
                            {countrySuggestion
                              ? "Select a country or use the browser suggestion."
                              : "Select a country."}
                          </p>
                        ) : null
                      }
                    />

                    <TokenizedField
                      id="city-locations-input"
                      label="Cities"
                      labelClassName="text-base font-semibold"
                      values={cityLocations}
                      draft={cityLocationDraft}
                      parseInput={parseCityLocationsInput}
                      onDraftChange={(value) =>
                        setValue("cityLocationDraft", value)
                      }
                      onValuesChange={(value) =>
                        setValue("cityLocations", value, { shouldDirty: true })
                      }
                      placeholder='e.g. "London"'
                      removeLabelPrefix="Remove city"
                    />
                  </div>

                  <WorkplaceTypesField
                    value={workplaceTypes}
                    onToggle={toggleWorkplaceType}
                    invalid={workplaceTypeSelectionInvalid}
                  />

                  <LocationScopeField
                    value={searchScope}
                    onChange={(value) =>
                      setValue("searchScope", value, { shouldDirty: true })
                    }
                  />

                  <MatchStrictnessField
                    value={matchStrictness}
                    onChange={(value) =>
                      setValue("matchStrictness", value, { shouldDirty: true })
                    }
                  />
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <Accordion
              type="single"
              collapsible
              value={advancedOpen ? "advanced" : ""}
              onValueChange={(value) => setAdvancedOpen(value === "advanced")}
            >
              <AccordionItem value="advanced" className="border-b-0">
                <AccordionTrigger className="py-0 text-base font-semibold hover:no-underline">
                  Run settings
                </AccordionTrigger>
                <AccordionContent className="pt-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <NumberField
                      id="top-n"
                      label="Resumes tailored"
                      min={1}
                      max={50}
                      value={topNInput}
                      onChange={(value) => {
                        setSelectedPreset("custom");
                        setValue("topN", value);
                      }}
                    />
                    <MinFitField
                      value={minCategoryInput}
                      onChange={(value) => {
                        setSelectedPreset("custom");
                        setValue("minSuitabilityCategory", value, {
                          shouldDirty: true,
                        });
                      }}
                    />
                    <NumberField
                      id="jobs-per-term"
                      label="Max jobs discovered"
                      min={MIN_RUN_BUDGET}
                      max={MAX_RUN_BUDGET}
                      value={runBudgetInput}
                      onChange={(value) => {
                        setSelectedPreset("custom");
                        setValue("runBudget", value);
                      }}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle>Search terms</CardTitle>
          </CardHeader>
          <CardContent>
            <TokenizedField
              id="search-terms-input"
              values={searchTerms}
              draft={searchTermDraft}
              parseInput={parseSearchTermsInput}
              onDraftChange={(value) => setValue("searchTermDraft", value)}
              onValuesChange={(value) =>
                setValue("searchTerms", value, { shouldDirty: true })
              }
              placeholder="Type and press Enter"
              helperText="Add multiple terms by separating with commas or pressing Enter."
              removeLabelPrefix="Remove"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle>Sources</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {compatibleEnabledSources.length === 0
                ? "No sources enabled."
                : `Will run: ${compatibleEnabledSources
                    .map((source) => sourceLabel[source])
                    .join(", ")}.`}
            </p>
            {incompatibleEnabledSources.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Skipping (incompatible with this location):{" "}
                {incompatibleEnabledSources
                  .map((source) => sourceLabel[source])
                  .join(", ")}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Manage in{" "}
              <a
                href="#/sources"
                className="font-medium text-foreground underline underline-offset-2"
              >
                Sources
              </a>
              .
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-3 flex shrink-0 items-center justify-between border-t border-border/60 bg-background pt-3">
        <div className="hidden text-sm text-muted-foreground md:block">
          Est: {estimate.discovered.min}-{estimate.discovered.max} jobs, ~
          {values.topN} resumes
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            className="gap-2"
            disabled={runDisabled}
            onClick={() => void handleSaveAndRun()}
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Start run now
          </Button>
        </div>
      </div>
    </div>
  );
};
