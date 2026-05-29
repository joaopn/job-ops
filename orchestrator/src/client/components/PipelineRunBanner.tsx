import type {
  JobSource,
  PipelineProgressEvent,
  PipelineSourceStats,
} from "@shared/types";
import {
  CheckCircle2,
  Clock,
  Loader2,
  AlertTriangle,
  RotateCcw,
  X,
  XCircle,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { subscribeToEventSource } from "@/client/lib/sse";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface PipelineRunBannerProps {
  isRunning: boolean;
  // Re-run a single source (built-in extractor or provider instance) using the
  // current saved run settings. Omit to hide the per-row re-run button.
  onRerunSource?: (source: JobSource) => void;
}

const stepLabels: Record<PipelineProgressEvent["step"], string> = {
  idle: "Ready",
  crawling: "Crawling",
  importing: "Importing",
  scoring: "Scoring",
  processing: "Processing",
  completed: "Complete",
  cancelled: "Cancelled",
  failed: "Failed",
};

const stepBadgeClasses: Record<PipelineProgressEvent["step"], string> = {
  idle: "bg-muted text-muted-foreground border-border",
  crawling: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  importing: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  scoring: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  processing: "bg-primary/10 text-primary border-primary/20",
  completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  cancelled: "bg-muted text-muted-foreground border-border",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function computePercentage(progress: PipelineProgressEvent): number {
  switch (progress.step) {
    case "crawling": {
      if (progress.crawlingTermsTotal > 0) {
        return clamp(
          5 +
            (progress.crawlingTermsProcessed / progress.crawlingTermsTotal) *
              10,
          5,
          15,
        );
      }
      if (progress.crawlingListPagesTotal > 0) {
        return clamp(
          (progress.crawlingListPagesProcessed /
            progress.crawlingListPagesTotal) *
            15,
          0,
          15,
        );
      }
      if (progress.crawlingListPagesProcessed > 0) return 8;
      return 5;
    }
    case "importing":
      return 20;
    case "scoring": {
      if (progress.jobsScored > 0) {
        return clamp(
          20 +
            (progress.jobsScored / Math.max(progress.jobsDiscovered, 1)) * 30,
          20,
          50,
        );
      }
      return 25;
    }
    case "processing": {
      if (progress.totalToProcess > 0) {
        return clamp(
          50 + (progress.jobsProcessed / progress.totalToProcess) * 50,
          50,
          100,
        );
      }
      return 55;
    }
    case "completed":
    case "cancelled":
    case "failed":
      return 100;
    default:
      return 0;
  }
}

function formatDuration(ms?: number): string {
  if (typeof ms !== "number" || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds - minutes * 60);
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

const StatusCell: React.FC<{ status: PipelineSourceStats["status"] }> = ({
  status,
}) => {
  switch (status) {
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          Pending
        </span>
      );
    case "running":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-sky-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Running
        </span>
      );
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Done
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <XCircle className="h-3.5 w-3.5" />
          Failed
        </span>
      );
  }
};

export const PipelineRunBanner: React.FC<PipelineRunBannerProps> = ({
  isRunning,
  onRerunSource,
}) => {
  const [progress, setProgress] = useState<PipelineProgressEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const lastStartedAtRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!isRunning) return;

    const unsubscribe = subscribeToEventSource<PipelineProgressEvent>(
      "/api/pipeline/progress",
      {
        onOpen: () => setIsConnected(true),
        onMessage: (payload) => {
          if (
            payload.startedAt &&
            payload.startedAt !== lastStartedAtRef.current
          ) {
            lastStartedAtRef.current = payload.startedAt;
            setDismissed(false);
          }
          setProgress(payload);
        },
        onError: () => setIsConnected(false),
      },
    );

    return () => {
      unsubscribe();
      setIsConnected(false);
    };
  }, [isRunning]);

  const percentage = useMemo(
    () => (progress ? computePercentage(progress) : 0),
    [progress],
  );

  if (dismissed) return null;
  if (!isRunning && !progress) return null;

  const step = progress?.step ?? "idle";
  const isActive =
    step !== "idle" &&
    step !== "completed" &&
    step !== "cancelled" &&
    step !== "failed";

  const sourceStats = progress?.sourceStats ?? [];
  const anyFailures = sourceStats.some((row) => row.status === "failed");

  return (
    <div className="border-b bg-background/60 backdrop-blur">
      <div className="w-full px-4 py-3">
        <Card className="border-0 bg-transparent shadow-none">
          <CardHeader className="space-y-2 p-0">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <CardTitle className="text-base">Pipeline</CardTitle>
                <Badge
                  variant="outline"
                  className={cn(
                    "uppercase tracking-wide",
                    stepBadgeClasses[step],
                  )}
                >
                  {stepLabels[step]}
                </Badge>
                <span className="truncate text-xs text-muted-foreground">
                  {isConnected ? "Live" : "Connecting…"}
                </span>
                {anyFailures && (step === "completed" || step === "failed") && (
                  <span className="inline-flex items-center gap-1 text-xs text-destructive">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {sourceStats.filter((row) => row.status === "failed").length}{" "}
                    failed
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {isActive && <Loader2 className="h-4 w-4 animate-spin" />}
                <span className="tabular-nums">{Math.round(percentage)}%</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Dismiss pipeline banner"
                  className="h-7 w-7"
                  onClick={() => setDismissed(true)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <Progress value={percentage} className="h-2" />
          </CardHeader>

          {progress && (
            <CardContent className="space-y-3 p-0 pt-3">
              <div className="space-y-1">
                <p className="text-sm">{progress.message}</p>
                {progress.detail && (
                  <p className="text-sm text-muted-foreground">
                    {progress.detail}
                  </p>
                )}
              </div>

              {sourceStats.length > 0 && (
                <>
                  <Separator />
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-44">Platform</TableHead>
                          <TableHead className="w-28">Status</TableHead>
                          <TableHead className="w-20 text-right">
                            Scraped
                          </TableHead>
                          <TableHead className="w-20 text-right">
                            Imported
                          </TableHead>
                          <TableHead className="w-20 text-right">
                            Duplicated
                          </TableHead>
                          <TableHead className="w-20 text-right">
                            Rejected
                          </TableHead>
                          <TableHead className="w-24 text-right">
                            Duration
                          </TableHead>
                          {onRerunSource && <TableHead className="w-16" />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sourceStats.map((row) => (
                          <SourceRow
                            key={row.id}
                            row={row}
                            onRerun={!isActive ? onRerunSource : undefined}
                            showRerunColumn={!!onRerunSource}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}

              {step === "failed" && progress.error && sourceStats.length === 0 && (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                  {progress.error}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
};

const SourceRow: React.FC<{
  row: PipelineSourceStats;
  onRerun?: (source: JobSource) => void;
  showRerunColumn: boolean;
}> = ({ row, onRerun, showRerunColumn }) => {
  // "Rejected" bundles everything found but not kept: pre-import filter drops
  // (location / blocked company) plus import-time rejects (bad data).
  const rejectedTotal = row.jobsFiltered + row.jobsRejected;
  return (
    <>
      <TableRow>
        <TableCell className="font-medium">{row.label}</TableCell>
        <TableCell>
          <StatusCell status={row.status} />
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {row.status === "pending" ? "—" : row.jobsScraped}
        </TableCell>
        <TableCell
          className="text-right tabular-nums"
          title={
            row.jobsReposted > 0
              ? `${row.jobsImported} new + ${row.jobsReposted} reposted`
              : undefined
          }
        >
          {row.status === "pending"
            ? "—"
            : row.jobsImported + row.jobsReposted}
        </TableCell>
        <TableCell className="text-right tabular-nums text-muted-foreground">
          {row.status === "pending" ? "—" : row.jobsDuplicated}
        </TableCell>
        <TableCell
          className={cn(
            "text-right tabular-nums",
            rejectedTotal > 0 ? "text-destructive" : "text-muted-foreground",
          )}
          title={
            rejectedTotal > 0
              ? `${row.jobsFiltered} filtered (location/blocked) + ${row.jobsRejected} rejected (bad data)`
              : undefined
          }
        >
          {row.status === "pending" ? "—" : rejectedTotal}
        </TableCell>
        <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
          {formatDuration(row.durationMs)}
        </TableCell>
        {showRerunColumn && (
          <TableCell className="text-right">
            {onRerun && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title={`Re-run ${row.label}`}
                aria-label={`Re-run ${row.label}`}
                onClick={() => onRerun(row.id as JobSource)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
          </TableCell>
        )}
      </TableRow>
      {row.status === "failed" && row.error && (
        <TableRow className="border-b-0 hover:bg-transparent">
          <TableCell
            colSpan={showRerunColumn ? 8 : 7}
            className="py-1 text-xs text-destructive whitespace-pre-wrap"
          >
            {row.error}
          </TableCell>
        </TableRow>
      )}
    </>
  );
};
