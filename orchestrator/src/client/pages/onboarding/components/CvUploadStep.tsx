import * as api from "@client/api";
import { ApiClientError } from "@client/api";
import {
  AttemptLogViewer,
  CompileLogViewer,
} from "@client/components/cv/CompileLogViewer";
import { queryKeys } from "@client/lib/queryKeys";
import type {
  CvDocument,
  CvUploadPipelineAttempt,
} from "@shared/types";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CvChoice } from "../types";

const ACCEPTED_EXTENSIONS = [".tex", ".zip"];

type UploadFailureDetails = {
  stage: "flatten" | "compile-original" | "extract-loop";
  flattenCode?: string;
  originalCompileStderr?: string;
  attempts?: CvUploadPipelineAttempt[];
};

function extractFailureDetails(error: unknown): UploadFailureDetails | null {
  if (!(error instanceof ApiClientError) || !error.details) return null;
  const details = error.details as Record<string, unknown>;
  if (typeof details.stage !== "string") return null;
  return {
    stage: details.stage as UploadFailureDetails["stage"],
    flattenCode:
      typeof details.flattenCode === "string" ? details.flattenCode : undefined,
    originalCompileStderr:
      typeof details.originalCompileStderr === "string"
        ? details.originalCompileStderr
        : undefined,
    attempts: Array.isArray(details.attempts)
      ? (details.attempts as CvUploadPipelineAttempt[])
      : undefined,
  };
}

interface CvUploadStepProps {
  isBusy: boolean;
  cvChoice: CvChoice;
  onCvChoiceChange: (choice: CvChoice) => void;
  cvDocument: CvDocument | null;
  onCvDocumentChange: (cv: CvDocument) => void;
  personalBrief: string;
  onPersonalBriefChange: (value: string) => void;
}

export const CvUploadStep: React.FC<CvUploadStepProps> = ({
  isBusy,
  cvChoice,
  onCvChoiceChange,
  cvDocument,
  onCvDocumentChange,
  personalBrief,
  onPersonalBriefChange,
}) => {
  if (cvDocument) {
    return (
      <CvBriefEditor
        cv={cvDocument}
        personalBrief={personalBrief}
        onPersonalBriefChange={onPersonalBriefChange}
        onReuploadRequest={() => onCvChoiceChange("upload")}
        isBusy={isBusy}
      />
    );
  }

  if (cvChoice === "skip") {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>CV upload skipped</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              You can finish onboarding without a CV, but per-job tailoring and
              the search-term suggester will stay disabled until you upload one
              from the My CV page. The pipeline can still discover and score
              jobs with a personal_brief alone.
            </p>
            <p>
              Click "Finish step" below to continue, or change your mind and
              upload now.
            </p>
          </AlertDescription>
        </Alert>
        <div className="flex justify-start">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => onCvChoiceChange("upload")}
          >
            <Upload className="h-4 w-4" />
            Upload now instead
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <CvUploadCard
        onUploaded={(cv) => {
          onCvChoiceChange("upload");
          onPersonalBriefChange(cv.personalBrief);
          onCvDocumentChange(cv);
        }}
        isBusy={isBusy}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-border/60 bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
        <span>
          Don't have your CV ready? You can upload it from the My CV page after
          onboarding.
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isBusy}
          onClick={() => onCvChoiceChange("skip")}
        >
          Skip for now
        </Button>
      </div>
    </div>
  );
};

interface CvUploadCardProps {
  onUploaded: (cv: CvDocument) => void;
  isBusy: boolean;
}

const CvUploadCard: React.FC<CvUploadCardProps> = ({ onUploaded, isBusy }) => {
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] =
    useState<UploadFailureDetails | null>(null);
  const [latestAttempts, setLatestAttempts] =
    useState<CvUploadPipelineAttempt[] | null>(null);
  const [extractionPrompt, setExtractionPrompt] = useState<string | null>(null);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const defaultPromptQuery = useQuery<string>({
    queryKey: queryKeys.cvDocuments.extractionPromptDefault(),
    queryFn: api.fetchExtractionPromptDefault,
  });

  useEffect(() => {
    if (defaultPromptQuery.data && extractionPrompt === null) {
      setExtractionPrompt(defaultPromptQuery.data);
    }
  }, [defaultPromptQuery.data, extractionPrompt]);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const baseName = file.name.replace(/\.[^.]+$/, "") || "CV";
      return api.uploadCvDocumentTemplate({
        file,
        filename: file.name,
        name: baseName,
        extractionPrompt: extractionPrompt ?? undefined,
      });
    },
    onSuccess: (result) => {
      const attemptsCount = result.attempts.length;
      toast.success(
        attemptsCount === 1
          ? "CV accepted on the first attempt"
          : `CV accepted after ${attemptsCount} attempts`,
      );
      setLatestAttempts(result.attempts);
      onUploaded(result.cv);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to upload CV";
      setErrorMessage(message);
      setErrorDetails(extractFailureDetails(err));
      toast.error(message);
    },
  });

  const handleFile = useCallback(
    async (file: File) => {
      setErrorMessage(null);
      setErrorDetails(null);
      setLatestAttempts(null);
      const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        const message = `Only ${ACCEPTED_EXTENSIONS.join(" or ")} files are accepted.`;
        setErrorMessage(message);
        toast.error(message);
        return;
      }
      setPending(true);
      try {
        await uploadMutation.mutateAsync(file);
      } finally {
        setPending(false);
      }
    },
    [uploadMutation],
  );

  const disabled = pending || isBusy;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        className={`flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-12 text-sm transition-colors ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/30 hover:border-primary"
        }`}
        disabled={disabled}
      >
        {pending ? (
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        ) : (
          <Upload className="h-8 w-8 text-muted-foreground" />
        )}
        <div className="text-center">
          <div className="font-medium">
            {pending
              ? "Uploading, compiling, and extracting…"
              : "Click to upload or drag a file here"}
          </div>
          <div className="text-xs text-muted-foreground">
            .tex or .zip (max 10 MB). Up to 3 LLM retries on extraction.
          </div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            event.target.value = "";
          }}
        />
      </button>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Custom extraction prompt available for power users.</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowPromptEditor((prev) => !prev)}
          disabled={disabled}
        >
          {showPromptEditor ? "Hide" : "Edit"} extraction prompt
        </Button>
      </div>

      {showPromptEditor ? (
        <div className="grid gap-2">
          <Label htmlFor="onboarding-extraction-prompt" className="text-xs">
            Extraction prompt (system message; pre-filled with the default).
          </Label>
          <Textarea
            id="onboarding-extraction-prompt"
            value={extractionPrompt ?? ""}
            onChange={(event) => setExtractionPrompt(event.target.value)}
            placeholder={
              defaultPromptQuery.isLoading
                ? "Loading default prompt…"
                : "(default prompt unavailable — see server logs)"
            }
            className="min-h-[200px] font-mono text-xs"
            spellCheck={false}
            disabled={disabled || defaultPromptQuery.isLoading}
          />
        </div>
      ) : null}

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Upload failed</AlertTitle>
          <AlertDescription>
            <div className="space-y-3">
              <p className="text-sm">{errorMessage}</p>
              {errorDetails?.stage === "compile-original" &&
              errorDetails.originalCompileStderr ? (
                <CompileLogViewer
                  stderr={errorDetails.originalCompileStderr}
                  label="Tectonic stderr (your CV's source)"
                  defaultOpen
                  variant="warning"
                />
              ) : null}
              {errorDetails?.stage === "extract-loop" &&
              errorDetails.attempts ? (
                <AttemptLogViewer attempts={errorDetails.attempts} />
              ) : null}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {latestAttempts && latestAttempts.length > 1 ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Accepted after {latestAttempts.length} attempts</AlertTitle>
          <AlertDescription>
            <div className="mt-2">
              <AttemptLogViewer attempts={latestAttempts} />
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
};

interface CvBriefEditorProps {
  cv: CvDocument;
  personalBrief: string;
  onPersonalBriefChange: (value: string) => void;
  onReuploadRequest: () => void;
  isBusy: boolean;
}

const CvBriefEditor: React.FC<CvBriefEditorProps> = ({
  cv,
  personalBrief,
  onPersonalBriefChange,
  onReuploadRequest,
  isBusy,
}) => (
  <div className="space-y-4">
    <Alert>
      <FileText className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between gap-2">
        <span>{cv.name}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isBusy}
          onClick={onReuploadRequest}
        >
          <RefreshCw className="h-4 w-4" />
          Replace
        </Button>
      </AlertTitle>
      <AlertDescription>
        Uploaded {new Date(cv.createdAt).toLocaleString()} · {cv.fields.length}{" "}
        extracted fields. Edit or replace the CV anytime from the My CV page.
      </AlertDescription>
    </Alert>

    <div className="space-y-2">
      <Label htmlFor="onboarding-personal-brief" className="text-sm font-medium">
        Personal brief
      </Label>
      <p className="text-xs text-muted-foreground">
        We pulled this from your CV. Add anything else relevant — context, side
        projects, things you've used in passing. The richer this is, the better
        per-job tailoring works.
      </p>
      <Textarea
        id="onboarding-personal-brief"
        value={personalBrief}
        onChange={(event) => onPersonalBriefChange(event.target.value)}
        spellCheck
        className="min-h-[260px] text-sm"
        placeholder="I'm a …"
        disabled={isBusy}
      />
    </div>
  </div>
);
