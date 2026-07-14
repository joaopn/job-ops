import type { SourceConfigsExtractorEntry } from "@client/api";
import { AddActorDialog } from "@client/pages/sources/AddActorDialog";
import { ApifyTokenFields } from "@client/pages/sources/ApifyTokenPanel";
import type {
  AppSettings,
  ProviderActorTemplateSummary,
  ProviderInstanceRow,
} from "@shared/types";
import { AlertCircle, Plus } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Which sources this installation can scrape at all — the User-Profile level.
 *
 * Two tiers. The built-in extractors (`source_configs.enabled`) are free and
 * write that level only: migrate already pinned every enabled extractor into
 * every Search Profile, so the tick here needs no pin write. Apify actors are
 * paid, need an API token, and their pins are NEVER backfilled — so an actor's
 * tick writes BOTH levels (see `handleSaveSources`), and ticking one means it
 * will run, and spend, on the next search.
 */
export const SourcesStep: React.FC<{
  apifyProviderId: string | null;
  apifyTemplates: ProviderActorTemplateSummary[];
  extractors: SourceConfigsExtractorEntry[];
  enabledIds: string[];
  instanceEnabledIds: string[];
  instances: ProviderInstanceRow[];
  isBusy: boolean;
  settings: AppSettings | null | undefined;
  onInstanceCreated: (instance: ProviderInstanceRow) => void;
  onToggle: (extractorId: string, enabled: boolean) => void;
  onToggleInstance: (instanceId: string, enabled: boolean) => void;
}> = ({
  apifyProviderId,
  apifyTemplates,
  extractors,
  enabledIds,
  instanceEnabledIds,
  instances,
  isBusy,
  settings,
  onInstanceCreated,
  onToggle,
  onToggleInstance,
}) => {
  const [addOpen, setAddOpen] = useState(false);

  const noneSelected =
    extractors.length + instances.length > 0 &&
    enabledIds.length === 0 &&
    instanceEnabledIds.length === 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Built-in job boards</CardTitle>
          <CardDescription>
            Free — no account or API key needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Apify actors</CardTitle>
          <CardDescription>
            External and paid — an Apify account and API token are required. An
            actor you add and tick here runs on your next search and spends
            Apify credits. Optional: skip this box entirely if the built-in
            boards are enough.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ApifyTokenFields settings={settings} />

          {instances.length > 0 ? (
            <div className="divide-y divide-border/60 rounded-xl border border-border/60">
              {instances.map((instance) => {
                const checkboxId = `onboarding-instance-${instance.id}`;
                return (
                  <label
                    key={instance.id}
                    htmlFor={checkboxId}
                    className="flex cursor-pointer items-start gap-4 p-4 transition-colors hover:bg-muted/20"
                  >
                    <Checkbox
                      id={checkboxId}
                      className="mt-1"
                      checked={instanceEnabledIds.includes(instance.id)}
                      disabled={isBusy}
                      onCheckedChange={(checked) =>
                        onToggleInstance(instance.id, checked === true)
                      }
                    />
                    <div className="space-y-1">
                      <div className="text-base font-medium text-foreground">
                        {instance.label}
                      </div>
                      <div className="text-sm leading-6 text-muted-foreground">
                        <code>{instance.actorRef}</code>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No actors yet.</p>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={() => setAddOpen(true)}
            disabled={isBusy || apifyProviderId === null}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add actor
          </Button>

          {apifyProviderId ? (
            <AddActorDialog
              open={addOpen}
              onOpenChange={setAddOpen}
              providerId={apifyProviderId}
              templates={apifyTemplates}
              defaultEnabled
              onCreated={onInstanceCreated}
            />
          ) : null}
        </CardContent>
      </Card>

      {noneSelected ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Pick at least one source</AlertTitle>
          <AlertDescription>
            A built-in board or an Apify actor — either counts. With every
            source turned off there is nothing to scrape, and a pipeline run
            will be refused.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
};
