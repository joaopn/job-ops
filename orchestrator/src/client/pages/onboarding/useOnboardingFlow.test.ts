import { renderHookWithQueryClient } from "@client/test/renderWithQueryClient";
import { createAppSettings } from "@shared/testing/factories";
import type { CvDocument, Profile } from "@shared/types";
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@client/api", () => ({
  getSettings: vi.fn(),
  getProfiles: vi.fn(),
  getSourceConfigs: vi.fn(),
  getProviderInstances: vi.fn(),
  listCvDocuments: vi.fn(),
  getCvDocument: vi.fn(),
  validateLlm: vi.fn(),
  suggestOnboardingSearchTerms: vi.fn(),
  updateProfile: vi.fn(),
  upsertSourceConfig: vi.fn(),
  updateSettings: vi.fn(),
  updateCvDocument: vi.fn(),
}));

vi.mock("@client/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  getCvDocument,
  getProfiles,
  getProviderInstances,
  getSettings,
  getSourceConfigs,
  listCvDocuments,
  suggestOnboardingSearchTerms,
  validateLlm,
} from "@client/api";
import { useOnboardingFlow } from "./useOnboardingFlow";

function makeProfile(searchTerms: string[]): Profile {
  return {
    id: "p1",
    name: "Default",
    config: {
      searchTerms,
      searchCountry: "",
      searchCities: "",
      workplaceTypes: ["remote"],
      locationSearchScope: "selected_only",
      locationMatchStrictness: "exact_only",
      scrapeMaxAgeDays: null,
      blockedCompanyKeywords: [],
      runBudget: 500,
      topN: 10,
      minSuitabilityCategory: "good_fit",
      enabledSourceIds: ["jobspy"],
      providerInstanceIds: [],
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const CV = {
  id: "cv1",
  name: "CV",
  personalBrief: "I am a…",
  fields: [],
} as unknown as CvDocument;

/** Drive the hook to the search-profile step, where the auto-suggest fires. */
async function renderAtSearchProfile() {
  const rendered = renderHookWithQueryClient(() => useOnboardingFlow());
  await act(async () => {
    rendered.result.current.setCurrentStep("searchprofile");
  });
  return rendered;
}

describe("useOnboardingFlow — search terms auto-filled from the CV", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSettings).mockResolvedValue(createAppSettings());
    vi.mocked(getSourceConfigs).mockResolvedValue({ extractors: [] });
    vi.mocked(getProviderInstances).mockResolvedValue({ providers: [] });
    vi.mocked(validateLlm).mockResolvedValue({ valid: true, message: null });
    vi.mocked(listCvDocuments).mockResolvedValue([
      { id: "cv1" } as unknown as Awaited<
        ReturnType<typeof listCvDocuments>
      >[number],
    ]);
    vi.mocked(getCvDocument).mockResolvedValue(CV);
    vi.mocked(suggestOnboardingSearchTerms).mockResolvedValue({
      terms: ["ml engineer", "data scientist"],
      source: "ai",
    });
  });

  it("does NOT suggest while the profiles query is still pending", async () => {
    // THE REGRESSION GUARD. `defaultProfileTerms` falls back to `[]` on pending
    // data, so "no saved terms" is a false positive here. Firing now would land
    // a suggestion that the profile-seed effect then wipes on first arrival —
    // silently, and only on a fresh install.
    vi.mocked(getProfiles).mockReturnValue(new Promise(() => {}));

    const { result } = await renderAtSearchProfile();

    await waitFor(() => expect(result.current.cvDocument).not.toBeNull());
    expect(suggestOnboardingSearchTerms).not.toHaveBeenCalled();
  });

  it("suggests once when the profile has no terms, and the terms survive", async () => {
    vi.mocked(getProfiles).mockResolvedValue({
      profiles: [makeProfile([])],
      defaultProfileId: "p1",
    });

    const { result } = await renderAtSearchProfile();

    await waitFor(() =>
      expect(suggestOnboardingSearchTerms).toHaveBeenCalledTimes(1),
    );

    await waitFor(() =>
      expect(result.current.watch("searchTerms")).toEqual([
        "ml engineer",
        "data scientist",
      ]),
    );
    // The seed effect nulls `searchTermsSource` on its first-arrival run; if it
    // clobbered the suggestion, the provenance alert would vanish too.
    expect(result.current.searchTermsSource).toBe("ai");
  });

  it("does NOT suggest when the profile already has terms", async () => {
    vi.mocked(getProfiles).mockResolvedValue({
      profiles: [makeProfile(["existing role"])],
      defaultProfileId: "p1",
    });

    const { result } = await renderAtSearchProfile();

    await waitFor(() =>
      expect(result.current.watch("searchTerms")).toEqual(["existing role"]),
    );
    expect(suggestOnboardingSearchTerms).not.toHaveBeenCalled();
  });

  it("does NOT suggest when there is no CV", async () => {
    // The suggester 409s without a resume; a CV-skipping user must not eat an
    // error toast on step entry.
    vi.mocked(listCvDocuments).mockResolvedValue([]);
    vi.mocked(getProfiles).mockResolvedValue({
      profiles: [makeProfile([])],
      defaultProfileId: "p1",
    });

    const { result } = await renderAtSearchProfile();

    await waitFor(() => expect(result.current.steps.length).toBe(6));
    expect(suggestOnboardingSearchTerms).not.toHaveBeenCalled();
  });
});

describe("useOnboardingFlow — basic auth default", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSourceConfigs).mockResolvedValue({ extractors: [] });
    vi.mocked(getProviderInstances).mockResolvedValue({ providers: [] });
    vi.mocked(validateLlm).mockResolvedValue({ valid: true, message: null });
    vi.mocked(listCvDocuments).mockResolvedValue([]);
    vi.mocked(getProfiles).mockResolvedValue({
      profiles: [makeProfile([])],
      defaultProfileId: "p1",
    });
  });

  it("defaults to skip on a fresh install", async () => {
    // The settings-reset effect re-seeds this on the first settings load, so
    // the useState initializer alone is not enough — both must say "skip".
    vi.mocked(getSettings).mockResolvedValue(createAppSettings());

    const { result } = renderHookWithQueryClient(() => useOnboardingFlow());

    await waitFor(() => expect(result.current.settings).not.toBeNull());
    expect(result.current.basicAuthChoice).toBe("skip");
  });

  it("still selects enable when auth is already active", async () => {
    vi.mocked(getSettings).mockResolvedValue(
      createAppSettings({ basicAuthActive: true }),
    );

    const { result } = renderHookWithQueryClient(() => useOnboardingFlow());

    await waitFor(() => expect(result.current.settings).not.toBeNull());
    expect(result.current.basicAuthChoice).toBe("enable");
  });
});
