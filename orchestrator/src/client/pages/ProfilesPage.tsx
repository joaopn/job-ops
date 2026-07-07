import * as api from "@client/api";
import { PageHeader, PageMain } from "@client/components/layout";
import { queryKeys } from "@client/lib/queryKeys";
import { toast } from "@client/lib/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfileCard } from "./profiles/ProfileCard";

export function ProfilesPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.profiles.list(),
    queryFn: api.getProfiles,
  });

  const createMutation = useMutation({
    mutationFn: () => api.createProfile({ name: "New profile" }),
    onSuccess: () => {
      toast.success("Profile created");
      queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Create failed");
    },
  });

  return (
    <>
      <PageHeader
        icon={Target}
        title="Profiles"
        subtitle="Named scrape sets — search terms, location, run budget, and pinned sources. Pick one when you run the pipeline."
        actions={
          <Button
            type="button"
            size="sm"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            Add profile
          </Button>
        }
      />
      <PageMain>
        <div className="space-y-4">
          {query.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading profiles…
            </div>
          ) : null}
          {query.isError ? (
            <p className="text-sm text-destructive">
              Failed to load profiles:{" "}
              {query.error instanceof Error ? query.error.message : "unknown"}
            </p>
          ) : null}
          {query.data && query.data.profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No profiles yet. Create one to get started.
            </p>
          ) : null}
          {query.data
            ? query.data.profiles.map((profile) => (
                <ProfileCard
                  key={profile.id}
                  profile={profile}
                  defaultProfileId={query.data.defaultProfileId}
                />
              ))
            : null}
        </div>
      </PageMain>
    </>
  );
}
