import * as api from "@client/api";
import { Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface StaleControlBarProps {
  thresholdDays: number;
  onThresholdChange: (value: number) => void;
  onSwept: () => Promise<void> | void;
}

const MIN_DAYS = 1;
const MAX_DAYS = 365;

const clampDays = (value: number): number =>
  Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.floor(value)));

export const StaleControlBar = ({
  thresholdDays,
  onThresholdChange,
  onSwept,
}: StaleControlBarProps) => {
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const days = clampDays(thresholdDays);
    if (!Number.isFinite(days)) {
      toast.error("Enter a valid number of days (1-365).");
      return;
    }
    setBusy(true);
    try {
      const result = await api.sweepStaleJobs(days);
      if (result.moved === 0) {
        toast.message("No rows older than the threshold.");
      } else {
        const parts: string[] = [];
        if (result.breakdown.discovered > 0) {
          parts.push(`${result.breakdown.discovered} from Inbox`);
        }
        if (result.breakdown.selected > 0) {
          parts.push(`${result.breakdown.selected} from Selected`);
        }
        if (result.breakdown.backlog > 0) {
          parts.push(`${result.breakdown.backlog} from Backlog`);
        }
        toast.success(`${result.moved} jobs moved to Stale`, {
          description: parts.length > 0 ? parts.join(" · ") : undefined,
        });
      }
      await onSwept();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sweep stale rows";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-center gap-2 border-b border-border/40 px-4 py-2"
    >
      <label
        htmlFor="stale-threshold-days"
        className="text-xs text-muted-foreground"
      >
        Older than
      </label>
      <Input
        id="stale-threshold-days"
        type="number"
        inputMode="numeric"
        min={MIN_DAYS}
        max={MAX_DAYS}
        value={thresholdDays}
        onChange={(event) => {
          const raw = Number.parseInt(event.target.value, 10);
          if (Number.isFinite(raw)) {
            onThresholdChange(clampDays(raw));
          }
        }}
        className="h-7 w-20 px-2 text-xs"
        disabled={busy}
      />
      <span className="text-xs text-muted-foreground">days</span>
      <Button
        type="submit"
        size="sm"
        variant="default"
        disabled={busy}
        className="ml-auto h-7 px-3 text-xs"
      >
        {busy ? (
          <>
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            Sweeping...
          </>
        ) : (
          "Move stale rows here"
        )}
      </Button>
    </form>
  );
};
