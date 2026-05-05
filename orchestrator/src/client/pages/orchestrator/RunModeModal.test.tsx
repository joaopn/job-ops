import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RunModeModal } from "./RunModeModal";

vi.mock("./AutomaticRunTab", () => ({
  AutomaticRunTab: () => (
    <div data-testid="automatic-tab">Automatic run tab</div>
  ),
}));

describe("RunModeModal", () => {
  it("renders the Automatic run tab content", () => {
    render(
      <RunModeModal
        open
        settings={null}
        enabledSources={["linkedin"]}
        pipelineSources={["linkedin"]}
        onToggleSource={vi.fn()}
        onSetPipelineSources={vi.fn()}
        isPipelineRunning={false}
        onOpenChange={vi.fn()}
        onSaveAndRunAutomatic={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByTestId("automatic-tab")).toBeInTheDocument();
  });
});
