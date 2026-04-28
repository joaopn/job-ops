import type { Job } from "@shared/types";
import { ExternalLink, FileText } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";

type CvPdfPaneProps = {
  job: Job;
};

/**
 * Embedded PDF preview that cache-busts on `job.updatedAt`. Re-renders
 * automatically when the server overwrites the PDF after an accepted CV edit
 * or a re-tailor.
 */
export const CvPdfPane: React.FC<CvPdfPaneProps> = ({ job }) => {
  const pdfHref = `/pdfs/resume_${job.id}.pdf?v=${encodeURIComponent(job.updatedAt)}`;
  const hasPdf = Boolean(job.pdfPath);

  if (!hasPdf) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/60 bg-muted/10 text-center">
        <FileText className="h-6 w-6 text-muted-foreground" />
        <div className="text-sm font-medium text-muted-foreground">
          No PDF rendered yet
        </div>
        <p className="max-w-[260px] text-xs text-muted-foreground/80">
          Tailor the job to generate a CV PDF, or click "Re-tailor with brief"
          below to retry.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Compiled CV
        </span>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
        >
          <a href={pdfHref} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3 w-3" />
            Open in new tab
          </a>
        </Button>
      </div>
      <iframe
        title="Compiled CV preview"
        src={pdfHref}
        className="h-full w-full flex-1 rounded-md border border-border/60 bg-background"
      />
    </div>
  );
};
