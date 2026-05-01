import * as api from "@client/api";
import type { PromptDescriptor } from "@client/api";
import { queryKeys } from "@client/lib/queryKeys";
import { SettingsSectionFrame } from "@client/pages/settings/components/SettingsSectionFrame";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, FileText, Loader2, RefreshCw } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type PromptsPanelProps = {
  layoutMode?: "accordion" | "panel";
};

export const PromptsPanel: React.FC<PromptsPanelProps> = ({ layoutMode }) => {
  const queryClient = useQueryClient();
  const [reloadingName, setReloadingName] = useState<string | null>(null);

  const promptsQuery = useQuery<PromptDescriptor[]>({
    queryKey: queryKeys.prompts.list(),
    queryFn: api.listPrompts,
  });

  const reloadMutation = useMutation({
    mutationFn: async (name: string | null) => api.reloadPrompt(name ?? undefined),
    onSuccess: async (_result, name) => {
      toast.success(
        name
          ? `Reloaded ${name} from disk`
          : "Reloaded all prompts from disk",
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.prompts.all,
      });
    },
    onError: (err: unknown, name) => {
      const message = err instanceof Error ? err.message : "Reload failed";
      toast.error(
        name
          ? `Reload failed for ${name}: ${message}`
          : `Reload failed: ${message}`,
      );
    },
    onSettled: () => {
      setReloadingName(null);
    },
  });

  const handleReload = (name: string | null) => {
    setReloadingName(name);
    reloadMutation.mutate(name);
  };

  const prompts = promptsQuery.data ?? [];
  const isReloadingAll = reloadingName === null && reloadMutation.isPending;

  return (
    <SettingsSectionFrame
      mode={layoutMode}
      title={
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          <span className="text-base font-semibold tracking-wider">Prompts</span>
        </div>
      }
      value="prompts"
    >
      <div className="space-y-4 pt-2">
        <p className="text-xs text-muted-foreground">
          LLM prompts are loaded from <code>prompts/*.yaml</code>, bind-mounted
          into the container. Edit the files on the host with any editor, then
          click Reload to drop the in-memory cache so the next pipeline run
          picks up your edits. Reload validates the YAML and surfaces parse
          errors here instead of letting them bleed into the next pipeline run.
        </p>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {promptsQuery.isLoading
              ? "Loading…"
              : `${prompts.length} prompts on disk`}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleReload(null)}
            disabled={reloadMutation.isPending || promptsQuery.isLoading}
          >
            {isReloadingAll ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
            )}
            Reload all
          </Button>
        </div>

        {promptsQuery.isError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Failed to list prompts</AlertTitle>
            <AlertDescription>
              {promptsQuery.error instanceof Error
                ? promptsQuery.error.message
                : "Unknown error"}
            </AlertDescription>
          </Alert>
        ) : null}

        {prompts.length > 0 ? (
          <div className="rounded-md border border-border/60 divide-y divide-border/40">
            {prompts.map((prompt) => {
              const isReloading =
                reloadingName === prompt.name && reloadMutation.isPending;
              return (
                <div
                  key={prompt.name}
                  className="flex items-start justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-medium">{prompt.name}</code>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        modified {new Date(prompt.modifiedAt).toLocaleString()}
                      </span>
                    </div>
                    {prompt.description ? (
                      <p className="text-xs text-muted-foreground">
                        {prompt.description}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleReload(prompt.name)}
                    disabled={reloadMutation.isPending}
                  >
                    {isReloading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-2 hidden sm:inline">Reload</span>
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </SettingsSectionFrame>
  );
};
