import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type { PipelineSettingsValues } from "@client/pages/settings/types";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type React from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

type PipelineSettingsSectionProps = {
  values: PipelineSettingsValues;
  isLoading: boolean;
  isSaving: boolean;
  layoutMode?: "accordion" | "panel";
};

const ONE_MB = 1024 * 1024;
const MAX_BYTE_CAP = 500 * ONE_MB;

type ByteFieldKey =
  | "maxCvUploadBytes"
  | "maxCoverLetterUploadBytes"
  | "maxExpandedLatexBytes";

type ByteField = {
  key: ByteFieldKey;
  label: string;
  description: string;
};

const BYTE_FIELDS: ByteField[] = [
  {
    key: "maxCvUploadBytes",
    label: "CV upload size (MB)",
    description:
      "Caps the multipart upload accepted by /api/cv and /api/cv/upload-template. A larger archive returns 422.",
  },
  {
    key: "maxCoverLetterUploadBytes",
    label: "Cover-letter upload size (MB)",
    description:
      "Caps the multipart upload accepted by /api/coverletter/upload-template.",
  },
  {
    key: "maxExpandedLatexBytes",
    label: "Expanded LaTeX size (MB)",
    description:
      "Caps the size of the flattened tex (after `\\input{}` resolution). Triggered before tectonic compile.",
  },
];

const bytesToMb = (bytes: number): number =>
  Math.round((bytes / ONE_MB) * 100) / 100;
const mbToBytes = (mb: number): number => Math.round(mb * ONE_MB);

export const PipelineSettingsSection: React.FC<
  PipelineSettingsSectionProps
> = ({ values, isLoading, isSaving, layoutMode }) => {
  const {
    autoTailoringEnabled,
    enableJobScoring,
    inboxStaleThresholdDays,
    inboxAgeoutThresholdDays,
    maxCvUploadBytes,
    maxCoverLetterUploadBytes,
    maxExpandedLatexBytes,
  } = values;
  const byteValues: Record<
    ByteFieldKey,
    { effective: number; default: number }
  > = {
    maxCvUploadBytes,
    maxCoverLetterUploadBytes,
    maxExpandedLatexBytes,
  };
  const {
    control,
    formState: { errors },
  } = useFormContext<UpdateSettingsInput>();

  return (
    <SettingsSectionFrame
      mode={layoutMode}
      title="Pipeline Behavior"
      value="pipeline"
    >
      <div className="space-y-4">
        <div className="flex items-start space-x-3">
          <Controller
            name="autoTailoringEnabled"
            control={control}
            render={({ field }) => (
              <Checkbox
                id="autoTailoringEnabled"
                checked={field.value ?? autoTailoringEnabled.default}
                onCheckedChange={(checked) => {
                  field.onChange(
                    checked === "indeterminate" ? null : checked === true,
                  );
                }}
                disabled={isLoading || isSaving}
              />
            )}
          />
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="autoTailoringEnabled"
              className="text-sm font-medium leading-none cursor-pointer"
            >
              Auto-tailor selected jobs after each pipeline run
            </label>
            <p className="text-xs text-muted-foreground">
              When off (default), the pipeline ranks jobs but does not tailor
              them. Use the Tailor button on selected jobs from the ranked list.
              When on, the pipeline tailors the top N jobs above the score
              threshold automatically.
            </p>
          </div>
        </div>

        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">
              Auto-tailor effective
            </div>
            <div className="break-words font-mono text-xs">
              {autoTailoringEnabled.effective ? "Enabled" : "Disabled"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              Auto-tailor default
            </div>
            <div className="break-words font-mono text-xs font-semibold">
              {autoTailoringEnabled.default ? "Enabled" : "Disabled"}
            </div>
          </div>
        </div>

        <div className="flex items-start space-x-3">
          <Controller
            name="enableJobScoring"
            control={control}
            render={({ field }) => (
              <Checkbox
                id="enableJobScoring"
                checked={field.value ?? enableJobScoring.default}
                onCheckedChange={(checked) => {
                  field.onChange(
                    checked === "indeterminate" ? null : checked === true,
                  );
                }}
                disabled={isLoading || isSaving}
              />
            )}
          />
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="enableJobScoring"
              className="text-sm font-medium leading-none cursor-pointer"
            >
              Score discovered jobs with the LLM
            </label>
            <p className="text-xs text-muted-foreground">
              When on (default), each new job is scored 0–100 for fit and gets a
              one-line reason. Turn off to skip the LLM scoring step entirely;
              jobs land in the inbox unscored and you triage them manually.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="inboxStaleThresholdDays"
            className="text-sm font-medium"
          >
            Inbox stale threshold (days)
          </label>
          <Controller
            name="inboxStaleThresholdDays"
            control={control}
            rules={{
              validate: (v) =>
                v === null ||
                v === undefined ||
                (Number.isInteger(v) && v >= 0 && v <= 365) ||
                "Must be between 0 and 365",
            }}
            render={({ field }) => (
              <Input
                id="inboxStaleThresholdDays"
                type="number"
                min={0}
                max={365}
                step={1}
                placeholder={String(inboxStaleThresholdDays.default)}
                disabled={isLoading || isSaving}
                value={field.value ?? ""}
                onChange={(e) => {
                  const value = e.target.valueAsNumber;
                  field.onChange(Number.isFinite(value) ? value : null);
                }}
              />
            )}
          />
          {errors.inboxStaleThresholdDays && (
            <div className="text-xs text-destructive">
              {errors.inboxStaleThresholdDays.message as string}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Inbox rows older than this are dimmed as stale. 0 disables visual
            staling.
          </div>
          <div className="text-xs text-muted-foreground">
            Current:{" "}
            <span className="font-mono">
              {inboxStaleThresholdDays.effective}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="inboxAgeoutThresholdDays"
            className="text-sm font-medium"
          >
            Inbox age-out threshold (days)
          </label>
          <Controller
            name="inboxAgeoutThresholdDays"
            control={control}
            rules={{
              validate: (v) =>
                v === null ||
                v === undefined ||
                (Number.isInteger(v) && v >= 0 && v <= 365) ||
                "Must be between 0 and 365",
            }}
            render={({ field }) => (
              <Input
                id="inboxAgeoutThresholdDays"
                type="number"
                min={0}
                max={365}
                step={1}
                placeholder={String(inboxAgeoutThresholdDays.default)}
                disabled={isLoading || isSaving}
                value={field.value ?? ""}
                onChange={(e) => {
                  const value = e.target.valueAsNumber;
                  field.onChange(Number.isFinite(value) ? value : null);
                }}
              />
            )}
          />
          {errors.inboxAgeoutThresholdDays && (
            <div className="text-xs text-destructive">
              {errors.inboxAgeoutThresholdDays.message as string}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Inbox rows older than this auto-move to Backlog at the start of the
            next pipeline run. 0 disables auto-aging.
          </div>
          <div className="text-xs text-muted-foreground">
            Current:{" "}
            <span className="font-mono">
              {inboxAgeoutThresholdDays.effective}
            </span>
          </div>
        </div>

        {BYTE_FIELDS.map((field) => {
          const value = byteValues[field.key];
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
                  validate: (v) => {
                    if (v === null || v === undefined) return true;
                    if (typeof v !== "number" || !Number.isFinite(v))
                      return "Invalid value";
                    if (v < ONE_MB || v > MAX_BYTE_CAP)
                      return `Must be between 1 MB and ${MAX_BYTE_CAP / ONE_MB} MB`;
                    return true;
                  },
                }}
                render={({ field: controllerField }) => (
                  <Input
                    id={field.key}
                    type="number"
                    min={1}
                    max={MAX_BYTE_CAP / ONE_MB}
                    step={1}
                    placeholder={String(bytesToMb(value.default))}
                    disabled={isLoading || isSaving}
                    value={
                      typeof controllerField.value === "number"
                        ? bytesToMb(controllerField.value)
                        : ""
                    }
                    onChange={(e) => {
                      const raw = e.target.valueAsNumber;
                      controllerField.onChange(
                        Number.isFinite(raw) ? mbToBytes(raw) : null,
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
                  {bytesToMb(value.effective)} MB
                </span>
                {" — "}Default:{" "}
                <span className="font-mono">{bytesToMb(value.default)} MB</span>
              </div>
            </div>
          );
        })}
      </div>
    </SettingsSectionFrame>
  );
};
