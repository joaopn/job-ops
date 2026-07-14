import type { SourceConfigsExtractorEntry } from "@client/api";
import { renderWithQueryClient } from "@client/test/renderWithQueryClient";
import { createAppSettings } from "@shared/testing/factories";
import type { ProviderInstanceRow } from "@shared/types";
import { fireEvent, screen } from "@testing-library/react";
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

function makeInstance(id: string, label: string): ProviderInstanceRow {
  return {
    id,
    providerId: "apify",
    templateId: "curious-coder-linkedin",
    label,
    actorRef: "curious_coder/linkedin-jobs-scraper",
    enabled: true,
    inputTemplateJson: "{}",
    outputMappingJson: "{}",
    mappings: {},
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const EXTRACTORS = [
  makeExtractor("jobspy", "JobSpy", "LinkedIn, Indeed and Glassdoor in one."),
  makeExtractor("hiringcafe", "Hiring Cafe", "Strong startup coverage."),
];

const INSTANCES = [makeInstance("i1", "LinkedIn (Apify)")];

function renderStep(overrides?: {
  enabledIds?: string[];
  extractors?: SourceConfigsExtractorEntry[];
  instanceEnabledIds?: string[];
  instances?: ProviderInstanceRow[];
  onToggle?: (extractorId: string, enabled: boolean) => void;
  onToggleInstance?: (instanceId: string, enabled: boolean) => void;
}) {
  return renderWithQueryClient(
    <SourcesStep
      apifyProviderId="apify"
      apifyTemplates={[]}
      extractors={overrides?.extractors ?? EXTRACTORS}
      enabledIds={overrides?.enabledIds ?? ["jobspy", "hiringcafe"]}
      instanceEnabledIds={overrides?.instanceEnabledIds ?? []}
      instances={overrides?.instances ?? []}
      isBusy={false}
      settings={createAppSettings()}
      onInstanceCreated={vi.fn()}
      onToggle={overrides?.onToggle ?? vi.fn()}
      onToggleInstance={overrides?.onToggleInstance ?? vi.fn()}
    />,
  );
}

describe("SourcesStep — built-in box", () => {
  it("lists every source with its explanation, all ticked", () => {
    renderStep();

    expect(screen.getByLabelText(/JobSpy/)).toBeChecked();
    expect(screen.getByLabelText(/Hiring Cafe/)).toBeChecked();
    expect(
      screen.getByText("LinkedIn, Indeed and Glassdoor in one."),
    ).toBeInTheDocument();
    expect(screen.getByText("Strong startup coverage.")).toBeInTheDocument();
  });

  it("reports a toggle to its consumer", () => {
    const onToggle = vi.fn();
    renderStep({ onToggle });

    fireEvent.click(screen.getByLabelText(/Hiring Cafe/));
    expect(onToggle).toHaveBeenCalledWith("hiringcafe", false);
  });
});

describe("SourcesStep — Apify box", () => {
  it("shows the token field and the add-actor button", () => {
    renderStep();

    expect(screen.getByLabelText("Token")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Add actor/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("No actors yet.")).toBeInTheDocument();
  });

  it("lists a configured actor and reports its toggle", () => {
    const onToggleInstance = vi.fn();
    renderStep({
      instances: INSTANCES,
      instanceEnabledIds: ["i1"],
      onToggleInstance,
    });

    expect(screen.getByLabelText(/LinkedIn \(Apify\)/)).toBeChecked();

    fireEvent.click(screen.getByLabelText(/LinkedIn \(Apify\)/));
    expect(onToggleInstance).toHaveBeenCalledWith("i1", false);
  });
});

describe("SourcesStep — the source guard", () => {
  it("warns when every source is turned off", () => {
    // A source-less install can only be refused at run time, so say so here.
    renderStep({ enabledIds: [] });

    expect(screen.getByText(/Pick at least one source/i)).toBeInTheDocument();
  });

  it("does not warn while at least one built-in board is on", () => {
    renderStep({ enabledIds: ["jobspy"] });

    expect(screen.queryByText(/Pick at least one source/i)).toBeNull();
  });

  it("does not warn when only an Apify actor is on", () => {
    // The server refuses a run only when NEITHER an extractor nor an instance is
    // effective, so an Apify-only install is valid and must not be blocked here.
    renderStep({
      enabledIds: [],
      instances: INSTANCES,
      instanceEnabledIds: ["i1"],
    });

    expect(screen.queryByText(/Pick at least one source/i)).toBeNull();
  });
});
