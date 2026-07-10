import type { ProfileSwitchState } from "@client/hooks/useProfileSwitch";
import { reloadApp } from "@client/lib/restart-poll";
import { AlertTriangle, Loader2 } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

/**
 * Full-screen scrim shown while a user-profile switch rides the server
 * restart. Portaled to document.body: a `backdrop-filter` (or `filter` /
 * `transform`) on any ancestor would otherwise become the containing block
 * for `fixed` positioning and clip the overlay to that ancestor's box —
 * PageHeader's `backdrop-blur` header is exactly such an ancestor.
 */
export function ProfileSwitchOverlay({
  state,
}: {
  state: ProfileSwitchState;
}) {
  if (state === null) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/95 px-6 text-center">
      {state === "switching" ? (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <div className="text-base font-medium">Switching profile…</div>
          <p className="max-w-sm text-sm text-muted-foreground">
            The app is restarting into the selected profile. You may need
            to log in again.
          </p>
        </>
      ) : (
        <>
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <div className="text-base font-medium">
            The app didn&apos;t come back
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            The profile switch went through, but the server hasn&apos;t
            restarted on its own. Restart the app manually, then reload.
          </p>
          <Button type="button" variant="outline" onClick={reloadApp}>
            Reload
          </Button>
        </>
      )}
    </div>,
    document.body,
  );
}
