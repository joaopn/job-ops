import { reloadApp } from "@client/lib/restart-poll";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfileSwitchOverlay } from "./ProfileSwitchOverlay";

vi.mock("@client/lib/restart-poll", () => ({
  reloadApp: vi.fn(),
}));

describe("ProfileSwitchOverlay", () => {
  it("renders nothing when idle", () => {
    render(<ProfileSwitchOverlay state={null} />);
    expect(
      screen.queryByText(/switching profile/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/didn't come back/i)).not.toBeInTheDocument();
  });

  it("shows the switching copy", () => {
    render(<ProfileSwitchOverlay state="switching" />);
    expect(screen.getByText("Switching profile…")).toBeInTheDocument();
    expect(
      screen.getByText(/restarting into the selected/i),
    ).toBeInTheDocument();
  });

  it("shows the manual-restart copy with a working reload button", () => {
    render(<ProfileSwitchOverlay state="timeout" />);
    expect(screen.getByText(/didn't come back/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /reload/i }));
    expect(reloadApp).toHaveBeenCalledTimes(1);
  });
});
