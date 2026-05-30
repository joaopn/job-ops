import type { CreateJobInput } from "@shared/types";
import { beforeEach, describe, expect, it } from "vitest";
import {
  captureRunJobs,
  getRunJobs,
  resetRunJobCapture,
  toCapturedRunJob,
} from "./run-job-capture";

function makeInput(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    source: "linkedin",
    title: "Engineer",
    employer: "Acme",
    jobUrl: "https://example.com/job/1",
    ...overrides,
  };
}

describe("run-job-capture", () => {
  beforeEach(() => {
    resetRunJobCapture();
  });

  it("captures jobs per source and bucket and reads them back", () => {
    captureRunJobs("linkedin", "scraped", [
      toCapturedRunJob(makeInput({ jobUrl: "u1" })),
      toCapturedRunJob(makeInput({ jobUrl: "u2" })),
    ]);
    captureRunJobs("linkedin", "imported", [
      toCapturedRunJob(makeInput({ jobUrl: "u1" })),
    ]);

    expect(getRunJobs("linkedin", "scraped")).toHaveLength(2);
    expect(getRunJobs("linkedin", "imported")).toHaveLength(1);
    expect(getRunJobs("linkedin", "duplicated")).toEqual([]);
    expect(getRunJobs("indeed", "scraped")).toEqual([]);
  });

  it("appends across calls and carries a rejection reason", () => {
    captureRunJobs("indeed", "rejected", [
      toCapturedRunJob(makeInput(), "location mismatch"),
    ]);
    captureRunJobs("indeed", "rejected", [
      toCapturedRunJob(makeInput({ jobUrl: "u3" }), "bad data"),
    ]);

    const rejected = getRunJobs("indeed", "rejected");
    expect(rejected).toHaveLength(2);
    expect(rejected.map((job) => job.reason)).toEqual([
      "location mismatch",
      "bad data",
    ]);
  });

  it("reset clears everything", () => {
    captureRunJobs("linkedin", "scraped", [toCapturedRunJob(makeInput())]);
    resetRunJobCapture();
    expect(getRunJobs("linkedin", "scraped")).toEqual([]);
  });

  it("toCapturedRunJob copies the user-relevant fields", () => {
    const captured = toCapturedRunJob(
      makeInput({
        location: "Berlin",
        salary: "100k",
        jobType: "full-time",
        jobLevel: "senior",
        datePosted: "2026-05-01",
      }),
    );
    expect(captured).toMatchObject({
      title: "Engineer",
      employer: "Acme",
      location: "Berlin",
      salary: "100k",
      jobType: "full-time",
      jobLevel: "senior",
      datePosted: "2026-05-01",
    });
  });
});
