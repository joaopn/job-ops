import { queryKeys } from "@/client/lib/queryKeys";
import type { CvDocument, CvDocumentSummary } from "@shared/types";
import { useQuery } from "@tanstack/react-query";
import * as api from "../api";

/**
 * Returns the most recently updated CV document, or null when no CV has been
 * uploaded yet. Single-CV assumption — multi-CV management arrives later.
 */
export function useActiveCv() {
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
      if (!activeId) {
        throw new Error("No active CV");
      }
      return api.getCvDocument(activeId);
    },
    enabled: Boolean(activeId),
  });

  const cv = detailQuery.data ?? null;
  const personName = readPersonName(cv) || "Resume";
  const isLoading = summariesQuery.isLoading || detailQuery.isLoading;

  return {
    cv,
    personName,
    isLoading,
    error: summariesQuery.error ?? detailQuery.error ?? null,
  };
}

function readPersonName(cv: CvDocument | null): string {
  if (!cv) return "";
  const basics = cv.content.basics;
  if (!basics || typeof basics !== "object" || Array.isArray(basics)) return "";
  const name = (basics as Record<string, unknown>).name;
  return typeof name === "string" ? name.trim() : "";
}
