import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import type { PipelineSettingsValues } from "@client/pages/settings/types";
import type { UpdateSettingsInput } from "@shared/settings-schema.js";
import type React from "react";
import { Controller, useFormContext } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";

type PipelineSettingsSectionProps = {
  values: PipelineSettingsValues;
  isLoading: boolean;
  isSaving: boolean;
  layoutMode?: "accordion" | "panel";
};

export const PipelineSettingsSection: React.FC<
  PipelineSettingsSectionProps
> = ({ values, isLoading, isSaving, layoutMode }) => {
  const { autoTailoringEnabled } = values;
  const { control } = useFormContext<UpdateSettingsInput>();

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
      </div>
    </SettingsSectionFrame>
  );
};
