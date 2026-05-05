import type { AppSettings, JobSource } from "@shared/types";
import type React from "react";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AutomaticRunTab } from "./AutomaticRunTab";
import type { AutomaticRunValues } from "./automatic-run";

interface RunModeModalProps {
  open: boolean;
  settings: AppSettings | null;
  enabledSources: JobSource[];
  pipelineSources: JobSource[];
  onToggleSource: (source: JobSource, checked: boolean) => void;
  onSetPipelineSources: (sources: JobSource[]) => void;
  isPipelineRunning: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveAndRunAutomatic: (values: AutomaticRunValues) => Promise<void>;
}

export const RunModeModal: React.FC<RunModeModalProps> = ({
  open,
  settings,
  enabledSources,
  pipelineSources,
  onToggleSource,
  onSetPipelineSources,
  isPipelineRunning,
  onOpenChange,
  onSaveAndRunAutomatic,
}) => {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <div className="flex h-full flex-col">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              Run pipeline
            </SheetTitle>
            <SheetDescription>
              Discover, score, and tailor jobs from configured sources.
            </SheetDescription>
          </SheetHeader>

          <Separator className="my-4" />

          <div className="min-h-0 flex-1">
            <AutomaticRunTab
              open={open}
              settings={settings}
              enabledSources={enabledSources}
              pipelineSources={pipelineSources}
              onToggleSource={onToggleSource}
              onSetPipelineSources={onSetPipelineSources}
              isPipelineRunning={isPipelineRunning}
              onSaveAndRun={onSaveAndRunAutomatic}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
