import type { JobListItem } from "@shared/types.js";
import { cn } from "@/lib/utils";
import { defaultStatusToken, statusTokens } from "./constants";

interface JobRowContentProps {
  job: JobListItem;
  isSelected?: boolean;
  showStatusDot?: boolean;
  statusDotClassName?: string;
  className?: string;
  staleThresholdDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function getSuitabilityScoreTone(score: number): string {
  if (score >= 70) return "text-emerald-400/90";
  if (score >= 50) return "text-foreground/60";
  return "text-muted-foreground/60";
}

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  // jobspy stores `date_posted` as a Unix-ms numeric string (e.g.
  // "1777075200000") rather than ISO; coerce numeric-only strings.
  if (/^\d+$/.test(value)) {
    const ms = Number(value);
    return Number.isFinite(ms) ? ms : null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAge(
  job: JobListItem,
  now: number,
): { label: string; days: number } | null {
  const posted = parseDate(job.datePosted);
  if (posted != null) {
    const days = Math.max(0, Math.floor((now - posted) / DAY_MS));
    return { label: `Posted ${days}d`, days };
  }
  const found = parseDate(job.discoveredAt);
  if (found != null) {
    const days = Math.max(0, Math.floor((now - found) / DAY_MS));
    return { label: `Found ${days}d`, days };
  }
  return null;
}

export const JobRowContent = ({
  job,
  isSelected = false,
  showStatusDot = true,
  statusDotClassName,
  className,
  staleThresholdDays,
}: JobRowContentProps) => {
  const hasScore = job.suitabilityScore != null;
  const statusToken = statusTokens[job.status] ?? defaultStatusToken;
  const suitabilityTone = getSuitabilityScoreTone(job.suitabilityScore ?? 0);
  const age = formatAge(job, Date.now());
  const isStale =
    job.status === "discovered" &&
    age != null &&
    typeof staleThresholdDays === "number" &&
    staleThresholdDays > 0 &&
    age.days >= staleThresholdDays;
  const repostCount = job.repostCount ?? 0;

  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-3", className)}>
      <span
        className={cn(
          "h-2 w-2 rounded-full shrink-0",
          statusToken.dot,
          !isSelected && "opacity-70",
          statusDotClassName,
          !showStatusDot && "hidden",
        )}
        title={statusToken.label}
      />

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm leading-tight",
            isSelected ? "font-semibold" : "font-medium",
            isStale && "text-muted-foreground",
          )}
        >
          {job.title}
        </div>
        <div className="truncate text-xs text-muted-foreground mt-0.5">
          {job.employer}
          {job.location && (
            <span className="before:content-['_in_']">{job.location}</span>
          )}
        </div>
        {(age || repostCount > 0 || job.salary?.trim()) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {age && (
              <span
                className={cn(
                  "tabular-nums",
                  isStale && "text-muted-foreground/70",
                )}
              >
                {age.label}
              </span>
            )}
            {repostCount > 0 && (
              <span
                className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-200 tabular-nums"
                title={`Repost #${repostCount}`}
              >
                Reposted {repostCount > 9 ? "9+" : repostCount}×
              </span>
            )}
            {job.salary?.trim() && (
              <span className="truncate">{job.salary}</span>
            )}
          </div>
        )}
      </div>

      {hasScore && (
        <div className="shrink-0 text-right">
          <span className={cn("text-xs tabular-nums", suitabilityTone)}>
            {job.suitabilityScore}
          </span>
        </div>
      )}
    </div>
  );
};
