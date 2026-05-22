import { act, fireEvent, render, screen } from "@testing-library/react";
import type { PipelineProgressEvent } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handlers = {
  onOpen?: () => void;
  onMessage: (payload: PipelineProgressEvent) => void;
  onError?: () => void;
};

const lastHandlers: { current: Handlers | null } = { current: null };

vi.mock("@/client/lib/sse", () => ({
  subscribeToEventSource: vi.fn(
    (_url: string, handlers: Handlers): (() => void) => {
      lastHandlers.current = handlers;
      handlers.onOpen?.();
      return () => {
        lastHandlers.current = null;
      };
    },
  ),
}));

import { PipelineRunBanner } from "./PipelineRunBanner";

const baseEvent: PipelineProgressEvent = {
  step: "crawling",
  message: "Fetching jobs from sources...",
  crawlingSource: "jobspy",
  crawlingSourcesCompleted: 0,
  crawlingSourcesTotal: 1,
  crawlingTermsProcessed: 0,
  crawlingTermsTotal: 0,
  crawlingListPagesProcessed: 0,
  crawlingListPagesTotal: 0,
  crawlingJobCardsFound: 0,
  crawlingJobPagesEnqueued: 0,
  crawlingJobPagesSkipped: 0,
  crawlingJobPagesProcessed: 0,
  jobsDiscovered: 0,
  jobsScored: 0,
  jobsProcessed: 0,
  totalToProcess: 0,
  startedAt: "2026-05-22T10:00:00.000Z",
  sourceStats: [
    {
      id: "linkedin",
      label: "LinkedIn",
      status: "running",
      jobsFound: 0,
      jobsScraped: 0,
      jobsImported: 0,
      jobsReposted: 0,
      startedAt: "2026-05-22T10:00:00.000Z",
    },
    {
      id: "indeed",
      label: "Indeed",
      status: "running",
      jobsFound: 0,
      jobsScraped: 0,
      jobsImported: 0,
      jobsReposted: 0,
      startedAt: "2026-05-22T10:00:00.000Z",
    },
  ],
};

describe("PipelineRunBanner", () => {
  beforeEach(() => {
    lastHandlers.current = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when isRunning is false and no event yet", () => {
    const { container } = render(<PipelineRunBanner isRunning={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a per-platform table when running", () => {
    render(<PipelineRunBanner isRunning />);
    act(() => {
      lastHandlers.current?.onMessage(baseEvent);
    });

    expect(screen.getByText("LinkedIn")).toBeInTheDocument();
    expect(screen.getByText("Indeed")).toBeInTheDocument();
    expect(screen.getByText("Pipeline")).toBeInTheDocument();
  });

  it("stays visible after the run reaches a terminal step", () => {
    const { rerender } = render(<PipelineRunBanner isRunning />);
    act(() => {
      lastHandlers.current?.onMessage(baseEvent);
    });
    expect(screen.getByText("LinkedIn")).toBeInTheDocument();

    const terminal: PipelineProgressEvent = {
      ...baseEvent,
      step: "completed",
      message: "Pipeline complete!",
      completedAt: "2026-05-22T10:05:00.000Z",
      sourceStats: baseEvent.sourceStats.map((row) => ({
        ...row,
        status: "completed",
        completedAt: "2026-05-22T10:05:00.000Z",
        durationMs: 300_000,
        jobsFound: 12,
        jobsScraped: 12,
      })),
    };
    act(() => {
      lastHandlers.current?.onMessage(terminal);
    });

    // Banner is still mounted with the per-platform table now showing final counts.
    rerender(<PipelineRunBanner isRunning={false} />);
    expect(screen.getByText("LinkedIn")).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("hides after the user dismisses it", () => {
    render(<PipelineRunBanner isRunning />);
    act(() => {
      lastHandlers.current?.onMessage(baseEvent);
    });

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText("LinkedIn")).not.toBeInTheDocument();
  });

  it("re-arms on a new run (new startedAt) after being dismissed", () => {
    render(<PipelineRunBanner isRunning />);
    act(() => {
      lastHandlers.current?.onMessage(baseEvent);
    });
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText("LinkedIn")).not.toBeInTheDocument();

    const nextRun: PipelineProgressEvent = {
      ...baseEvent,
      startedAt: "2026-05-22T11:00:00.000Z",
    };
    act(() => {
      lastHandlers.current?.onMessage(nextRun);
    });
    expect(screen.getByText("LinkedIn")).toBeInTheDocument();
  });
});
