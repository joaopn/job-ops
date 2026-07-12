import type { AppSettings, CvSourceFormat } from "@shared/types";

/**
 * The one place the CV-substrate dispatch rule lives. `cvSourceFormat` is
 * unset on every pre-feature (and every never-asked) profile, and unset
 * means LaTeX — which is exactly what those profiles' documents are.
 *
 * Pure by design: no DB imports, so both the routes (which already hold an
 * AppSettings) and the render path can share it without a cycle.
 */
export function resolveCvSourceFormat(settings: AppSettings): CvSourceFormat {
  return settings.cvSourceFormat ?? "latex";
}
