import { extractStoryText } from "./extract-text";
import { normalizeStoryPart } from "./normalize-runs";
import { type ParseDocxOptions, parseDocx } from "./parse-docx";
import { renderDocx } from "./render-docx";
import { serializeXml } from "./xml";

/**
 * The gate's stage-2 primitive (LLM-free): prove our parse → normalize
 * → serialize → zip-rebuild → re-parse loop preserves this file's text
 * BEFORE any LLM spend. The docx analog of "your CV doesn't compile" is
 * "we can't faithfully round-trip your docx" — reject at upload.
 *
 * Two comparisons, both against the freshly-parsed original's text:
 * normalization must not change extracted text (the normalize-runs
 * invariant, re-checked here per real file, not just per fixture), and
 * the rebuilt archive's re-extracted text must match exactly. The
 * rebuild goes through renderDocx with zero values so the exact
 * production render path is what gets exercised, and the re-parse runs
 * the full parseDocx validation again.
 */

export type RoundTripResult =
  | { ok: true }
  | { ok: false; partName: string; diff: string };

const MAX_DIFF_LINES = 10;

export function roundTripCheck(
  archive: Uint8Array,
  opts?: ParseDocxOptions,
): RoundTripResult {
  const pkg = parseDocx(archive, opts);
  const before = extractStoryText(pkg.storyParts, pkg.storyPartOrder);

  for (const doc of pkg.storyParts.values()) {
    normalizeStoryPart(doc);
  }
  const afterNormalize = extractStoryText(pkg.storyParts, pkg.storyPartOrder);
  const normalizeDrift = firstMismatch(before, afterNormalize);
  if (normalizeDrift) return normalizeDrift;

  const serialized = new Map<string, string>();
  for (const [partName, doc] of pkg.storyParts) {
    serialized.set(partName, serializeXml(doc));
  }
  const rebuilt = renderDocx({
    originalArchive: archive,
    templatedParts: serialized,
    effectiveValues: {},
  });

  const pkg2 = parseDocx(rebuilt, opts);
  const after = extractStoryText(pkg2.storyParts, pkg2.storyPartOrder);
  const rebuildDrift = firstMismatch(before, after);
  if (rebuildDrift) return rebuildDrift;

  return { ok: true };
}

function firstMismatch(
  expected: ReadonlyMap<string, string>,
  actual: ReadonlyMap<string, string>,
): { ok: false; partName: string; diff: string } | null {
  for (const [partName, expectedText] of expected) {
    const actualText = actual.get(partName) ?? "";
    if (actualText === expectedText) continue;
    return { ok: false, partName, diff: lineDiff(expectedText, actualText) };
  }
  return null;
}

function lineDiff(expected: string, actual: string): string {
  const a = expected.split("\n");
  const b = actual.split("\n");
  const lines: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max && lines.length < MAX_DIFF_LINES; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) lines.push(`- ${a[i]}`);
    if (b[i] !== undefined) lines.push(`+ ${b[i]}`);
  }
  return lines.join("\n");
}
