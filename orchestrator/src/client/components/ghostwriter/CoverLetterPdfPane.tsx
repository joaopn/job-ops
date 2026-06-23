import type { Job } from "@shared/types";
import { ExternalLink, FileText } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";

type CoverLetterPdfPaneProps = {
  job: Job;
  tabSwitch?: React.ReactNode;
};

/**
 * Embedded cover-letter PDF preview that cache-busts on `job.updatedAt`.
 * Mirror of `CvPdfPane`; empty-state until the user runs Render.
 */
export const CoverLetterPdfPane: React.FC<CoverLetterPdfPaneProps> = ({
  job,
  tabSwitch,
}) => {
  const pdfHref = `/pdfs/cover_letter_${job.id}.pdf?v=${encodeURIComponent(job.updatedAt)}`;
  const hasPdf = Boolean(job.coverLetterPdfPath);

  if (!hasPdf) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {tabSwitch ? (
          <div className="mb-2 flex items-center gap-1">{tabSwitch}</div>
        ) : null}
        <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/60 bg-muted/10 text-center">
          <FileText className="h-6 w-6 text-muted-foreground" />
          <div className="text-sm font-medium text-muted-foreground">
            No cover-letter PDF rendered yet
          </div>
          <p className="max-w-[260px] text-xs text-muted-foreground/80">
            Click "Render PDF" to compile the current fields into a PDF.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {tabSwitch}
        <span className="text-xs font-medium text-muted-foreground">
          Compiled cover letter
        </span>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="ml-auto h-7 gap-1 px-2 text-xs"
        >
          <a href={pdfHref} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3 w-3" />
            Open in new tab
          </a>
        </Button>
      </div>
      <iframe
        title="Compiled cover-letter preview"
        src={pdfHref}
        className="h-full w-full flex-1 rounded-md border border-border/60 bg-background"
      />
    </div>
  );
};
