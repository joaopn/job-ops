import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CvFormatStep } from "./CvFormatStep";

function renderStep(overrides?: {
  choice?: "latex" | "docx" | null;
  hasExistingCv?: boolean;
  storedFormat?: "latex" | "docx" | null;
}) {
  const onChoiceChange = vi.fn();
  render(
    <CvFormatStep
      choice={overrides?.choice ?? null}
      hasExistingCv={overrides?.hasExistingCv ?? false}
      isBusy={false}
      onChoiceChange={onChoiceChange}
      storedFormat={overrides?.storedFormat ?? null}
    />,
  );
  // Anchored to the option title: in the blocked state the Word option's own
  // helper text mentions "LaTeX", so an unanchored /LaTeX/ matches both radios.
  return {
    onChoiceChange,
    latexRadio: screen.getByRole("radio", { name: /^LaTeX/ }),
    wordRadio: screen.getByRole("radio", { name: /^Word/ }),
  };
}

describe("CvFormatStep", () => {
  it("offers both formats on a fresh profile", () => {
    const { latexRadio, wordRadio, onChoiceChange } = renderStep();

    expect(latexRadio).toBeEnabled();
    expect(wordRadio).toBeEnabled();

    fireEvent.click(wordRadio);
    expect(onChoiceChange).toHaveBeenCalledWith("docx");
  });

  it("disables Word when the profile already has a CV", () => {
    // Mirrors the server's 409: a first write of "docx" is refused once
    // cv_documents rows exist.
    const { latexRadio, wordRadio, onChoiceChange } = renderStep({
      hasExistingCv: true,
    });

    expect(wordRadio).toBeDisabled();
    expect(latexRadio).toBeEnabled();
    expect(
      screen.getByText(/This profile already has a LaTeX CV/i),
    ).toBeInTheDocument();

    fireEvent.click(wordRadio);
    expect(onChoiceChange).not.toHaveBeenCalled();
  });

  it("locks both options once a format is stored", () => {
    const { latexRadio, wordRadio } = renderStep({ storedFormat: "docx" });

    expect(latexRadio).toBeDisabled();
    expect(wordRadio).toBeDisabled();
    expect(wordRadio).toBeChecked();
    expect(screen.getByText(/Format locked to Word/i)).toBeInTheDocument();
    expect(screen.getByText(/create a new user profile/i)).toBeInTheDocument();
  });

  it("shows the stored format as selected even when it is latex", () => {
    const { latexRadio } = renderStep({ storedFormat: "latex" });

    expect(latexRadio).toBeChecked();
    expect(screen.getByText(/Format locked to LaTeX/i)).toBeInTheDocument();
  });
});
