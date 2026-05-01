import type { JobListItem, JobSource } from "@shared/types";
import { useMemo } from "react";
import type {
  ClosedSubFilter,
  DateFilterDimension,
  FilterTab,
  JobDateFilter,
  JobSort,
  SalaryFilter,
} from "./constants";
import {
  compareJobs,
  getJobDateValue,
  getJobPostedValue,
  parseSalaryBounds,
} from "./utils";

const DAY_MS = 24 * 60 * 60 * 1000;

const dateSortPriorityOrder: DateFilterDimension[] = [
  "ready",
  "applied",
  "closed",
  "discovered",
];

export const useFilteredJobs = (
  jobs: JobListItem[],
  activeTab: FilterTab,
  dateFilter: JobDateFilter,
  sourceFilter: JobSource | "all",
  salaryFilter: SalaryFilter,
  sort: JobSort,
  maxAgeDays: number | null,
  closedSubFilter: ClosedSubFilter,
) =>
  useMemo(() => {
    let filtered = [...jobs];

    if (activeTab === "inbox") {
      filtered = filtered.filter((job) => job.status === "discovered");
    } else if (activeTab === "selected") {
      filtered = filtered.filter(
        (job) => job.status === "selected" || job.status === "processing",
      );
    } else if (activeTab === "ready") {
      filtered = filtered.filter((job) => job.status === "ready");
    } else if (activeTab === "live") {
      filtered = filtered.filter(
        (job) => job.status === "applied" || job.status === "in_progress",
      );
    } else if (activeTab === "backlog") {
      filtered = filtered.filter((job) => job.status === "backlog");
    } else if (activeTab === "closed") {
      filtered = filtered.filter(
        (job) => job.status === "skipped" || job.status === "closed",
      );
      if (closedSubFilter !== "all") {
        if (closedSubFilter === "skipped") {
          filtered = filtered.filter((job) => job.status === "skipped");
        } else {
          filtered = filtered.filter(
            (job) =>
              job.status === "closed" && job.outcome === closedSubFilter,
          );
        }
      }
    } else if (activeTab === "all") {
      const includeClosedJobs = dateFilter.dimensions.includes("closed");
      if (!includeClosedJobs) {
        filtered = filtered.filter(
          (job) => job.status !== "skipped" && job.status !== "closed",
        );
      }
    }

    if (dateFilter.dimensions.length > 0) {
      filtered = filtered.filter((job) =>
        dateFilter.dimensions.some((dimension) =>
          matchesDateDimension(job, dimension, dateFilter),
        ),
      );
    }

    if (sourceFilter !== "all") {
      filtered = filtered.filter((job) => job.source === sourceFilter);
    }

    if (maxAgeDays != null && maxAgeDays > 0) {
      const cutoff = Date.now() - maxAgeDays * DAY_MS;
      filtered = filtered.filter((job) => {
        const posted = getJobPostedValue(job);
        if (posted == null) return false;
        return posted >= cutoff;
      });
    }

    const hasMin =
      typeof salaryFilter.min === "number" &&
      Number.isFinite(salaryFilter.min) &&
      salaryFilter.min > 0;
    const hasMax =
      typeof salaryFilter.max === "number" &&
      Number.isFinite(salaryFilter.max) &&
      salaryFilter.max > 0;

    if (
      (salaryFilter.mode === "at_least" && hasMin) ||
      (salaryFilter.mode === "at_most" && hasMax) ||
      (salaryFilter.mode === "between" && (hasMin || hasMax))
    ) {
      filtered = filtered.filter((job) => {
        const bounds = parseSalaryBounds(job);
        if (!bounds) return false;

        if (salaryFilter.mode === "at_least") {
          return hasMin ? bounds.max >= (salaryFilter.min as number) : true;
        }

        if (salaryFilter.mode === "at_most") {
          return hasMax ? bounds.min <= (salaryFilter.max as number) : true;
        }

        const min = hasMin ? (salaryFilter.min as number) : null;
        const max = hasMax ? (salaryFilter.max as number) : null;

        if (min != null && max != null) {
          return bounds.max >= min && bounds.min <= max;
        }
        if (min != null) return bounds.max >= min;
        if (max != null) return bounds.min <= max;
        return true;
      });
    }

    const effectiveSort =
      sort.key === "date"
        ? { ...sort, datePriority: getDatePriority(dateFilter.dimensions) }
        : sort;

    return [...filtered].sort((a, b) => compareJobs(a, b, effectiveSort));
  }, [
    jobs,
    activeTab,
    dateFilter,
    sourceFilter,
    salaryFilter,
    sort,
    maxAgeDays,
    closedSubFilter,
  ]);

const matchesDateDimension = (
  job: JobListItem,
  dimension: DateFilterDimension,
  filter: JobDateFilter,
): boolean => {
  const value = getJobDateValue(job, dimension);
  if (value == null) return false;

  const localDate = toLocalDateKey(value);
  if (!localDate) return false;

  if (filter.startDate && localDate < filter.startDate) return false;
  if (filter.endDate && localDate > filter.endDate) return false;
  return true;
};

const getDatePriority = (dimensions: DateFilterDimension[]) => {
  const enabled = dateSortPriorityOrder.filter((dimension) =>
    dimensions.includes(dimension),
  );
  return enabled.length > 0 ? enabled : dateSortPriorityOrder;
};

const toLocalDateKey = (value: number): string | null => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
