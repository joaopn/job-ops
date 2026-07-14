import * as api from "@client/api";
import { queryKeys } from "@client/lib/queryKeys";
import { toast } from "@client/lib/toast";
import type { AppSettings } from "@shared/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ApifyTokenPanelProps {
  // The Sources page holds this as `AppSettings | undefined` (a raw query) and
  // the onboarding wizard as `AppSettings | null` (useSettings defaults to null).
  settings: AppSettings | null | undefined;
}

/**
 * The token copy + field on their own, so the Sources page (inside its Card)
 * and the onboarding wizard's Apify box render one implementation.
 */
export function ApifyTokenFields({ settings }: ApifyTokenPanelProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const tokenHint = settings?.apifyApiTokenHint ?? null;

  useEffect(() => {
    setDraft("");
  }, [tokenHint]);

  const mutation = useMutation({
    mutationFn: async (token: string) =>
      api.updateSettings({ apifyApiToken: token }),
    onSuccess: () => {
      toast.success("Apify token saved");
      setDraft("");
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.current() });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Save failed");
    },
  });

  const onSave = () => {
    if (mutation.isPending) return;
    if (draft.trim() === "" && tokenHint === null) return;
    mutation.mutate(draft);
  };

  const placeholder = tokenHint
    ? `${tokenHint}${"*".repeat(20)}`
    : "apify_api_…";

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Used by every Apify actor below.{" "}
        <a
          href="https://console.apify.com/account/integrations"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline"
        >
          Get yours
          <ExternalLink className="h-3 w-3" />
        </a>
        . Stored in app settings; never echoed back in full.
      </p>
      <div className="space-y-1">
        <Label htmlFor="apify-token">Token</Label>
        <div className="flex gap-2">
          <Input
            id="apify-token"
            type="password"
            value={draft}
            placeholder={placeholder}
            onChange={(event) => setDraft(event.target.value)}
            autoComplete="off"
          />
          <Button
            type="button"
            onClick={onSave}
            disabled={mutation.isPending || draft === ""}
          >
            {mutation.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1 h-3.5 w-3.5" />
            )}
            Save
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {tokenHint
            ? `Currently set (starts with ${tokenHint}). Type a new value to replace.`
            : "Not set — Apify actors will fail until you save one."}
        </p>
      </div>
    </div>
  );
}

export function ApifyTokenPanel({ settings }: ApifyTokenPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Apify API token</CardTitle>
      </CardHeader>
      <CardContent>
        <ApifyTokenFields settings={settings} />
      </CardContent>
    </Card>
  );
}
