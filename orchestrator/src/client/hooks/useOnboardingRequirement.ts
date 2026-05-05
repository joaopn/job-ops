import * as api from "@client/api";
import { useSettings } from "@client/hooks/useSettings";
import { isOnboardingComplete } from "@client/lib/onboarding";
import { normalizeLlmProvider } from "@client/pages/settings/utils";
import type { ValidationResult } from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const EMPTY_VALIDATION_STATE: ValidationResult & { checked: boolean } = {
  valid: false,
  message: null,
  checked: false,
};

export function useOnboardingRequirement() {
  const { settings, isLoading: settingsLoading } = useSettings();

  const [llmValidation, setLlmValidation] = useState(EMPTY_VALIDATION_STATE);

  const selectedProvider = normalizeLlmProvider(settings?.llmProvider?.value);
  // Re-validate whenever the LLM inputs the wizard can mutate change. Without
  // this, the very first mount runs against an unconfigured provider, sets
  // `checked: true, valid: false`, and the effect's `checked` guard prevents
  // any further validation — so completing the wizard never flips `complete`.
  const validationKey = settings
    ? `${selectedProvider}|${settings.llmBaseUrl?.value ?? ""}|${settings.llmApiKeyHint ?? ""}`
    : null;
  const lastValidatedKeyRef = useRef<string | null>(null);

  const runValidations = useCallback(async () => {
    if (!settings) return;

    try {
      const result = await api.validateLlm({
        provider: selectedProvider,
        baseUrl: settings.llmBaseUrl?.value || undefined,
      });
      setLlmValidation({ ...result, checked: true });
    } catch (error) {
      setLlmValidation({
        valid: false,
        message:
          error instanceof Error ? error.message : "LLM validation failed",
        checked: true,
      });
    }
  }, [selectedProvider, settings]);

  useEffect(() => {
    if (!settings || settingsLoading) return;
    if (validationKey === null) return;
    if (lastValidatedKeyRef.current === validationKey) return;
    lastValidatedKeyRef.current = validationKey;
    setLlmValidation(EMPTY_VALIDATION_STATE);
    void runValidations();
  }, [runValidations, settings, settingsLoading, validationKey]);

  const complete = useMemo(() => {
    return isOnboardingComplete({
      settings,
      llmValid: llmValidation.valid,
    });
  }, [llmValidation.valid, settings]);

  const checking =
    settingsLoading || !settings || !llmValidation.checked;

  return {
    checking,
    complete,
  };
}
