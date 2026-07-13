import type { SourceConfigsExtractorEntry } from "@client/api";
import { AlertCircle } from "lucide-react";
import type React from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Which sources this installation can scrape at all — the User-Profile level
 * (`source_configs.enabled`), not a per-search-profile pick. Apify actors are
 * deliberately absent: they are paid, need an API token, and are configured
 * later on the Sources page.
 */
export const SourcesStep: React.FC<{
  extractors: SourceConfigsExtractorEntry[];
  enabledIds: string[];
  isBusy: boolean;
  onToggle: (extractorId: string, enabled: boolean) => void;
}> = ({ extractors, enabledIds, isBusy, onToggle }) => {
  const noneSelected = extractors.length > 0 && enabledIds.length === 0;

  return (
    <div className="space-y-4">
      {extractors.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading sources…</p>
      ) : (
        <div className="divide-y divide-border/60 rounded-xl border border-border/60">
          {extractors.map((extractor) => {
            const checkboxId = `onboarding-source-${extractor.extractorId}`;
            return (
              <label
                key={extractor.extractorId}
                htmlFor={checkboxId}
                className="flex cursor-pointer items-start gap-4 p-4 transition-colors hover:bg-muted/20"
              >
                <Checkbox
                  id={checkboxId}
                  className="mt-1"
                  checked={enabledIds.includes(extractor.extractorId)}
                  disabled={isBusy}
                  onCheckedChange={(checked) =>
                    onToggle(extractor.extractorId, checked === true)
                  }
                />
                <div className="space-y-1">
                  <div className="text-base font-medium text-foreground">
                    {extractor.displayName}
                  </div>
                  {extractor.description ? (
                    <div className="text-sm leading-6 text-muted-foreground">
                      {extractor.description}
                    </div>
                  ) : null}
                </div>
              </label>
            );
          })}
        </div>
      )}

      {noneSelected ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Pick at least one source</AlertTitle>
          <AlertDescription>
            With every source turned off there is nothing to scrape, and a
            pipeline run will be refused.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
};
