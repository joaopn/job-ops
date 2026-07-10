import * as api from "@client/api";
import { queryKeys } from "@client/lib/queryKeys";
import type { StoredUserProfile } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// The active name changes only via a rename (which invalidates
// queryKeys.userProfiles) or a switch (which hard-reloads the page), so the
// staleTime merely throttles refetch-on-focus noise.
const ACTIVE_NAME_STALE_MS = 5 * 60_000;

type UserProfileSwitcherProps = {
  activateProfile: (id: string) => void;
  isPending: boolean;
  onCloseDrawer: () => void;
};

/**
 * The nav drawer's profile line: shows the active user profile and, opened,
 * lists the stored ones so a switch works from ANY page — including mid-
 * onboarding, where Settings is unreachable behind the gate. Owns no switch
 * state: the mutation and overlay live in PageHeader (via useProfileSwitch),
 * which survives this component unmounting when the drawer closes.
 */
export function UserProfileSwitcher({
  activateProfile,
  isPending,
  onCloseDrawer,
}: UserProfileSwitcherProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingSwitch, setPendingSwitch] =
    useState<StoredUserProfile | null>(null);

  // Both queryFns defer the api property access into the arrow: this
  // component mounts inside every page's header, so tests with partial
  // `vi.mock("@client/api")` factories reach it — vitest mock modules THROW
  // on accessing an export missing from the factory, even when the query
  // would never fetch.
  const activeQuery = useQuery({
    queryKey: queryKeys.userProfiles.active(),
    queryFn: () => api.getActiveUserProfile(),
    staleTime: ACTIVE_NAME_STALE_MS,
  });

  // The list opens a short-lived connection per stored profile server-side,
  // and the drawer opens on every navigation — fetch only on switch intent.
  const listQuery = useQuery({
    queryKey: queryKeys.userProfiles.list(),
    queryFn: () => api.getUserProfiles(),
    enabled: menuOpen,
  });

  if (!activeQuery.data) return null;
  const activeName = activeQuery.data.name;

  const storedProfiles = (listQuery.data?.stored ?? []).filter(
    (profile) => !profile.invalid,
  );

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
          >
            Profile: {activeName}
            <ChevronDown className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem disabled>
            <Check className="mr-2 h-3.5 w-3.5" />
            {activeName}
          </DropdownMenuItem>
          {listQuery.isLoading ? (
            <DropdownMenuItem disabled>Loading profiles…</DropdownMenuItem>
          ) : null}
          {!listQuery.isLoading && storedProfiles.length === 0 ? (
            <DropdownMenuItem disabled>No other profiles</DropdownMenuItem>
          ) : null}
          {storedProfiles.map((profile) => (
            <DropdownMenuItem
              key={profile.id}
              disabled={isPending}
              onSelect={() => setPendingSwitch(profile)}
            >
              {profile.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={pendingSwitch !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSwitch(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Switch to &quot;{pendingSwitch?.name}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The current profile is stashed and the app restarts into the
              selected one. Sessions do not carry across profiles — expect a
              re-login when authentication is enabled. Switching is blocked
              while a pipeline run is in flight.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingSwitch) {
                  onCloseDrawer();
                  activateProfile(pendingSwitch.id);
                }
                setPendingSwitch(null);
              }}
            >
              Switch profile
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
