import type { JobListItem } from "@shared/types.js";
import { Loader2 } from "lucide-react";
import {
  type ReactNode,
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  useVirtualizedList,
  type VirtualListHandle,
} from "@/client/lib/virtual-list";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { FilterTab, FitFilterValue } from "./constants";
import {
  appliedDuplicateIndicator,
  defaultStatusToken,
  emptyStateCopy,
  FIT_FILTER_CHIP_CLASS,
  FIT_FILTER_LABELS,
  FIT_FILTER_VALUES,
  statusTokens,
} from "./constants";
import { JobRowContent } from "./JobRowContent";

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface JobListPanelProps {
  isLoading: boolean;
  jobs: JobListItem[];
  activeJobs: JobListItem[];
  selectedJobId: string | null;
  selectedJobIds: Set<string>;
  activeTab: FilterTab;
  onSelectJob: (jobId: string) => void;
  onToggleSelectJob: (jobId: string, options?: { range?: boolean }) => void;
  onToggleSelectAll: (checked: boolean) => void;
  fitFilter?: FitFilterValue[];
  onFitFilterChange?: (value: FitFilterValue[]) => void;
  primaryEmptyStateAction?: EmptyStateAction;
  secondaryEmptyStateAction?: EmptyStateAction;
  emptyStateMessage?: string;
  staleThresholdDays?: number;
  closedFilterChips?: ReactNode;
  staleControlBar?: ReactNode;
}

const ROW_ESTIMATE = 84;

export const JobListPanel = forwardRef<VirtualListHandle, JobListPanelProps>(
  (
    {
      isLoading,
      jobs,
      activeJobs,
      selectedJobId,
      selectedJobIds,
      activeTab,
      onSelectJob,
      onToggleSelectJob,
      onToggleSelectAll,
      fitFilter,
      onFitFilterChange,
      primaryEmptyStateAction,
      secondaryEmptyStateAction,
      emptyStateMessage,
      staleThresholdDays,
      closedFilterChips,
      staleControlBar,
    },
    ref,
  ) => {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(
      null,
    );
    // Captures shiftKey from the checkbox's onClick so onCheckedChange (which
    // doesn't receive the event) can forward it to the range-aware toggle.
    const lastCheckboxShiftRef = useRef(false);

    const virtualizer = useVirtualizedList({
      count: activeJobs.length,
      mode: "element",
      scrollElement,
      estimateSize: () => ROW_ESTIMATE,
      overscan: 8,
      getItemKey: (index) => activeJobs[index]?.id ?? index,
      // Fallback used when ResizeObserver hasn't measured yet (SSR / jsdom).
      // Real measurements take over after first paint in the browser.
      initialRect: { width: 1024, height: 600 },
    });

    useImperativeHandle(
      ref,
      () => ({
        scrollToIndex: (index, options) =>
          virtualizer.scrollToIndex(index, options),
      }),
      [virtualizer],
    );

    if (isLoading && jobs.length === 0) {
      return (
        <div className="min-w-0 rounded-xl border border-border bg-card shadow-sm">
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <div className="text-sm text-muted-foreground">Loading jobs...</div>
          </div>
        </div>
      );
    }

    const allSelected =
      activeJobs.length > 0 &&
      activeJobs.every((job) => selectedJobIds.has(job.id));
    const showFitChips =
      activeTab === "inbox" && !!fitFilter && !!onFitFilterChange;

    const listHeader = (
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-4 py-2">
        <Checkbox
          id="job-list-select-all"
          checked={allSelected}
          onCheckedChange={() => onToggleSelectAll(!allSelected)}
          disabled={activeJobs.length === 0}
          aria-label="Select all filtered jobs"
        />
        {showFitChips && fitFilter && onFitFilterChange ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {FIT_FILTER_VALUES.map((value) => {
              const active = fitFilter.includes(value);
              const classes = FIT_FILTER_CHIP_CLASS[value];
              return (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn(
                    "h-7 px-2 text-xs font-medium",
                    active ? classes.active : classes.inactive,
                  )}
                  aria-pressed={active}
                  onClick={() =>
                    onFitFilterChange(
                      active
                        ? fitFilter.filter((entry) => entry !== value)
                        : FIT_FILTER_VALUES.filter(
                            (entry) =>
                              fitFilter.includes(entry) || entry === value,
                          ),
                    )
                  }
                >
                  {FIT_FILTER_LABELS[value]}
                </Button>
              );
            })}
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {selectedJobIds.size} selected
        </span>
      </div>
    );

    if (activeJobs.length === 0) {
      const fitFilterActive = !!fitFilter && fitFilter.length > 0;
      return (
        <div className="flex min-w-0 flex-col rounded-xl border border-border bg-card shadow-sm">
          {closedFilterChips ? (
            <div className="shrink-0 border-b border-border/40">
              {closedFilterChips}
            </div>
          ) : null}
          {staleControlBar ? (
            <div className="shrink-0">{staleControlBar}</div>
          ) : null}
          {listHeader}
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-12 text-center">
            <div className="text-base font-semibold">No jobs found</div>
            <p className="max-w-md text-sm text-muted-foreground">
              {fitFilterActive
                ? "No jobs match the active fit filter. Click a highlighted chip above to clear it."
                : (emptyStateMessage ?? emptyStateCopy[activeTab])}
            </p>
            {fitFilterActive && onFitFilterChange ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onFitFilterChange([])}
              >
                Clear fit filter
              </Button>
            ) : (
              (primaryEmptyStateAction || secondaryEmptyStateAction) && (
                <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
                  {primaryEmptyStateAction && (
                    <Button size="sm" onClick={primaryEmptyStateAction.onClick}>
                      {primaryEmptyStateAction.label}
                    </Button>
                  )}
                  {secondaryEmptyStateAction && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={secondaryEmptyStateAction.onClick}
                    >
                      {secondaryEmptyStateAction.label}
                    </Button>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      );
    }

    const virtualItems = virtualizer.getVirtualItems();

    return (
      <div className="flex min-w-0 flex-col rounded-xl border border-border bg-card shadow-sm lg:h-[calc(100vh-14rem)]">
        {closedFilterChips ? (
          <div className="shrink-0 border-b border-border/40">
            {closedFilterChips}
          </div>
        ) : null}
        {staleControlBar ? (
          <div className="shrink-0">{staleControlBar}</div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col">
          {listHeader}
          <div
            ref={(el) => {
              scrollRef.current = el;
              setScrollElement(el);
            }}
            data-virtual-scroll-container="true"
            data-testid="job-list-scroll"
            className="relative min-h-0 flex-1 overflow-y-auto"
          >
            <div
              className="relative"
              style={{ height: `${virtualizer.getTotalSize()}px` }}
            >
            {virtualItems.map((virtualRow) => {
              const job = activeJobs[virtualRow.index];
              if (!job) return null;

              const isSelected = job.id === selectedJobId;
              const isChecked = selectedJobIds.has(job.id);
              const statusToken =
                statusTokens[job.status] ?? defaultStatusToken;
              const statusDotClassName = job.appliedDuplicateMatch
                ? appliedDuplicateIndicator.dot
                : statusToken.dot;
              const statusDotTitle = job.appliedDuplicateMatch
                ? appliedDuplicateIndicator.label
                : statusToken.label;

              return (
                <div
                  key={virtualRow.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  data-job-id={job.id}
                  data-virtual-row="true"
                  className={cn(
                    "group absolute left-0 top-0 flex w-full items-center gap-3 border-l-2 border-b px-4 py-3 transition-colors cursor-pointer",
                    isChecked
                      ? "!border-l !border-l-primary !bg-muted/40"
                      : "border-l border-l-border/40",
                    isSelected
                      ? "bg-primary/15"
                      : "border-b-border/40 hover:bg-muted/20",
                    isChecked && isSelected && "outline-2 outline-primary/30",
                  )}
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="relative h-4 w-4 shrink-0">
                    <span
                      className={cn(
                        "absolute inset-0 m-auto h-2 w-2 rounded-full transition-opacity duration-150 ease-out",
                        statusDotClassName,
                        isChecked || isSelected
                          ? "opacity-0"
                          : "opacity-100 group-hover:opacity-0",
                      )}
                      title={statusDotTitle}
                    />
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => {
                        // Consume + reset the shift flag so a keyboard-space
                        // toggle (which doesn't fire onClick) can't inherit a
                        // stale shiftKey from an earlier mouse click. Only
                        // pass options when shift is actually held so plain
                        // clicks satisfy `toHaveBeenCalledWith(id)` matchers
                        // and avoid the extra-arg footgun.
                        const range = lastCheckboxShiftRef.current;
                        lastCheckboxShiftRef.current = false;
                        if (range) {
                          onToggleSelectJob(job.id, { range: true });
                        } else {
                          onToggleSelectJob(job.id);
                        }
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        lastCheckboxShiftRef.current = event.shiftKey;
                      }}
                      aria-label={`Select ${job.title}`}
                      className={cn(
                        "absolute inset-0 m-0 border-border/80 cursor-pointer text-muted-foreground/70 transition-opacity duration-150 ease-out",
                        "data-[state=checked]:border-primary data-[state=checked]:bg-primary/20 data-[state=checked]:text-primary",
                        "data-[state=checked]:shadow-[0_0_0_1px_hsl(var(--primary)/0.35)]",
                        isChecked || isSelected
                          ? "opacity-100 pointer-events-auto"
                          : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto",
                      )}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      if (event.shiftKey) {
                        // Shift-click anywhere on the row extends the range
                        // selection (or single-toggles when no anchor is
                        // set). preventDefault to avoid accidental text
                        // selection from the shift modifier.
                        event.preventDefault();
                        onToggleSelectJob(job.id, { range: true });
                        return;
                      }
                      if (event.ctrlKey || event.metaKey) {
                        // Ctrl/Cmd-click toggles this row in the checkbox
                        // selection without opening detail. Anchor moves to
                        // this row so a following shift-click extends from
                        // here. Matches Gmail / Finder UX.
                        onToggleSelectJob(job.id);
                        return;
                      }
                      onSelectJob(job.id);
                    }}
                    data-testid={`select-${job.id}`}
                    className="flex min-w-0 flex-1 cursor-pointer text-left"
                    aria-pressed={isSelected}
                  >
                    <JobRowContent
                      job={job}
                      isSelected={isSelected}
                      showStatusDot={false}
                      staleThresholdDays={staleThresholdDays}
                    />
                  </button>
                </div>
              );
            })}
            </div>
          </div>
        </div>
      </div>
    );
  },
);

JobListPanel.displayName = "JobListPanel";
