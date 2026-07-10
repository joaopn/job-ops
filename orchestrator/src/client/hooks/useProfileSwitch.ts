import * as api from "@client/api";
import { reloadApp, waitForServerRestart } from "@client/lib/restart-poll";
import { toast } from "@client/lib/toast";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

export type ProfileSwitchState = null | "switching" | "timeout";

/**
 * The user-profile switch flow: activate (or stash into a fresh profile),
 * then ride the server restart behind a full-screen overlay and reload.
 * Each hook instance owns its own state — render a
 * `<ProfileSwitchOverlay state={switchState} />` next to whichever trigger
 * uses it, and host the hook in a component that survives until the reload
 * (a drawer's contents unmount when it closes — hold the hook above that).
 */
export function useProfileSwitch() {
  const [switchState, setSwitchState] = useState<ProfileSwitchState>(null);

  const beginSwitch = async () => {
    setSwitchState("switching");
    const result = await waitForServerRestart();
    if (result === "restarted") {
      reloadApp();
      return;
    }
    setSwitchState("timeout");
  };

  const activateMutation = useMutation({
    mutationFn: (id: string) => api.activateUserProfile(id),
    onSuccess: () => {
      void beginSwitch();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Activation failed",
      );
    },
  });

  const newProfileMutation = useMutation({
    mutationFn: () => api.newUserProfile(),
    onSuccess: () => {
      void beginSwitch();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "New profile failed",
      );
    },
  });

  return {
    switchState,
    activateProfile: (id: string) => activateMutation.mutate(id),
    startNewProfile: () => newProfileMutation.mutate(),
    isPending: activateMutation.isPending || newProfileMutation.isPending,
  };
}
