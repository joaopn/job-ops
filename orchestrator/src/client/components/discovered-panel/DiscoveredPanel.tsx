import * as api from "@client/api";
import { useSkipJobMutation } from "@client/hooks/queries/useJobMutations";
import { useRescoreJob } from "@client/hooks/useRescoreJob";
import type { Job } from "@shared/types.js";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { JobDetailsEditDrawer } from "../JobDetailsEditDrawer";
import { DecideMode } from "./DecideMode";
import { EmptyState } from "./EmptyState";
import { ProcessingState } from "./ProcessingState";

interface DiscoveredPanelProps {
  job: Job | null;
  onJobUpdated: () => void | Promise<void>;
  onJobMoved: (jobId: string) => void;
  onTailoringDirtyChange?: (isDirty: boolean) => void;
}

export const DiscoveredPanel: React.FC<DiscoveredPanelProps> = ({
  job,
  onJobUpdated,
  onJobMoved,
  onTailoringDirtyChange,
}) => {
  const [isSkipping, setIsSkipping] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isEditDetailsOpen, setIsEditDetailsOpen] = useState(false);
  const previousJobIdRef = useRef<string | null>(null);
  const skipJobMutation = useSkipJobMutation();
  const { isRescoring, rescoreJob } = useRescoreJob(onJobUpdated);

  useEffect(() => {
    const currentJobId = job?.id ?? null;
    if (previousJobIdRef.current === currentJobId) return;
    previousJobIdRef.current = currentJobId;
    setIsSkipping(false);
    setIsFinalizing(false);
    setIsEditDetailsOpen(false);
    onTailoringDirtyChange?.(false);
  }, [job?.id, onTailoringDirtyChange]);

  const handleSkip = async () => {
    if (!job) return;
    try {
      setIsSkipping(true);
      await skipJobMutation.mutateAsync(job.id);
      toast.message("Job skipped");
      onJobMoved(job.id);
      await onJobUpdated();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to skip job";
      toast.error(message);
    } finally {
      setIsSkipping(false);
    }
  };

  const handleFinalize = async () => {
    if (!job || isFinalizing) return;
    try {
      setIsFinalizing(true);
      await api.processJob(job.id);

      toast.success("Job tailored");

      onJobMoved(job.id);
      await onJobUpdated();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to finalize job";
      toast.error(message);
    } finally {
      setIsFinalizing(false);
    }
  };

  const handleRescore = () => rescoreJob(job?.id);

  if (!job) {
    return <EmptyState />;
  }

  if (job.status === "processing") {
    return <ProcessingState />;
  }

  return (
    <div className="h-full">
      <DecideMode
        job={job}
        onTailor={handleFinalize}
        onSkip={handleSkip}
        isSkipping={isSkipping}
        onRescore={handleRescore}
        isRescoring={isRescoring}
        onEditDetails={() => setIsEditDetailsOpen(true)}
      />

      <JobDetailsEditDrawer
        open={isEditDetailsOpen}
        onOpenChange={setIsEditDetailsOpen}
        job={job}
        onJobUpdated={onJobUpdated}
      />
    </div>
  );
};

export default DiscoveredPanel;
