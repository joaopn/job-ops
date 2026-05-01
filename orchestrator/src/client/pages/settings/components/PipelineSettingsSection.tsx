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

export const PipelineSettingsSection: React.FC<
  PipelineSettingsSectionProps
> = ({ values, isLoading, isSaving, layoutMode }) => {
  const {
    autoTailoringEnabled,
    inboxStaleThresholdDays,
    inboxAgeoutThresholdDays,
  } = values;
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
      </div>
    </SettingsSectionFrame>
  );
};
