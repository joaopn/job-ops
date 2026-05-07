import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type { ContextLimitsValues } from "@client/pages/settings/types";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type React from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";

type ContextLimitsSectionProps = {
  values: ContextLimitsValues;
  isLoading: boolean;
  isSaving: boolean;
  layoutMode?: "accordion" | "panel";
};

type FieldKey =
  | "maxBriefChars"
  | "maxJobDescriptionChars"
  | "maxTailoredContentChars"
  | "maxCoverLetterChars"
  | "maxFetchedJobHtmlChars"
  | "maxExtractionPromptChars";

type FieldDef = {
  key: FieldKey;
  label: string;
  description: string;
  min: number;
  max: number;
};

const FIELDS: FieldDef[] = [
  {
    key: "maxBriefChars",
    label: "Personal brief (chars)",
    description:
      "Caps the personal brief saved on a CV. The full brief flows raw into every LLM scorer/tailoring/onboarding call — no in-prompt truncation.",
    min: 1000,
    max: 1_000_000,
  },
  {
    key: "maxJobDescriptionChars",
    label: "Job description (chars)",
    description:
      "Caps a job's `jobDescription` text on PATCH. The same cap is checked when ghostwriter context is built.",
    min: 1000,
    max: 1_000_000,
  },
  {
    key: "maxTailoredContentChars",
    label: "Tailored content (chars)",
    description:
      "Caps the JSON-serialized override snapshot produced by per-job tailoring. Exceeding it returns 422 — lift the cap or trim your CV.",
    min: 1000,
    max: 1_000_000,
  },
  {
    key: "maxCoverLetterChars",
    label: "Cover-letter draft (chars)",
    description: "Caps the `coverLetterDraft` body persisted on a job.",
    min: 1000,
    max: 1_000_000,
  },
  {
    key: "maxFetchedJobHtmlChars",
    label: "Fetched job HTML (chars)",
    description:
      "Caps the cleaned page text returned by the manual-job URL fetcher. A larger page returns 422 instead of being silently truncated.",
    min: 10_000,
    max: 5_000_000,
  },
  {
    key: "maxExtractionPromptChars",
    label: "Extraction prompt (chars)",
    description:
      "Caps the per-CV / per-cover-letter system-prompt override the user pastes into the upload form.",
    min: 1000,
    max: 1_000_000,
  },
];

export const ContextLimitsSection: React.FC<ContextLimitsSectionProps> = ({
  values,
  isLoading,
  isSaving,
  layoutMode,
}) => {
  const {
    control,
    formState: { errors },
  } = useFormContext<UpdateSettingsInput>();

  return (
    <SettingsSectionFrame
      mode={layoutMode}
      title="Context limits"
      value="context-limits"
    >
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Increasing these allows longer briefs / JDs / cover letters to flow
          into LLM prompts. Lowering them makes ingest reject larger content
          with a clear error rather than silently dropping it.
        </p>

        {FIELDS.map((field) => {
          const value = values[field.key];
          const error = errors[field.key as keyof typeof errors];
          return (
            <div className="space-y-2" key={field.key}>
              <label htmlFor={field.key} className="text-sm font-medium">
                {field.label}
              </label>
              <Controller
                name={field.key}
                control={control}
                rules={{
                  validate: (v) =>
                    v === null ||
                    v === undefined ||
                    (Number.isInteger(v) && v >= field.min && v <= field.max) ||
                    `Must be between ${field.min} and ${field.max}`,
                }}
                render={({ field: controllerField }) => (
                  <Input
                    id={field.key}
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={1}
                    placeholder={String(value.default)}
                    disabled={isLoading || isSaving}
                    value={
                      typeof controllerField.value === "number"
                        ? controllerField.value
                        : ""
                    }
                    onChange={(e) => {
                      const raw = e.target.valueAsNumber;
                      controllerField.onChange(
                        Number.isFinite(raw) ? raw : null,
                      );
                    }}
                  />
                )}
              />
              {error && (
                <div className="text-xs text-destructive">
                  {(error as { message?: string }).message}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {field.description}
              </div>
              <div className="text-xs text-muted-foreground">
                Current:{" "}
                <span className="font-mono">
                  {value.effective.toLocaleString()}
                </span>
                {" — "}Default:{" "}
                <span className="font-mono">
                  {value.default.toLocaleString()}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </SettingsSectionFrame>
  );
};
