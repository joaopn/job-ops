import { apifyProvider } from "./apify";
import type { ProviderRegistry, ProviderRunner } from "./types";

export const PROVIDERS: ProviderRegistry = new Map<string, ProviderRunner>([
  [apifyProvider.id, apifyProvider],
]);

export function getProvider(providerId: string): ProviderRunner | undefined {
  return PROVIDERS.get(providerId);
}

export function listProviders(): ProviderRunner[] {
  return Array.from(PROVIDERS.values());
}

export type { ProviderRunContext, ProviderRunner, ProviderActorTemplate } from "./types";
