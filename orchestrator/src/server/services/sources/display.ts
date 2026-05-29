import {
  isExtractorSourceId,
  sourceExtractorLabel,
} from "@shared/extractors";
import type { ProviderInstanceRow } from "@shared/types";

interface ResolveArgs {
  source: string;
  providerInstances?: Iterable<ProviderInstanceRow>;
}

/**
 * Resolve a source identifier to the scraper that produced it.
 *
 * Built-in platform ids map to their extractor (e.g. linkedin → "jobspy")
 * so jobs are attributed to the underlying scraper, not the platform.
 * Provider synthetic ids (`<providerId>:<instanceId>`) look up the matching
 * row's user-set label, falling back to the provider id + actor ref.
 * Unknown ids return the raw string.
 */
export function resolveSourceDisplayLabel(args: ResolveArgs): string {
  const { source, providerInstances } = args;
  if (isExtractorSourceId(source)) {
    return sourceExtractorLabel(source);
  }
  const colonIndex = source.indexOf(":");
  if (colonIndex > 0 && providerInstances) {
    const instanceId = source.slice(colonIndex + 1);
    for (const row of providerInstances) {
      if (row.id === instanceId) return row.label;
    }
    const providerId = source.slice(0, colonIndex);
    return `${providerId}:${instanceId.slice(0, 8)}`;
  }
  return source;
}

export function isProviderInstanceSource(source: string): boolean {
  return !isExtractorSourceId(source) && source.includes(":");
}

export function extractProviderInstanceId(source: string): {
  providerId: string;
  instanceId: string;
} | null {
  if (isExtractorSourceId(source)) return null;
  const colonIndex = source.indexOf(":");
  if (colonIndex <= 0) return null;
  return {
    providerId: source.slice(0, colonIndex),
    instanceId: source.slice(colonIndex + 1),
  };
}
