import * as api from "@client/api";
import type {
  StoredUserProfile,
  UserProfilesListResponse,
} from "@shared/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserProfileSwitcher } from "./UserProfileSwitcher";

vi.mock("@client/api", () => ({
  getActiveUserProfile: vi.fn(),
  getUserProfiles: vi.fn(),
}));

type MenuShellProps = {
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect?: () => void;
  disabled?: boolean;
};

// Radix menus cannot be opened in jsdom (no pointer-capture stubs in the
// harness); replace the module with a plain shell that drives the
// component's controlled `open` state through a visible toggle button.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children, open, onOpenChange }: MenuShellProps) => (
    <div>
      <button type="button" onClick={() => onOpenChange?.(!open)}>
        toggle-menu
      </button>
      {children}
    </div>
  ),
  DropdownMenuTrigger: ({ children }: MenuShellProps) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: MenuShellProps) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, disabled }: MenuShellProps) => (
    <button type="button" disabled={disabled} onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
}));

const STORED_ID = "11111111-1111-4111-8111-111111111111";

const STORED: StoredUserProfile = {
  id: STORED_ID,
  name: "Old Search",
  sizeBytes: 1024,
  stats: null,
};

const LIST: UserProfilesListResponse = {
  active: { name: "Default", sizeBytes: 2048, stats: null },
  stored: [
    STORED,
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Broken File",
      sizeBytes: 16,
      stats: null,
      invalid: true,
      invalidReason: "Not a readable SQLite database",
    },
  ],
};

function renderSwitcher(
  overrides: Partial<React.ComponentProps<typeof UserProfileSwitcher>> = {},
) {
  const props: React.ComponentProps<typeof UserProfileSwitcher> = {
    activateProfile: vi.fn(),
    isPending: false,
    onCloseDrawer: vi.fn(),
    ...overrides,
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    props,
    ...render(
      <QueryClientProvider client={client}>
        <UserProfileSwitcher {...props} />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getActiveUserProfile).mockResolvedValue({ name: "Default" });
  vi.mocked(api.getUserProfiles).mockResolvedValue(structuredClone(LIST));
});

describe("UserProfileSwitcher", () => {
  it("shows the active name in the trigger and fetches no list while closed", async () => {
    renderSwitcher();

    expect(await screen.findByText(/Profile: Default/)).toBeInTheDocument();
    expect(api.getUserProfiles).not.toHaveBeenCalled();
  });

  it("lists valid stored profiles once opened and omits invalid ones", async () => {
    renderSwitcher();
    await screen.findByText(/Profile: Default/);

    fireEvent.click(screen.getByRole("button", { name: "toggle-menu" }));

    expect(await screen.findByText("Old Search")).toBeInTheDocument();
    expect(api.getUserProfiles).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Broken File")).not.toBeInTheDocument();
    // The active row is a disabled menu item distinct from the trigger.
    expect(screen.getByRole("button", { name: "Default" })).toBeDisabled();
  });

  it("closes the drawer and activates after the confirm dialog", async () => {
    const { props } = renderSwitcher();
    await screen.findByText(/Profile: Default/);

    fireEvent.click(screen.getByRole("button", { name: "toggle-menu" }));
    fireEvent.click(await screen.findByText("Old Search"));

    expect(
      await screen.findByText(/Switch to "Old Search"\?/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /switch profile/i }));

    await waitFor(() =>
      expect(props.activateProfile).toHaveBeenCalledWith(STORED_ID),
    );
    expect(props.onCloseDrawer).toHaveBeenCalled();
  });

  it("disables the stored rows while a switch is pending", async () => {
    renderSwitcher({ isPending: true });
    await screen.findByText(/Profile: Default/);

    fireEvent.click(screen.getByRole("button", { name: "toggle-menu" }));

    expect(await screen.findByText("Old Search")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Old Search" })).toBeDisabled();
  });
});
