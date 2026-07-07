import { defaultProfileConfig, type Profile } from "@shared/types";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { ProfileSelect } from "./ProfileSelect";

// The real Radix Select can't open in jsdom (no pointer-capture / scrollIntoView
// stubs). Mock it to a button-per-item shell — this validates ProfileSelect's
// mapping (profiles -> items, onValueChange -> onSelect, selectedProfileId ->
// value), not Radix behaviour, which is left to the browser smoke.
vi.mock("@/components/ui/select", () => {
  const SelectContext = React.createContext<{
    onValueChange?: (value: string) => void;
  } | null>(null);

  const Select = ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => (
    <SelectContext.Provider value={{ onValueChange }}>
      <div>
        <input readOnly value={value ?? ""} aria-label="select-value" />
        {children}
      </div>
    </SelectContext.Provider>
  );

  const SelectContent = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );

  const SelectItem = ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => {
    const context = React.useContext(SelectContext);
    return (
      <button type="button" onClick={() => context?.onValueChange?.(value)}>
        {children}
      </button>
    );
  };

  const SelectTrigger = ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" role="combobox" aria-expanded="false" {...props}>
      {children}
    </button>
  );

  const SelectValue = () => null;

  return { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
});

function makeProfile(id: string, name: string): Profile {
  return {
    id,
    name,
    config: defaultProfileConfig(),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const PROFILES = [
  makeProfile("a", "Berlin backend"),
  makeProfile("b", "EU ML"),
];

describe("ProfileSelect", () => {
  it("renders an item per profile", () => {
    render(
      <ProfileSelect
        profiles={PROFILES}
        selectedProfileId="a"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Berlin backend")).toBeInTheDocument();
    expect(screen.getByText("EU ML")).toBeInTheDocument();
  });

  it("reflects the selected profile id as the value", () => {
    render(
      <ProfileSelect
        profiles={PROFILES}
        selectedProfileId="b"
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("select-value")).toHaveValue("b");
  });

  it("calls onSelect with the profile id when an item is chosen", () => {
    const onSelect = vi.fn();
    render(
      <ProfileSelect
        profiles={PROFILES}
        selectedProfileId="a"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText("EU ML"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("renders nothing when there are no profiles", () => {
    const { container } = render(
      <ProfileSelect
        profiles={[]}
        selectedProfileId={null}
        onSelect={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
