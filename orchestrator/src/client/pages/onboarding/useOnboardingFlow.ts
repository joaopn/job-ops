import * as api from "@client/api";
import { useSettings } from "@client/hooks/useSettings";
import {
  hasCompletedBasicAuthOnboarding,
  isOnboardingComplete,
} from "@client/lib/onboarding";
import { queryKeys } from "@client/lib/queryKeys";
import {
  getLlmProviderConfig,
  normalizeLlmProvider,
} from "@client/pages/settings/utils";
import { getDefaultModelForProvider } from "@shared/settings-registry";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type {
  AppSettings,
  CvDocument,
  CvDocumentSummary,
  SearchTermsSuggestionResponse,
  ValidationResult,
} from "@shared/types.js";
import { normalizeSearchTerms } from "@shared/utils/search-terms";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { EMPTY_VALIDATION_STATE, STEP_COPY } from "./content";
import type {
  BasicAuthChoice,
  CvChoice,
  OnboardingFormData,
  OnboardingStep,
  StepId,
  ValidationState,
} from "./types";

export function useOnboardingFlow() {
  const queryClient = useQueryClient();
  const { settings, isLoading: settingsLoading } = useSettings();

  const [isSaving, setIsSaving] = useState(false);
  const [isValidatingLlm, setIsValidatingLlm] = useState(false);
  const [isGeneratingSearchTerms, setIsGeneratingSearchTerms] = useState(false);
  const [llmValidation, setLlmValidation] = useState<ValidationState>(
    EMPTY_VALIDATION_STATE,
  );
  const [basicAuthChoice, setBasicAuthChoice] =
    useState<BasicAuthChoice>("enable");
  const [cvChoice, setCvChoice] = useState<CvChoice>(null);
  const [cvDocument, setCvDocument] = useState<CvDocument | null>(null);
  const cvHydratedRef = useRef(false);
  const [searchTermsSaved, setSearchTermsSaved] = useState(false);
  const [hasSavedSearchTermsInSession, setHasSavedSearchTermsInSession] =
    useState(false);
  const [searchTermsSource, setSearchTermsSource] = useState<
    SearchTermsSuggestionResponse["source"] | null
  >(null);
  const [searchTermsStale, setSearchTermsStale] = useState(false);
  const [currentStep, setCurrentStep] = useState<StepId | null>(null);
  const searchTermsOverrideKeyRef = useRef<string | null>(null);

  const { control, getValues, reset, setValue, watch } =
    useForm<OnboardingFormData>({
      defaultValues: {
        llmProvider: "",
        llmBaseUrl: "",
        llmApiKey: "",
        personalBrief: "",
        searchTerms: [],
        searchTermDraft: "",
        basicAuthUser: "",
        basicAuthPassword: "",
      },
    });

  const syncSettingsCache = useCallback(
    (nextSettings: AppSettings) => {
      queryClient.setQueryData(queryKeys.settings.current(), nextSettings);
    },
    [queryClient],
  );

  useEffect(() => {
    if (!settings) return;

    const searchTermsOverride = settings.searchTerms?.override ?? null;
    const hasExplicitSearchTermsOverride =
      Array.isArray(searchTermsOverride) && searchTermsOverride.length > 0;
    const searchTermsOverrideKey = JSON.stringify(searchTermsOverride);
    setLlmValidation(EMPTY_VALIDATION_STATE);
    reset({
      llmProvider: settings.llmProvider?.value || "",
      llmBaseUrl: settings.llmBaseUrl?.value || "",
      llmApiKey: "",
      personalBrief: "",
      searchTerms: settings.searchTerms?.value ?? [],
      searchTermDraft: "",
      basicAuthUser: settings.basicAuthUser ?? "",
      basicAuthPassword: "",
    });
    setBasicAuthChoice(
      settings.basicAuthActive
        ? "enable"
        : settings.onboardingBasicAuthDecision === "skipped"
          ? "skip"
          : "enable",
    );
    if (searchTermsOverrideKeyRef.current !== searchTermsOverrideKey) {
      searchTermsOverrideKeyRef.current = searchTermsOverrideKey;
      setSearchTermsSaved(hasExplicitSearchTermsOverride);
      setHasSavedSearchTermsInSession(hasExplicitSearchTermsOverride);
      setSearchTermsSource(null);
      setSearchTermsStale(false);
    }
  }, [reset, settings]);

  const llmProvider = watch("llmProvider");
  const selectedProvider = normalizeLlmProvider(
    llmProvider || settings?.llmProvider?.value || "openrouter",
  );
  const providerConfig = getLlmProviderConfig(selectedProvider);
  const {
    normalizedProvider,
    showApiKey,
    showBaseUrl,
    requiresApiKey: requiresLlmKey,
  } = providerConfig;

  const llmKeyHint = settings?.llmApiKeyHint ?? null;
  const hasLlmKey = Boolean(llmKeyHint);
  const llmValidated = llmValidation.valid;
  const searchTermsComplete = searchTermsSaved && !searchTermsStale;
  const basicAuthComplete = hasCompletedBasicAuthOnboarding(settings);

  const cvListQuery = useQuery<CvDocumentSummary[]>({
    queryKey: queryKeys.cvDocuments.list(),
    queryFn: api.listCvDocuments,
  });
  const activeCvId = cvListQuery.data?.[0]?.id ?? null;
  const cvDetailQuery = useQuery<CvDocument>({
    queryKey: activeCvId
      ? queryKeys.cvDocuments.detail(activeCvId)
      : ["cv-documents", "detail", "none"],
    queryFn: () => {
      if (!activeCvId) throw new Error("No active CV");
      return api.getCvDocument(activeCvId);
    },
    enabled: Boolean(activeCvId),
  });

  // Hydrate CV state once when the detail query lands. After hydration the
  // user owns the brief textarea — re-syncing here would clobber unsaved edits.
  useEffect(() => {
    if (cvHydratedRef.current) return;
    if (cvListQuery.isLoading || cvDetailQuery.isFetching) return;
    if (cvDetailQuery.data) {
      setCvDocument(cvDetailQuery.data);
      setCvChoice("upload");
      setValue("personalBrief", cvDetailQuery.data.personalBrief, {
        shouldDirty: false,
      });
      cvHydratedRef.current = true;
    } else if (!activeCvId && !cvListQuery.isLoading) {
      cvHydratedRef.current = true;
    }
  }, [
    activeCvId,
    cvDetailQuery.data,
    cvDetailQuery.isFetching,
    cvListQuery.isLoading,
    setValue,
  ]);

  const cvComplete = Boolean(cvDocument) || cvChoice === "skip";

  const toValidationState = useCallback(
    (
      result: ValidationResult,
      options?: {
        markChecked?: boolean;
      },
    ): ValidationState => ({
      ...result,
      checked: options?.markChecked ?? true,
      hydrated: true,
    }),
    [],
  );

  const validateLlm = useCallback(
    async (options?: { markChecked?: boolean }) => {
      const values = getValues();

      setIsValidatingLlm(true);
      try {
        const result = await api.validateLlm({
          provider: selectedProvider,
          baseUrl: showBaseUrl
            ? values.llmBaseUrl.trim() || undefined
            : undefined,
          apiKey: requiresLlmKey
            ? values.llmApiKey.trim() || undefined
            : undefined,
        });
        setLlmValidation(toValidationState(result, options));
        return result;
      } catch (error) {
        const result = {
          valid: false,
          message:
            error instanceof Error ? error.message : "LLM validation failed",
        };
        setLlmValidation(toValidationState(result, options));
        return result;
      } finally {
        setIsValidatingLlm(false);
      }
    },
    [
      getValues,
      requiresLlmKey,
      selectedProvider,
      showBaseUrl,
      toValidationState,
    ],
  );

  useEffect(() => {
    if (!showBaseUrl) {
      setValue("llmBaseUrl", "");
    }
  }, [setValue, showBaseUrl]);

  useEffect(() => {
    if (!selectedProvider) return;
    setLlmValidation(EMPTY_VALIDATION_STATE);
  }, [selectedProvider]);

  useEffect(() => {
    if (!settings || settingsLoading) return;
    if (llmValidation.hydrated) return;
    void validateLlm({ markChecked: false });
  }, [llmValidation.hydrated, settings, settingsLoading, validateLlm]);

  const steps = useMemo<OnboardingStep[]>(
    () => [
      {
        id: "llm",
        label: "LLM",
        subtitle: "Provider, credentials, and endpoint",
        complete: llmValidated,
        disabled: false,
      },
      {
        id: "cv",
        label: "CV",
        subtitle: "Upload your CV or skip",
        complete: cvComplete,
        disabled: false,
      },
      {
        id: "searchterms",
        label: "Search terms",
        subtitle: "Titles to search for",
        complete: searchTermsComplete,
        disabled: false,
      },
      {
        id: "basicauth",
        label: "Basic auth",
        subtitle: "Protect write actions or skip",
        complete: basicAuthComplete,
        disabled: false,
      },
    ],
    [basicAuthComplete, cvComplete, llmValidated, searchTermsComplete],
  );

  useEffect(() => {
    if (!steps.length) return;

    setCurrentStep((existing) => {
      if (!existing) return steps[0].id;
      const existingStep = steps.find((step) => step.id === existing);
      if (!existingStep) return steps[0].id;
      return existing;
    });
  }, [steps]);

  const progressValue =
    steps.length > 0
      ? Math.round(
          (steps.filter((step) => step.complete).length / steps.length) * 100,
        )
      : 0;

  const complete = isOnboardingComplete({
    settings,
    llmValid: llmValidated,
    searchTermsValid: searchTermsComplete,
  });

  const handleSaveLlm = useCallback(async () => {
    const values = getValues();
    const apiKeyValue = values.llmApiKey.trim();
    const baseUrlValue = values.llmBaseUrl.trim();

    if (requiresLlmKey && !apiKeyValue && !hasLlmKey) {
      toast.info("Add your LLM API key to continue");
      return false;
    }

    const validation = await validateLlm();

    if (!validation.valid) {
      toast.error(validation.message || "LLM validation failed");
      return false;
    }

    const update: Partial<UpdateSettingsInput> = {
      llmProvider: normalizedProvider,
      llmBaseUrl: showBaseUrl ? baseUrlValue || null : null,
      model: null,
      modelScorer: null,
      modelTailoring: null,
    };

    if (showApiKey && apiKeyValue) {
      update.llmApiKey = apiKeyValue;
    }

    try {
      setIsSaving(true);
      const nextSettings = await api.updateSettings(update);
      syncSettingsCache(nextSettings);
      setValue("llmApiKey", "");
      const defaultModel = getDefaultModelForProvider(normalizedProvider);
      toast.success("LLM provider connected", {
        description:
          normalizedProvider === "openai" || normalizedProvider === "gemini"
            ? `Default for ${providerConfig.label}: ${defaultModel}.`
            : "You can fine-tune models later in Settings.",
      });
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save LLM settings",
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [
    getValues,
    hasLlmKey,
    normalizedProvider,
    providerConfig.label,
    requiresLlmKey,
    setValue,
    showApiKey,
    showBaseUrl,
    syncSettingsCache,
    validateLlm,
  ]);

  const markSearchTermsStale = useCallback(() => {
    const currentTerms = getValues().searchTerms;
    if (currentTerms.length === 0 && !hasSavedSearchTermsInSession) return;
    setSearchTermsSaved(false);
    setSearchTermsStale(true);
    setSearchTermsSource(null);
  }, [getValues, hasSavedSearchTermsInSession]);

  const handleGenerateSearchTerms = useCallback(
    async (options?: { showToast?: boolean }) => {
      try {
        setIsGeneratingSearchTerms(true);
        const result = await api.suggestOnboardingSearchTerms();
        setValue("searchTerms", result.terms, { shouldDirty: true });
        setValue("searchTermDraft", "");
        setSearchTermsSaved(false);
        setSearchTermsSource(result.source);
        setSearchTermsStale(false);

        if (options?.showToast) {
          toast.success("Search terms refreshed");
        }

        return result;
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to suggest search terms",
        );
        return null;
      } finally {
        setIsGeneratingSearchTerms(false);
      }
    },
    [setValue],
  );

  const handleSaveSearchTerms = useCallback(async () => {
    const nextTerms = normalizeSearchTerms(getValues().searchTerms);

    if (nextTerms.length === 0) {
      toast.info("Add at least one job title to continue");
      return false;
    }

    try {
      setIsSaving(true);
      const nextSettings = await api.updateSettings({
        searchTerms: nextTerms,
      });
      syncSettingsCache(nextSettings);
      setValue("searchTerms", nextTerms);
      setValue("searchTermDraft", "");
      setSearchTermsSaved(true);
      setHasSavedSearchTermsInSession(true);
      setSearchTermsStale(false);
      toast.success("Search terms saved");
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save search terms",
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [getValues, setValue, syncSettingsCache]);

  const handleCompleteCv = useCallback(async () => {
    if (cvChoice === null) {
      toast.info("Upload your CV or pick 'Skip for now' to continue");
      return false;
    }
    if (cvChoice === "skip") {
      // Server has nothing to persist for skip; advance.
      return true;
    }
    if (!cvDocument) {
      toast.info("Wait for the upload to finish before continuing");
      return false;
    }
    const nextBrief = getValues().personalBrief;
    if (nextBrief === cvDocument.personalBrief) {
      // No edits → nothing to save, advance.
      return true;
    }
    try {
      setIsSaving(true);
      const updated = await api.updateCvDocument(cvDocument.id, {
        personalBrief: nextBrief,
      });
      setCvDocument(updated);
      setValue("personalBrief", updated.personalBrief, { shouldDirty: false });
      // Search-terms suggestions read from the brief; force the user to
      // re-pull suggestions if they edited the brief after first save.
      markSearchTermsStale();
      queryClient.setQueryData(
        queryKeys.cvDocuments.detail(updated.id),
        updated,
      );
      toast.success("Personal brief saved");
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save personal brief",
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [
    cvChoice,
    cvDocument,
    getValues,
    markSearchTermsStale,
    queryClient,
    setValue,
  ]);

  const handleCompleteBasicAuth = useCallback(async () => {
    if (basicAuthChoice === "skip") {
      try {
        setIsSaving(true);
        const nextSettings = await api.updateSettings({
          onboardingBasicAuthDecision: "skipped",
        });
        syncSettingsCache(nextSettings);
        toast.success("Authentication skipped for now");
        return true;
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to save onboarding progress",
        );
        return false;
      } finally {
        setIsSaving(false);
      }
    }

    if (basicAuthChoice !== "enable") {
      toast.info("Choose whether to enable authentication or skip it for now");
      return false;
    }

    const { basicAuthUser, basicAuthPassword } = getValues();
    const normalizedUser = basicAuthUser.trim();
    const normalizedPassword = basicAuthPassword.trim();

    if (!normalizedUser || !normalizedPassword) {
      toast.info("Enter both a username and password to enable authentication");
      return false;
    }

    try {
      setIsSaving(true);
      const nextSettings = await api.updateSettings({
        enableBasicAuth: true,
        basicAuthUser: normalizedUser,
        basicAuthPassword: normalizedPassword,
        onboardingBasicAuthDecision: "enabled",
      });
      syncSettingsCache(nextSettings);
      setValue("basicAuthPassword", "");
      toast.success("Authentication enabled");
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save authentication credentials",
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [basicAuthChoice, getValues, setValue, syncSettingsCache]);

  const handlePrimaryAction = useCallback(async () => {
    if (!currentStep) return;
    if (currentStep === "llm") {
      await handleSaveLlm();
      return;
    }
    if (currentStep === "cv") {
      await handleCompleteCv();
      return;
    }
    if (currentStep === "searchterms") {
      await handleSaveSearchTerms();
      return;
    }
    await handleCompleteBasicAuth();
  }, [
    currentStep,
    handleCompleteBasicAuth,
    handleCompleteCv,
    handleSaveLlm,
    handleSaveSearchTerms,
  ]);

  const stepIndex = currentStep
    ? steps.findIndex((step) => step.id === currentStep)
    : 0;
  const canGoBack = stepIndex > 0;
  const isBusy =
    isSaving || settingsLoading || isGeneratingSearchTerms || isValidatingLlm;

  const currentCopy = currentStep ? STEP_COPY[currentStep] : STEP_COPY.llm;

  const primaryLabel =
    currentStep === "llm"
      ? llmValidated
        ? "Revalidate connection"
        : "Save connection"
      : currentStep === "cv"
        ? cvChoice === "skip"
          ? "Finish step"
          : cvDocument
            ? "Save brief"
            : "Upload to continue"
        : currentStep === "searchterms"
          ? hasSavedSearchTermsInSession
            ? "Update search terms"
            : "Save search terms"
          : basicAuthChoice === "enable"
            ? "Enable authentication"
            : basicAuthChoice === "skip"
              ? "Finish onboarding"
              : "Choose an option";

  return {
    basicAuthChoice,
    canGoBack,
    complete,
    control,
    currentCopy,
    currentStep,
    cvChoice,
    cvDocument,
    isBusy,
    isGeneratingSearchTerms,
    hasSavedSearchTermsInSession,
    llmKeyHint,
    llmValidation,
    primaryLabel,
    progressValue,
    searchTermsSource,
    searchTermsStale,
    selectedProvider,
    settings,
    settingsLoading,
    steps,
    watch,
    setCurrentStep,
    setBasicAuthChoice,
    setCvChoice,
    setCvDocument,
    setValue,
    handleRegenerateSearchTerms: async () => {
      await handleGenerateSearchTerms({ showToast: true });
    },
    handleBack: () => {
      if (!canGoBack) return;
      setCurrentStep(steps[stepIndex - 1]?.id ?? currentStep);
    },
    handlePrimaryAction,
    markSearchTermsStale,
  };
}
