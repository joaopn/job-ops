import * as api from "@client/api";
import { queryKeys } from "@client/lib/queryKeys";
import type { AppSettings } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AddActorDialog } from "./AddActorDialog";
import { ApifyTokenPanel } from "./ApifyTokenPanel";
import { ProviderInstanceCard } from "./ProviderInstanceCard";

interface ApifyTabProps {
  settings: AppSettings | undefined;
}

export function ApifyTab({ settings }: ApifyTabProps) {
  const [addOpen, setAddOpen] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.providerInstances.list(),
    queryFn: api.getProviderInstances,
  });

  const apifyProvider = query.data?.providers.find((p) => p.id === "apify");

  return (
    <div className="space-y-4">
      <ApifyTokenPanel settings={settings} />

      {query.isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading actors…
        </div>
      ) : null}
      {query.isError ? (
        <p className="text-sm text-destructive">
          Failed to load Apify actors:{" "}
          {query.error instanceof Error ? query.error.message : "unknown"}
        </p>
      ) : null}

      {apifyProvider ? (
        <>
          {apifyProvider.instances.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No Apify actors configured yet. Add one to start pulling jobs
              from the Apify marketplace.
            </p>
          ) : (
            apifyProvider.instances.map((instance) => {
              const template = instance.templateId
                ? (apifyProvider.templates.find(
                    (t) => t.id === instance.templateId,
                  ) ?? null)
                : null;
              return (
                <ProviderInstanceCard
                  key={instance.id}
                  instance={instance}
                  template={template}
                />
              );
            })
          )}
          <div>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add actor
            </Button>
          </div>
          <AddActorDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            providerId={apifyProvider.id}
            templates={apifyProvider.templates}
          />
        </>
      ) : null}
    </div>
  );
}
