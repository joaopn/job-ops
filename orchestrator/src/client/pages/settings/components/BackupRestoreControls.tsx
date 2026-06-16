import * as api from "@client/api";
import { toast } from "@client/lib/toast";
import { Download, Upload } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

type BackupRestoreControlsProps = {
  disabled?: boolean;
};

/**
 * Self-contained DB portability controls (Export snapshot / Restore from
 * file). The DB holds every CV + cover-letter archive as BLOBs, so a single
 * snapshot is a complete, portable backup. Restore swaps the file in and
 * requires an app restart to take effect.
 */
export const BackupRestoreControls: React.FC<BackupRestoreControlsProps> = ({
  disabled,
}) => {
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = disabled || isExporting || isRestoring;

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await api.exportDatabaseBackup(includeSecrets);
      toast.success("Backup downloaded.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Backup export failed.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleFilePicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    // Reset the input so re-picking the same file fires onChange again.
    event.target.value = "";
    if (file) setPendingFile(file);
  };

  const handleConfirmRestore = async () => {
    if (!pendingFile) return;
    const file = pendingFile;
    setPendingFile(null);
    setIsRestoring(true);
    try {
      await api.restoreDatabaseBackup(file);
      toast.success(
        "Database restored. Restart the app to finish.",
        { duration: 10000 },
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Restore failed.",
      );
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="p-3 rounded-md space-y-4">
      <div className="space-y-0.5">
        <div className="text-sm font-semibold text-destructive">
          Backup &amp; Restore
        </div>
        <div className="text-xs text-muted-foreground">
          Export the entire installation as a single database snapshot
          (includes CVs, cover letters, jobs, and settings). Restoring
          overwrites everything and requires an app restart.
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={includeSecrets}
            onCheckedChange={(checked) => setIncludeSecrets(checked === true)}
            disabled={busy}
            className="mt-0.5"
          />
          <span>
            Include API keys &amp; secrets
            <span className="block text-[11px] text-destructive">
              The file will contain credentials in plaintext — store it
              securely.
            </span>
          </span>
        </label>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={busy}
          >
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? "Exporting…" : "Export"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            <Upload className="mr-2 h-4 w-4" />
            {isRestoring ? "Restoring…" : "Restore"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".db,application/x-sqlite3,application/octet-stream"
            className="hidden"
            onChange={handleFilePicked}
          />
        </div>
      </div>

      <AlertDialog
        open={pendingFile !== null}
        onOpenChange={(open) => {
          if (!open) setPendingFile(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore from backup?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces the entire current database with{" "}
              <span className="font-medium text-foreground">
                {pendingFile?.name}
              </span>
              . All current jobs, CVs, cover letters, and settings will be
              overwritten. This cannot be undone. The app must be restarted
              afterward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRestore}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Restore &amp; overwrite
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
