import { useActiveCv } from "@client/hooks/useActiveCv";
import type { Job } from "@shared/types";
import { FileSearch } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CvEditTab } from "./CvEditTab";
import { CvPdfPane } from "./CvPdfPane";

type Tab = "edit" | "pdf";

type Props = {
  job: Job;
  onJobUpdated: () => void | Promise<void>;
};

/**
 * Per-job CV editor with Edit/PDF tab toggle. The Edit|PDF strip is
 * hoisted into each body component so the editor's toolbar can share its
 * row (Edit|PDF | Fields|Raw | Save/Render/Reset). Mirror of
 * `CoverLetterPane`'s shape; PDF tab reuses `CvPdfPane`.
 */
export const CvPane: React.FC<Props> = ({ job, onJobUpdated }) => {
  const { cv, isLoading } = useActiveCv();
  const [tab, setTab] = useState<Tab>("edit");
  const renderedOnceRef = useRef(false);

  const handleRendered = () => {
    renderedOnceRef.current = true;
    setTab("pdf");
  };

  const hasPdf = Boolean(job.pdfPath);

  const tabSwitch = (
    <div className="flex items-center gap-1">
      <TabButton active={tab === "edit"} onClick={() => setTab("edit")}>
        Edit
      </TabButton>
      <TabButton
        active={tab === "pdf"}
        onClick={() => setTab("pdf")}
        disabled={!hasPdf && !renderedOnceRef.current}
      >
        PDF
      </TabButton>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {tab === "edit" ? (
        cv ? (
          <CvEditTab
            job={job}
            cv={cv}
            onJobUpdated={onJobUpdated}
            onRendered={handleRendered}
            tabSwitch={tabSwitch}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="mb-2 flex items-center gap-1">{tabSwitch}</div>
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/60 bg-muted/10 text-center">
              <FileSearch className="h-6 w-6 text-muted-foreground" />
              <div className="text-sm font-medium text-muted-foreground">
                {isLoading ? "Loading CV…" : "No CV uploaded yet"}
              </div>
              {!isLoading ? (
                <p className="max-w-[260px] text-xs text-muted-foreground/80">
                  Upload a CV from the CV page to begin editing fields per job.
                </p>
              ) : null}
            </div>
          </div>
        )
      ) : (
        <CvPdfPane job={job} tabSwitch={tabSwitch} />
      )}
    </div>
  );
};

const TabButton: React.FC<{
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, disabled, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      "rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
      active
        ? "bg-muted text-foreground"
        : "text-muted-foreground hover:bg-muted/40",
    )}
  >
    {children}
  </button>
);
