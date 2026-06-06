import * as api from "@client/api";
import { createJob } from "@shared/testing/factories.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { restoreJobStates, snapshotJob } from "./undo";

vi.mock("@client/api", () => ({ updateJob: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.updateJob).mockResolvedValue(
    createJob({ id: "x" }) as Awaited<ReturnType<typeof api.updateJob>>,
  );
});

describe("snapshotJob", () => {
  it("captures only the reversible triage fields", () => {
    const job = createJob({
      id: "j1",
      status: "applied",
      outcome: null,
      closedAt: null,
    });
    expect(snapshotJob(job)).toEqual({
      jobId: "j1",
      status: "applied",
      outcome: null,
      closedAt: null,
    });
  });
});

describe("restoreJobStates", () => {
  it("PATCHes each snapshot back to its captured state", async () => {
    const result = await restoreJobStates([
      { jobId: "a", status: "discovered", outcome: null, closedAt: null },
      { jobId: "b", status: "applied", outcome: "rejected", closedAt: 1700 },
    ]);

    expect(api.updateJob).toHaveBeenCalledTimes(2);
    expect(api.updateJob).toHaveBeenCalledWith("a", {
      status: "discovered",
      outcome: null,
      closedAt: null,
    });
    expect(api.updateJob).toHaveBeenCalledWith("b", {
      status: "applied",
      outcome: "rejected",
      closedAt: 1700,
    });
    expect(result).toEqual({ restored: 2, failed: 0 });
  });

  it("reports partial failures without rejecting", async () => {
    vi.mocked(api.updateJob)
      .mockResolvedValueOnce(
        createJob({ id: "a" }) as Awaited<ReturnType<typeof api.updateJob>>,
      )
      .mockRejectedValueOnce(new Error("boom"));

    const result = await restoreJobStates([
      { jobId: "a", status: "discovered", outcome: null, closedAt: null },
      { jobId: "b", status: "selected", outcome: null, closedAt: null },
    ]);

    expect(result).toEqual({ restored: 1, failed: 1 });
  });
});
