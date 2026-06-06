import type { DuplicateJobGroup, JobListItem } from "@shared/types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runJobAction = vi.fn();
const updateJob = vi.fn();

vi.mock("@client/api", () => ({
  runJobAction: (...args: unknown[]) => runJobAction(...args),
  updateJob: (...args: unknown[]) => updateJob(...args),
}));

vi.mock("@client/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { DuplicateReviewModal } from "./DuplicateReviewModal";

function jobItem(overrides: Partial<JobListItem> & { id: string }): JobListItem {
  return {
    source: "linkedin",
    sourceLabel: "LinkedIn",
    title: "Senior Data Engineer",
    employer: "Acme Corp",
    jobUrl: `https://example.com/${overrides.id}`,
    applicationLink: null,
    datePosted: null,
    deadline: null,
    salary: null,
    location: null,
    status: "discovered",
    outcome: null,
    closedAt: null,
    suitabilityCategory: null,
    tailoringFailureReason: null,
    jobType: null,
    jobFunction: null,
    salaryMinAmount: null,
    salaryMaxAmount: null,
    salaryCurrency: null,
    repostedAt: null,
    repostCount: 0,
    discoveredAt: "2026-05-01T00:00:00.000Z",
    readyAt: null,
    appliedAt: null,
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  } as JobListItem;
}

const group = (): DuplicateJobGroup => ({
  key: "senior data engineer acme corp",
  title: "Senior Data Engineer",
  employer: "Acme Corp",
  jobs: [
    jobItem({ id: "j1", sourceLabel: "LinkedIn", suitabilityCategory: "good_fit" }),
    jobItem({
      id: "j2",
      sourceLabel: "Indeed",
      suitabilityCategory: "very_good_fit",
    }),
  ],
});

const renderModal = () => {
  const pushUndo = vi.fn(
    (_entry: { label: string; restore: () => Promise<void> }) => {},
  );
  const onResolved = vi.fn(() => {});
  const onOpenChange = vi.fn((_open: boolean) => {});
  render(
    <DuplicateReviewModal
      open
      onOpenChange={onOpenChange}
      groups={[group()]}
      onResolved={onResolved}
      pushUndo={pushUndo}
    />,
  );
  return { pushUndo, onResolved, onOpenChange };
};

describe("DuplicateReviewModal", () => {
  beforeEach(() => {
    runJobAction.mockResolvedValue({
      succeeded: 1,
      failed: 0,
      results: [{ jobId: "j1", ok: true, job: {} }],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("pre-selects the best-fit job as keeper", () => {
    renderModal();
    // j2 is very_good_fit → keeper; its row shows the Keep badge.
    const radios = screen.getAllByRole("radio");
    // DOM order matches group.jobs order: [j1, j2].
    expect(radios[1]).toBeChecked();
    expect(radios[0]).not.toBeChecked();
  });

  it("closes the non-keeper jobs and registers undo", async () => {
    const { pushUndo, onResolved } = renderModal();
    fireEvent.click(
      screen.getByRole("button", { name: /Close 1 as duplicate/i }),
    );

    await waitFor(() => expect(runJobAction).toHaveBeenCalledTimes(1));
    expect(runJobAction).toHaveBeenCalledWith({
      action: "mark_duplicated",
      jobIds: ["j1"], // j2 is the keeper
    });
    expect(pushUndo).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalled();
  });

  it("closes the other job when the keeper is changed", async () => {
    renderModal();
    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[0]); // make j1 the keeper

    fireEvent.click(
      screen.getByRole("button", { name: /Close 1 as duplicate/i }),
    );

    await waitFor(() => expect(runJobAction).toHaveBeenCalledTimes(1));
    expect(runJobAction).toHaveBeenCalledWith({
      action: "mark_duplicated",
      jobIds: ["j2"],
    });
  });

  it("skip advances without calling the action", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /Skip group/i }));
    expect(runJobAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Nothing left to review/i)).toBeInTheDocument();
  });
});
