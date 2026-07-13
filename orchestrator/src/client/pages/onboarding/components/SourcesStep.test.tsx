import type { SourceConfigsExtractorEntry } from "@client/api";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourcesStep } from "./SourcesStep";

function makeExtractor(
  extractorId: string,
  displayName: string,
  description?: string,
): SourceConfigsExtractorEntry {
  return {
    extractorId,
    displayName,
    description,
    providesSources: [],
    row: {
      extractorId,
      enabled: true,
      config: {},
      mappings: {},
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    schema: null,
    effectiveSettings: {},
  };
}

const EXTRACTORS = [
  makeExtractor("jobspy", "JobSpy", "LinkedIn, Indeed and Glassdoor in one."),
  makeExtractor("hiringcafe", "Hiring Cafe", "Strong startup coverage."),
];

describe("SourcesStep", () => {
  it("lists every source with its explanation, all ticked", () => {
    render(
      <SourcesStep
        extractors={EXTRACTORS}
        enabledIds={["jobspy", "hiringcafe"]}
        isBusy={false}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/JobSpy/)).toBeChecked();
    expect(screen.getByLabelText(/Hiring Cafe/)).toBeChecked();
    expect(
      screen.getByText("LinkedIn, Indeed and Glassdoor in one."),
    ).toBeInTheDocument();
    expect(screen.getByText("Strong startup coverage.")).toBeInTheDocument();
  });

  it("reports a toggle to its consumer", () => {
    const onToggle = vi.fn();
    render(
      <SourcesStep
        extractors={EXTRACTORS}
        enabledIds={["jobspy", "hiringcafe"]}
        isBusy={false}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByLabelText(/Hiring Cafe/));
    expect(onToggle).toHaveBeenCalledWith("hiringcafe", false);
  });

  it("warns when every source is turned off", () => {
    // A source-less install can only be refused at run time, so say so here.
    render(
      <SourcesStep
        extractors={EXTRACTORS}
        enabledIds={[]}
        isBusy={false}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText(/Pick at least one source/i)).toBeInTheDocument();
  });

  it("does not warn while at least one source is on", () => {
    render(
      <SourcesStep
        extractors={EXTRACTORS}
        enabledIds={["jobspy"]}
        isBusy={false}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Pick at least one source/i)).toBeNull();
  });
});
