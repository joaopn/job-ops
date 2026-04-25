import * as api from "@client/api";
import { useSettings } from "@client/hooks/useSettings";
import { isOnboardingComplete } from "@client/lib/onboarding";
import { normalizeLlmProvider } from "@client/pages/settings/utils";
import type { ValidationResult } from "@shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";

const EMPTY_VALIDATION_STATE: ValidationResult & { checked: boolean } = {
  valid: false,
  message: null,
  checked: false,
};

export function useOnboardingRequirement() {
  const { settings, isLoading: settingsLoading } = useSettings();

  const [llmValidation, setLlmValidation] = useState(EMPTY_VALIDATION_STATE);

  const selectedProvider = normalizeLlmProvider(settings?.llmProvider?.value);

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
    if (llmValidation.checked) return;
    void runValidations();
  }, [llmValidation.checked, runValidations, settings, settingsLoading]);

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
