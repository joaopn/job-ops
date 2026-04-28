import * as api from "@client/api";
import type { JobChatMessage, JobChatProposedEdit } from "@shared/types";
import { useMutation } from "@tanstack/react-query";
import { Check, Loader2, RefreshCcw, X } from "lucide-react";
import type React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type EditDiffCardProps = {
  jobId: string;
  message: JobChatMessage;
  proposedEdit: JobChatProposedEdit;
  onAccepted?: () => void | Promise<void>;
  onRejected?: () => void | Promise<void>;
  onRegenerate?: (messageId: string) => void;
  isStreaming?: boolean;
};

/**
 * Shows a proposed edit (cv-edit or brief-edit) underneath an assistant chat
 * message, with [accept] / [reject] / [regenerate] actions. Locks itself once
 * the message's `editStatus` is no longer "pending".
 */
export const EditDiffCard: React.FC<EditDiffCardProps> = ({
  jobId,
  message,
  proposedEdit,
  onAccepted,
  onRejected,
  onRegenerate,
  isStreaming,
}) => {
  const acceptMutation = useMutation({
    mutationFn: () => api.acceptJobChatEdit(jobId, message.id),
    onSuccess: async () => {
      toast.success(
        proposedEdit.kind === "cv-edit"
          ? "CV edit applied — PDF re-rendered"
          : "Brief updated",
      );
      await onAccepted?.();
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : "Failed to accept";
      toast.error(msg);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => api.rejectJobChatEdit(jobId, message.id),
    onSuccess: async () => {
      toast.message("Edit rejected");
      await onRejected?.();
    },
    onError: (error) => {
      const msg = error instanceof Error ? error.message : "Failed to reject";
      toast.error(msg);
    },
  });

  const isPending = message.editStatus === "pending" || message.editStatus === null;
  const isLocked =
    !isPending || acceptMutation.isPending || rejectMutation.isPending;
  const statusLabel =
    message.editStatus === "accepted"
      ? "Accepted"
      : message.editStatus === "rejected"
        ? "Rejected"
        : null;

  return (
    <div className="mt-2 rounded-md border border-border/60 bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
          {proposedEdit.kind === "cv-edit" ? "CV edit" : "Brief edit"}
        </span>
        {statusLabel ? (
          <span className="text-[11px] font-medium text-muted-foreground">
            {statusLabel}
          </span>
        ) : null}
      </div>

      {proposedEdit.kind === "cv-edit" ? (
        <ul className="space-y-2">
          {proposedEdit.edits.map((op, index) => (
            <li
              key={`${op.path.join(".")}-${index}`}
              className="space-y-1 text-xs"
            >
              <div className="font-mono text-[11px] text-muted-foreground">
                {op.path.join(" → ")}
              </div>
              <div className="rounded-sm border border-rose-200 bg-rose-50 px-2 py-1 text-rose-900 line-through">
                {op.from}
              </div>
              <div className="rounded-sm border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-900">
                {op.to}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-1 text-xs">
          {proposedEdit.append ? (
            <>
              <div className="text-[11px] text-muted-foreground">
                Append to brief:
              </div>
              <div className="rounded-sm border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-900 whitespace-pre-wrap">
                {proposedEdit.append}
              </div>
            </>
          ) : null}
          {proposedEdit.replace !== undefined ? (
            <>
              <div className="text-[11px] text-muted-foreground">
                Replace brief with:
              </div>
              <div className="rounded-sm border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900 whitespace-pre-wrap">
                {proposedEdit.replace}
              </div>
            </>
          ) : null}
        </div>
      )}

      {proposedEdit.rationale ? (
        <p className="mt-2 text-[11px] italic text-muted-foreground">
          Rationale: {proposedEdit.rationale}
        </p>
      ) : null}

      {isPending ? (
        <div className="mt-3 flex items-center justify-end gap-1">
          {onRegenerate ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              disabled={isLocked || isStreaming}
              onClick={() => onRegenerate(message.id)}
            >
              <RefreshCcw className="h-3 w-3" />
              Regenerate
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={isLocked}
            onClick={() => rejectMutation.mutate()}
          >
            {rejectMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <X className="h-3 w-3" />
            )}
            Reject
          </Button>
          <Button
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            disabled={isLocked}
            onClick={() => acceptMutation.mutate()}
          >
            {acceptMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            Accept
          </Button>
        </div>
      ) : null}
    </div>
  );
};
