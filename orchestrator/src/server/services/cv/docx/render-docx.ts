import { unzipSync, zipSync } from "fflate";
import { MARKER_CLOSE, MARKER_OPEN, markerFor } from "./constants";

/**
 * Render: substitute effective field values into the templated story
 * parts and rebuild the .docx. String-level by design — markers are
 * literal text inside a single `<w:t xml:space="preserve">`, so
 * substitution is a `replaceAll` per fieldId, mirroring the LaTeX
 * substrate (render-template.ts): longest fieldIds replaced first so a
 * shorter id that prefixes a longer one cannot mangle it, and any
 * leftover marker after substitution is a hard MISSING_FIELD error.
 *
 * Values are XML-escaped; `\t` / `\n` placeholders (the extraction
 * mapping in traverse.ts) are turned back into `<w:tab/>` / `<w:br/>`
 * by closing and reopening the host `<w:t>` — a line break cannot live
 * inside a text element.
 *
 * Zip rebuild (fflate — same central-directory-based layer as
 * parse-docx; adm-zip cannot read data-descriptor zips): every entry of
 * the original archive is carried over with its content unchanged; only
 * the templated story parts are replaced. The original archive was
 * validated by parse-docx at upload time, so this path trusts it.
 */

export class RenderDocxError extends Error {
  readonly code: "MISSING_FIELD" | "MISSING_PART" | "ARCHIVE_UNREADABLE";
  constructor(
    message: string,
    code: "MISSING_FIELD" | "MISSING_PART" | "ARCHIVE_UNREADABLE",
  ) {
    super(message);
    this.name = "RenderDocxError";
    this.code = code;
  }
}

export interface RenderDocxArgs {
  originalArchive: Uint8Array;
  /** partName → templated XML (from splice-markers / the persisted template envelope). */
  templatedParts: ReadonlyMap<string, string>;
  /** fieldId → value. Caller merges defaults + per-job overrides first. */
  effectiveValues: Readonly<Record<string, string>>;
}

export function renderDocx(args: RenderDocxArgs): Uint8Array {
  return zipDocxParts(
    args.originalArchive,
    substituteParts(args.templatedParts, args.effectiveValues),
  );
}

/**
 * The pure substitution half of renderDocx: markers → values, per part.
 *
 * Exported because the per-job render path (services/pdf.ts) needs to
 * compare a tailored render against the defaults-only baseline, and that
 * comparison must happen on the substituted XML — NOT on the rebuilt zips,
 * whose bytes carry timestamps and are not stable across invocations.
 */
export function substituteParts(
  templatedParts: ReadonlyMap<string, string>,
  effectiveValues: Readonly<Record<string, string>>,
): Map<string, string> {
  const ids = Object.keys(effectiveValues).sort((a, b) => b.length - a.length);

  const rendered = new Map<string, string>();
  for (const [partName, templatedXml] of templatedParts) {
    let xml = templatedXml;
    for (const id of ids) {
      xml = xml.replaceAll(markerFor(id), prepareValue(effectiveValues[id]));
    }
    const leftover = findLeftoverMarker(xml);
    if (leftover !== null) {
      throw new RenderDocxError(
        `Template part "${partName}" references unknown fieldId "${leftover}" — no entry in the effective values.`,
        "MISSING_FIELD",
      );
    }
    rendered.set(partName, xml);
  }
  return rendered;
}

/** The zip-rebuild half of renderDocx: substituted parts → .docx bytes. */
export function zipDocxParts(
  originalArchive: Uint8Array,
  renderedParts: ReadonlyMap<string, string>,
): Uint8Array {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(originalArchive));
  } catch (error) {
    throw new RenderDocxError(
      `Original archive is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      "ARCHIVE_UNREADABLE",
    );
  }
  for (const [partName, xml] of renderedParts) {
    if (!(partName in entries)) {
      throw new RenderDocxError(
        `Original archive has no entry "${partName}" to replace.`,
        "MISSING_PART",
      );
    }
    entries[partName] = new Uint8Array(Buffer.from(xml, "utf8"));
  }
  return zipSync(entries);
}

/** All fieldIds referenced by a templated part. W4 uses this for the
 * marker/field consistency check when persisting the template. */
export function extractMarkerIds(templatedXml: string): Set<string> {
  const ids = new Set<string>();
  const pattern = new RegExp(
    `${MARKER_OPEN}([^${MARKER_OPEN}${MARKER_CLOSE}]+)${MARKER_CLOSE}`,
    "g",
  );
  for (const match of templatedXml.matchAll(pattern)) {
    ids.add(match[1]);
  }
  return ids;
}

function findLeftoverMarker(xml: string): string | null {
  const pattern = new RegExp(
    `${MARKER_OPEN}([^${MARKER_OPEN}${MARKER_CLOSE}]+)${MARKER_CLOSE}`,
  );
  const match = xml.match(pattern);
  return match ? match[1] : null;
}

function prepareValue(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replaceAll("\t", '</w:t><w:tab/><w:t xml:space="preserve">')
    .replaceAll("\n", '</w:t><w:br/><w:t xml:space="preserve">');
}
