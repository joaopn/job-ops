import type { LlmProviderId } from "@client/pages/settings/utils";
import type {
  CvDocument,
  SearchTermsSuggestionResponse,
} from "@shared/types.js";
import type React from "react";
import type { Control } from "react-hook-form";
import type {
  BasicAuthChoice,
  CvChoice,
  OnboardingFormData,
  StepId,
  ValidationState,
} from "../types";
import { BasicAuthStep } from "./BasicAuthStep";
import { CvUploadStep } from "./CvUploadStep";
import { LlmConnectionStep } from "./LlmConnectionStep";
import { SearchTermsStep } from "./SearchTermsStep";

export const OnboardingStepContent: React.FC<{
  basicAuthChoice: BasicAuthChoice;
  basicAuthPassword: string;
  basicAuthUser: string;
  control: Control<OnboardingFormData>;
  currentStep: StepId;
  cvChoice: CvChoice;
  cvDocument: CvDocument | null;
  isBusy: boolean;
  isGeneratingSearchTerms: boolean;
  hasSavedSearchTermsInSession: boolean;
  llmKeyHint: string | null;
  llmValidation: ValidationState;
  personalBrief: string;
  searchTermDraft: string;
  searchTerms: string[];
  searchTermsSource: SearchTermsSuggestionResponse["source"] | null;
  searchTermsStale: boolean;
  selectedProvider: LlmProviderId;
  onBasicAuthChoiceChange: (choice: BasicAuthChoice) => void;
  onBasicAuthPasswordChange: (value: string) => void;
  onBasicAuthUserChange: (value: string) => void;
  onCvChoiceChange: (choice: CvChoice) => void;
  onCvDocumentChange: (cv: CvDocument) => void;
  onPersonalBriefChange: (value: string) => void;
  onRegenerateSearchTerms: () => Promise<void>;
  onSearchTermDraftChange: (value: string) => void;
  onSearchTermsChange: (values: string[]) => void;
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

  if (props.currentStep === "searchterms") {
    return (
      <SearchTermsStep
        hasSavedSearchTermsInSession={props.hasSavedSearchTermsInSession}
        isBusy={props.isBusy}
        isGeneratingSearchTerms={props.isGeneratingSearchTerms}
        searchTermDraft={props.searchTermDraft}
        searchTerms={props.searchTerms}
        searchTermsSource={props.searchTermsSource}
        searchTermsStale={props.searchTermsStale}
        onRegenerate={props.onRegenerateSearchTerms}
        onSearchTermDraftChange={props.onSearchTermDraftChange}
        onSearchTermsChange={props.onSearchTermsChange}
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
