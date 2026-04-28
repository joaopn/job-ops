import * as api from "@client/api";
import { PageHeader } from "@client/components/layout";
import { queryKeys } from "@client/lib/queryKeys";
import type { CvDocument, CvDocumentSummary } from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const ACCEPTED_EXTENSIONS = [".tex", ".zip"];

export function CvPage() {
  const queryClient = useQueryClient();

  const summariesQuery = useQuery<CvDocumentSummary[]>({
    queryKey: queryKeys.cvDocuments.list(),
    queryFn: api.listCvDocuments,
  });

  const activeId = summariesQuery.data?.[0]?.id ?? null;
  const detailQuery = useQuery<CvDocument>({
    queryKey: activeId
      ? queryKeys.cvDocuments.detail(activeId)
      : ["cv-documents", "detail", "none"],
    queryFn: () => {
      if (!activeId) throw new Error("No active CV");
      return api.getCvDocument(activeId);
    },
    enabled: Boolean(activeId),
  });

  return (
    <>
      <PageHeader
        icon={FileText}
        title="My CV"
        subtitle="Upload your LaTeX CV; the server flattens, extracts, and renders it for per-job tailoring."
      />
      <main className="container mx-auto px-4 py-6 pb-12">
        {summariesQuery.isLoading ? (
          <LoadingShell />
        ) : !activeId ? (
          <UploadCard
            onUploaded={async () => {
              await queryClient.invalidateQueries({
                queryKey: queryKeys.cvDocuments.all,
              });
            }}
          />
        ) : detailQuery.isLoading || !detailQuery.data ? (
          <LoadingShell />
        ) : (
          <CvEditor cv={detailQuery.data} />
        )}
      </main>
    </>
  );
}

function LoadingShell() {
  return (
    <div className="flex items-center justify-center py-24 text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      Loading CV…
    </div>
  );
}

function UploadCard({ onUploaded }: { onUploaded: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const baseName = file.name.replace(/\.[^.]+$/, "") || "CV";
      return api.uploadCvDocument({
        file,
        filename: file.name,
        name: baseName,
      });
    },
    onSuccess: async () => {
      toast.success("CV extracted");
      await onUploaded();
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Failed to upload CV";
      setError(message);
      toast.error(message);
    },
  });

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`;
      if (!ACCEPTED_EXTENSIONS.includes(ext)) {
        const message = `Only ${ACCEPTED_EXTENSIONS.join(" or ")} files are accepted.`;
        setError(message);
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload your CV</CardTitle>
        <CardDescription>
          Drop a .tex file (single-file CV) or a .zip archive containing
          main.tex plus any included files, fonts, and images. The server
          flattens it, extracts a list of typed value fields it can later
          override during per-job tailoring, and drafts a first-person
          personal brief. The renderer never rewrites your LaTeX — it only
          substitutes overrides into the marked spans.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
          className={`flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-16 text-sm transition-colors ${
            dragOver
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/30 hover:border-primary"
          }`}
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : (
            <Upload className="h-8 w-8 text-muted-foreground" />
          )}
          <div className="text-center">
            <div className="font-medium">
              {pending ? "Uploading and extracting…" : "Click to upload or drag a file here"}
            </div>
            <div className="text-xs text-muted-foreground">
              .tex or .zip (max 10 MB)
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
        {error ? (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Upload failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CvEditor({ cv }: { cv: CvDocument }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(cv.name);
  const [personalBrief, setPersonalBrief] = useState(cv.personalBrief);

  useEffect(() => {
    setName(cv.name);
    setPersonalBrief(cv.personalBrief);
  }, [cv.id, cv.updatedAt, cv.name, cv.personalBrief]);

  const isDirty =
    name !== cv.name || personalBrief !== cv.personalBrief;

  const invalidateAll = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.cvDocuments.all,
    });
  }, [queryClient]);

  const saveMutation = useMutation({
    mutationFn: async (input: { name: string; personalBrief: string }) =>
      api.updateCvDocument(cv.id, input),
    onSuccess: async () => {
      toast.success("CV saved");
      await invalidateAll();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Save failed");
    },
  });

  const reExtractMutation = useMutation({
    mutationFn: () => api.reExtractCvDocument(cv.id),
    onSuccess: async () => {
      toast.success("Re-extracted from original archive");
      await invalidateAll();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Re-extract failed");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteCvDocument(cv.id),
    onSuccess: async () => {
      toast.success("CV deleted");
      await invalidateAll();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    },
  });

  const handleSave = () => {
    saveMutation.mutate({
      name: name.trim() || cv.name,
      personalBrief,
    });
  };

  const handleDiscard = () => {
    setName(cv.name);
    setPersonalBrief(cv.personalBrief);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex-1">
            <CardTitle>{cv.name}</CardTitle>
            <CardDescription>
              Uploaded {new Date(cv.createdAt).toLocaleString()} · last edited{" "}
              {new Date(cv.updatedAt).toLocaleString()}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => reExtractMutation.mutate()}
              disabled={reExtractMutation.isPending}
            >
              {reExtractMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Re-extract
            </Button>
            <Button asChild type="button" variant="outline" size="sm">
              <a
                href={`/api/cv/${cv.id}/render-preview`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download className="mr-2 h-4 w-4" />
                Render preview
              </a>
            </Button>
            <DeleteCvButton
              isPending={deleteMutation.isPending}
              onConfirm={() => deleteMutation.mutate()}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="cv-name">Name</Label>
            <Input
              id="cv-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Personal brief</CardTitle>
          <CardDescription>
            Long-form, first-person background that powers per-job tailoring.
            Paste in extra context the CV doesn't carry — side projects, tools
            you've used in passing, transcripts of long-running chats. The
            brief is the source of truth for tailoring; the CV JSON below is
            just the render target.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={personalBrief}
            onChange={(event) => setPersonalBrief(event.target.value)}
            spellCheck
            className="min-h-[260px] text-sm"
            placeholder="I'm a …"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Extracted fields ({cv.fields.length})</CardTitle>
          <CardDescription>
            Verbatim spans of the source LaTeX that per-job tailoring can
            override. The renderer only touches these spans — everything
            else in your CV is preserved byte-for-byte. To re-extract, click
            "Re-extract" above.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cv.fields.length === 0 ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>No fields extracted</AlertTitle>
              <AlertDescription>
                The CV is uploaded but extraction returned no fields. Click
                "Re-extract" above to retry.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="max-h-[480px] space-y-2 overflow-y-auto rounded border border-border/60 p-3 font-mono text-xs">
              {cv.fields.map((field) => (
                <div
                  key={field.id}
                  className="flex flex-col gap-1 border-b border-border/40 pb-2 last:border-b-0 last:pb-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      {field.role}
                    </span>
                    <span className="text-muted-foreground">{field.id}</span>
                  </div>
                  <div className="whitespace-pre-wrap text-foreground">
                    {field.value}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={handleDiscard}
          disabled={!isDirty || saveMutation.isPending}
        >
          Discard changes
        </Button>
        <Button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || saveMutation.isPending}
        >
          {saveMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save changes
        </Button>
      </div>
    </div>
  );
}

function DeleteCvButton({
  isPending,
  onConfirm,
}: {
  isPending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="mr-2 h-4 w-4" />
          )}
          Delete CV
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this CV?</AlertDialogTitle>
          <AlertDialogDescription>
            The original archive, extracted fields, and personal brief will
            be removed. Jobs that already reference this CV keep their
            tailored field overrides but cannot be re-rendered.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
