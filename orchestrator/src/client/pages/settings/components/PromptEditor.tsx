import * as api from "@client/api";
import { queryKeys } from "@client/lib/queryKeys";
import { toast } from "@client/lib/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, RotateCcw, Save } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type PromptEditorProps = {
  name: string;
};

/**
 * Raw-YAML editor for one prompt row. Owns the draft: the detail query seeds
 * it ONCE (hydrate-once ref — background refetches never clobber typing), and
 * after a successful save/reset the baseline always follows the server while
 * the draft is overwritten only if the user didn't type during the round-trip.
 * Collapsing the editor drops an unsaved draft — same policy as the app's
 * other draft editors (no navigation guard).
 */
export const PromptEditor: React.FC<PromptEditorProps> = ({ name }) => {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [baseline, setBaseline] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const hydratedRef = useRef(false);

  const detailQuery = useQuery({
    queryKey: queryKeys.prompts.detail(name),
    queryFn: () => api.getPrompt(name),
  });

  const detail = detailQuery.data;
  if (detail && !hydratedRef.current) {
    hydratedRef.current = true;
    setDraft(detail.content);
    setBaseline(detail.content);
  }

  const dirty = draft !== baseline;

  const saveMutation = useMutation({
    mutationFn: (content: string) => api.updatePrompt(name, content),
    onSuccess: async (updated, sentContent) => {
      setSaveError(null);
      setBaseline(updated.content);
      // Preserve keystrokes typed while the PUT was in flight: only sync the
      // draft when it still equals what was sent.
      setDraft((current) =>
        current === sentContent ? updated.content : current,
      );
      toast.success(`Saved ${name}`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all });
    },
    onError: (err: unknown) => {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => api.resetPrompt(name),
    onSuccess: async (updated) => {
      setSaveError(null);
      setBaseline(updated.content);
      setDraft(updated.content);
      toast.success(`Reset ${name} to default`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Reset failed";
      toast.error(`Reset failed for ${name}: ${message}`);
    },
  });

  const handleSave = () => {
    if (!dirty || saveMutation.isPending) return;
    saveMutation.mutate(draft);
  };

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading prompt…
      </div>
    );
  }

  if (detailQuery.isError || !detail) {
    return (
      <Alert variant="destructive" className="mx-4 my-3">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Failed to load prompt</AlertTitle>
        <AlertDescription>
          {detailQuery.error instanceof Error
            ? detailQuery.error.message
            : "Unknown error"}
        </AlertDescription>
      </Alert>
    );
  }

  const canReset = detail.edited || dirty;

  return (
    <div className="space-y-3 px-4 pb-4">
      <Textarea
        aria-label={`Prompt content for ${name}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={20}
        spellCheck={false}
        className="font-mono text-xs"
        disabled={resetMutation.isPending}
      />

      {saveError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Save rejected</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap">
            {saveError}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {dirty ? "Unsaved changes" : "Saved"}
        </span>
        <div className="flex items-center gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canReset || resetMutation.isPending}
              >
                {resetMutation.isPending ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-3.5 w-3.5" />
                )}
                Reset to default
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset {name} to default?</AlertDialogTitle>
                <AlertDialogDescription>
                  This replaces the live prompt with the baked default from the
                  image. Your edits to this prompt are discarded.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => resetMutation.mutate()}>
                  Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-2 h-3.5 w-3.5" />
            )}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
};
