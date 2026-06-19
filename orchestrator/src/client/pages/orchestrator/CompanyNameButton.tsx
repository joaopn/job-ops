/**
 * Renders an employer name as an inline button that opens the company-jobs
 * panel. Falls back to plain text when the name is empty. Stops click
 * propagation so it never triggers an enclosing row's select handler.
 */

import { cn } from "@/lib/utils";
import { useCompanyPanel } from "./CompanyPanelContext";

interface CompanyNameButtonProps {
  employer: string;
  className?: string;
}

export const CompanyNameButton = ({
  employer,
  className,
}: CompanyNameButtonProps) => {
  const { openCompanyJobs } = useCompanyPanel();
  const name = employer?.trim();
  if (!name) {
    return <span className={className}>{employer}</span>;
  }
  return (
    <button
      type="button"
      className={cn(
        "text-left hover:underline focus:underline focus:outline-none",
        className,
      )}
      title={`Show all jobs from ${name}`}
      onClick={(event) => {
        event.stopPropagation();
        openCompanyJobs(name);
      }}
    >
      {employer}
    </button>
  );
};
