import * as api from "@client/api";
import { PageHeader, PageMain } from "@client/components/layout";
import { queryKeys } from "@client/lib/queryKeys";
import { toast } from "@client/lib/toast";
import type {
  LocationMatchStrictness,
  LocationSearchScope,
} from "@shared/location-preferences.js";
import {
  defaultProfileConfig,
  type ProfileConfig,
  type SuitabilityCategory,
} from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Target } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  normalizeWorkplaceTypes,
  parseCityLocationsInput,
  parseCityLocationsSetting,
  parseSearchTermsInput,
  serializeCityLocationsSetting,
  type WorkplaceType,
} from "./orchestrator/automatic-run";
import {
  CountryField,
  LocationScopeField,
  MatchStrictnessField,
  MinFitField,
  NumberField,
  TokenizedField,
  WorkplaceTypesField,
} from "./orchestrator/run-fields";

interface EditorForm {
  name: string;
  searchTerms: string[];
  searchTermsDraft: string;
  country: string;
  cityValues: string[];
  cityDraft: string;
  workplaceTypes: WorkplaceType[];
  searchScope: LocationSearchScope;
  matchStrictness: LocationMatchStrictness;
  scrapeMaxAgeDays: string;
  blockedKeywords: string[];
  blockedDraft: string;
  runBudget: string;
  topN: string;
  minSuitabilityCategory: SuitabilityCategory;
  enabledSourceIds: string[];
  providerInstanceIds: string[];
}

function formFromConfig(name: string, config: ProfileConfig): EditorForm {
  return {
    name,
    searchTerms: config.searchTerms,
    searchTermsDraft: "",
    country: config.searchCountry,
    cityValues: parseCityLocationsSetting(config.searchCities),
    cityDraft: "",
    workplaceTypes: config.workplaceTypes,
    searchScope: config.locationSearchScope,
    matchStrictness: config.locationMatchStrictness,
    scrapeMaxAgeDays:
      config.scrapeMaxAgeDays === null ? "" : String(config.scrapeMaxAgeDays),
    blockedKeywords: config.blockedCompanyKeywords,
    blockedDraft: "",
    runBudget: String(config.runBudget),
    topN: String(config.topN),
    minSuitabilityCategory: config.minSuitabilityCategory,
    enabledSourceIds: config.enabledSourceIds,
    providerInstanceIds: config.providerInstanceIds,
  };
}

function clampInt(
  value: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseMaxAge(value: string): number | null {
  const parsed = Number.parseInt(value.trim(), 10);
  if (Number.isNaN(parsed) || parsed < 1) return null;
  return Math.min(365, parsed);
}

function nextPinSet(
  current: string[],
  value: string,
  checked: boolean,
): string[] {
  return checked
    ? Array.from(new Set([...current, value]))
    : current.filter((item) => item !== value);
}

export function ProfileEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = id === undefined;

  const profilesQuery = useQuery({
    queryKey: queryKeys.profiles.list(),
    queryFn: api.getProfiles,
  });
  const sourcesQuery = useQuery({
    queryKey: queryKeys.sourceConfigs.list(),
    queryFn: api.getSourceConfigs,
  });
  const instancesQuery = useQuery({
    queryKey: queryKeys.providerInstances.list(),
    queryFn: api.getProviderInstances,
  });

  const existing = id
    ? profilesQuery.data?.profiles.find((profile) => profile.id === id)
    : null;

  const [form, setForm] = useState<EditorForm | null>(() =>
    isNew ? formFromConfig("", defaultProfileConfig()) : null,
  );
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (isNew || hydratedRef.current) return;
    if (existing) {
      hydratedRef.current = true;
      setForm(formFromConfig(existing.name, existing.config));
    }
  }, [isNew, existing]);

  const update = (patch: Partial<EditorForm>) =>
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));

  const toggleWorkplace = (workplaceType: WorkplaceType, checked: boolean) => {
    if (!form) return;
    const next = checked
      ? normalizeWorkplaceTypes([...form.workplaceTypes, workplaceType])
      : form.workplaceTypes.filter((type) => type !== workplaceType);
    update({ workplaceTypes: next });
  };

  const toggleExtractor = (extractorId: string, checked: boolean) => {
    if (!form) return;
    update({
      enabledSourceIds: nextPinSet(form.enabledSourceIds, extractorId, checked),
    });
  };

  const toggleInstance = (instanceId: string, checked: boolean) => {
    if (!form) return;
    update({
      providerInstanceIds: nextPinSet(
        form.providerInstanceIds,
        instanceId,
        checked,
      ),
    });
  };

  const buildConfig = (f: EditorForm): ProfileConfig => ({
    ...(existing?.config ?? defaultProfileConfig()),
    searchTerms: f.searchTerms,
    searchCountry: f.country,
    searchCities: serializeCityLocationsSetting(f.cityValues) ?? "",
    workplaceTypes: f.workplaceTypes,
    locationSearchScope: f.searchScope,
    locationMatchStrictness: f.matchStrictness,
    scrapeMaxAgeDays: parseMaxAge(f.scrapeMaxAgeDays),
    blockedCompanyKeywords: f.blockedKeywords,
    runBudget: clampInt(f.runBudget, 50, 1000, 500),
    topN: clampInt(f.topN, 1, 50, 10),
    minSuitabilityCategory: f.minSuitabilityCategory,
    enabledSourceIds: f.enabledSourceIds,
    providerInstanceIds: f.providerInstanceIds,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form) throw new Error("Form not ready");
      const config = buildConfig(form);
      const name = form.name.trim();
      return id
        ? api.updateProfile(id, { name, config })
        : api.createProfile({ name, config });
    },
    onSuccess: () => {
      toast.success(id ? "Profile saved" : "Profile created");
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
      navigate("/profiles");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Save failed");
    },
  });

  const canSave =
    form !== null && form.name.trim().length > 0 && !saveMutation.isPending;

  // Only genuinely-missing profiles are "not found". A warm-cache Edit has
  // `existing` on the first frame but `form` not yet hydrated — that must show
  // the loading branch, not a not-found flash.
  const notFound = !isNew && !profilesQuery.isLoading && existing === undefined;

  const extractors = sourcesQuery.data?.extractors ?? [];
  const instances =
    instancesQuery.data?.providers.flatMap((provider) => provider.instances) ??
    [];

  return (
    <>
      <PageHeader
        icon={Target}
        title={isNew ? "New profile" : (existing?.name ?? "Edit profile")}
        subtitle="Search terms, location, run budget, and the sources this profile scrapes."
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => navigate("/profiles")}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canSave}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1 h-4 w-4" />
              )}
              Save
            </Button>
          </div>
        }
      />
      <PageMain>
        {notFound ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">Profile not found.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate("/profiles")}
            >
              Back to profiles
            </Button>
          </div>
        ) : !form ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading profile…
          </div>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Profile</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Label htmlFor="profile-name">Name</Label>
                <Input
                  id="profile-name"
                  value={form.name}
                  onChange={(event) => update({ name: event.target.value })}
                  placeholder="e.g. Berlin backend"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Search terms</CardTitle>
              </CardHeader>
              <CardContent>
                <TokenizedField
                  id="profile-search-terms"
                  values={form.searchTerms}
                  draft={form.searchTermsDraft}
                  parseInput={parseSearchTermsInput}
                  onDraftChange={(value) => update({ searchTermsDraft: value })}
                  onValuesChange={(value) => update({ searchTerms: value })}
                  placeholder="Type and press Enter"
                  helperText="Add multiple terms by separating with commas or pressing Enter."
                  removeLabelPrefix="Remove"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Location</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <CountryField
                    value={form.country}
                    onChange={(value) => update({ country: value })}
                  />
                  <TokenizedField
                    id="profile-cities"
                    label="Cities"
                    labelClassName="text-base font-semibold"
                    values={form.cityValues}
                    draft={form.cityDraft}
                    parseInput={parseCityLocationsInput}
                    onDraftChange={(value) => update({ cityDraft: value })}
                    onValuesChange={(value) => update({ cityValues: value })}
                    placeholder='e.g. "London"'
                    removeLabelPrefix="Remove city"
                  />
                </div>
                <WorkplaceTypesField
                  value={form.workplaceTypes}
                  onToggle={toggleWorkplace}
                />
                <LocationScopeField
                  value={form.searchScope}
                  onChange={(value) => update({ searchScope: value })}
                />
                <MatchStrictnessField
                  value={form.matchStrictness}
                  onChange={(value) => update({ matchStrictness: value })}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Run settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-3">
                  <NumberField
                    id="profile-run-budget"
                    label="Max jobs discovered"
                    min={50}
                    max={1000}
                    value={form.runBudget}
                    onChange={(value) => update({ runBudget: value })}
                  />
                  <NumberField
                    id="profile-top-n"
                    label="Resumes tailored"
                    min={1}
                    max={50}
                    value={form.topN}
                    onChange={(value) => update({ topN: value })}
                  />
                  <NumberField
                    id="profile-max-age"
                    label="Max job age (days)"
                    min={1}
                    max={365}
                    value={form.scrapeMaxAgeDays}
                    onChange={(value) => update({ scrapeMaxAgeDays: value })}
                  />
                </div>
                <MinFitField
                  value={form.minSuitabilityCategory}
                  onChange={(value) =>
                    update({ minSuitabilityCategory: value })
                  }
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Blocked companies</CardTitle>
              </CardHeader>
              <CardContent>
                <TokenizedField
                  id="profile-blocked"
                  values={form.blockedKeywords}
                  draft={form.blockedDraft}
                  parseInput={parseSearchTermsInput}
                  onDraftChange={(value) => update({ blockedDraft: value })}
                  onValuesChange={(value) => update({ blockedKeywords: value })}
                  placeholder="Company name keyword"
                  helperText="Jobs from companies matching these keywords are skipped."
                  removeLabelPrefix="Remove keyword"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sources</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Extractors
                  </p>
                  {extractors.length > 0 ? (
                    <div className="flex flex-wrap gap-2 gap-x-4">
                      {extractors.map((extractor) => {
                        const checkboxId = `pin-extractor-${extractor.extractorId}`;
                        return (
                          <label
                            key={extractor.extractorId}
                            htmlFor={checkboxId}
                            className="flex cursor-pointer items-center gap-3 text-sm"
                          >
                            <Checkbox
                              id={checkboxId}
                              checked={form.enabledSourceIds.includes(
                                extractor.extractorId,
                              )}
                              onCheckedChange={(checked) =>
                                toggleExtractor(
                                  extractor.extractorId,
                                  checked === true,
                                )
                              }
                            />
                            {extractor.displayName}
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No extractors available.
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Apify actors
                  </p>
                  {instances.length > 0 ? (
                    <div className="flex flex-wrap gap-2 gap-x-4">
                      {instances.map((instance) => {
                        const checkboxId = `pin-instance-${instance.id}`;
                        return (
                          <label
                            key={instance.id}
                            htmlFor={checkboxId}
                            className="flex cursor-pointer items-center gap-3 text-sm"
                          >
                            <Checkbox
                              id={checkboxId}
                              checked={form.providerInstanceIds.includes(
                                instance.id,
                              )}
                              onCheckedChange={(checked) =>
                                toggleInstance(instance.id, checked === true)
                              }
                            />
                            {instance.label}
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No Apify actors configured.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </PageMain>
    </>
  );
}
