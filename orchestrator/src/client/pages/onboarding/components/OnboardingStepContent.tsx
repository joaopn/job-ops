import type { SourceConfigsExtractorEntry } from "@client/api";
import type { EditorForm } from "@client/pages/profiles/ProfileConfigFields";
import type { LlmProviderId } from "@client/pages/settings/utils";
import type {
  CvDocument,
  CvSourceFormat,
  ProviderInstanceRow,
  SearchTermsSuggestionResponse,
} from "@shared/types.js";
import type React from "react";
import type { Control } from "react-hook-form";
import type {
  BasicAuthChoice,
  CvChoice,
  CvFormatChoice,
  OnboardingFormData,
  StepId,
  ValidationState,
} from "../types";
import { BasicAuthStep } from "./BasicAuthStep";
import { CvFormatStep } from "./CvFormatStep";
import { CvUploadStep } from "./CvUploadStep";
import { LlmConnectionStep } from "./LlmConnectionStep";
import { SearchProfileStep } from "./SearchProfileStep";
import { SourcesStep } from "./SourcesStep";

export const OnboardingStepContent: React.FC<{
  basicAuthChoice: BasicAuthChoice;
  basicAuthPassword: string;
  basicAuthUser: string;
  control: Control<OnboardingFormData>;
  currentStep: StepId;
  cvChoice: CvChoice;
  cvDocument: CvDocument | null;
  cvFormatChoice: CvFormatChoice;
  extractors: SourceConfigsExtractorEntry[];
  hasExistingCv: boolean;
  instances: ProviderInstanceRow[];
  searchProfileForm: EditorForm | null;
  sourceEnabledIds: string[];
  storedCvSourceFormat: CvSourceFormat | null;
  isBusy: boolean;
  isGeneratingSearchTerms: boolean;
  hasSavedSearchTermsInSession: boolean;
  llmKeyHint: string | null;
  llmValidation: ValidationState;
  personalBrief: string;
  searchTermsSource: SearchTermsSuggestionResponse["source"] | null;
  searchTermsStale: boolean;
  selectedProvider: LlmProviderId;
  onBasicAuthChoiceChange: (choice: BasicAuthChoice) => void;
  onBasicAuthPasswordChange: (value: string) => void;
  onBasicAuthUserChange: (value: string) => void;
  onCvChoiceChange: (choice: CvChoice) => void;
  onCvDocumentChange: (cv: CvDocument) => void;
  onCvFormatChoiceChange: (choice: CvFormatChoice) => void;
  onPersonalBriefChange: (value: string) => void;
  onProfileFormChange: (patch: Partial<EditorForm>) => void;
  onRegenerateSearchTerms: () => Promise<void>;
  onToggleSource: (extractorId: string, enabled: boolean) => void;
}> = (props) => {
  if (props.currentStep === "llm") {
    return (
      <LlmConnectionStep
        control={props.control}
        isBusy={props.isBusy}
        llmKeyHint={props.llmKeyHint}
        selectedProvider={props.selectedProvider}
        validation={props.llmValidation}
      />
    );
  }

  if (props.currentStep === "cvformat") {
    return (
      <CvFormatStep
        choice={props.cvFormatChoice}
        hasExistingCv={props.hasExistingCv}
        isBusy={props.isBusy}
        onChoiceChange={props.onCvFormatChoiceChange}
        storedFormat={props.storedCvSourceFormat}
      />
    );
  }

  if (props.currentStep === "cv") {
    return (
      <CvUploadStep
        isBusy={props.isBusy}
        cvChoice={props.cvChoice}
        onCvChoiceChange={props.onCvChoiceChange}
        cvDocument={props.cvDocument}
        onCvDocumentChange={props.onCvDocumentChange}
        personalBrief={props.personalBrief}
        onPersonalBriefChange={props.onPersonalBriefChange}
      />
    );
  }

  if (props.currentStep === "searchprofile") {
    return (
      <SearchProfileStep
        extractors={props.extractors}
        form={props.searchProfileForm}
        instances={props.instances}
        isBusy={props.isBusy}
        isGeneratingSearchTerms={props.isGeneratingSearchTerms}
        searchTermsSource={props.searchTermsSource}
        searchTermsStale={props.searchTermsStale}
        onFormChange={props.onProfileFormChange}
        onRegenerate={props.onRegenerateSearchTerms}
      />
    );
  }

  if (props.currentStep === "sources") {
    return (
      <SourcesStep
        extractors={props.extractors}
        enabledIds={props.sourceEnabledIds}
        isBusy={props.isBusy}
        onToggle={props.onToggleSource}
      />
    );
  }

  return (
    <BasicAuthStep
      basicAuthChoice={props.basicAuthChoice}
      basicAuthPassword={props.basicAuthPassword}
      basicAuthUser={props.basicAuthUser}
      isBusy={props.isBusy}
      onBasicAuthChoiceChange={props.onBasicAuthChoiceChange}
      onBasicAuthPasswordChange={props.onBasicAuthPasswordChange}
      onBasicAuthUserChange={props.onBasicAuthUserChange}
    />
  );
};
