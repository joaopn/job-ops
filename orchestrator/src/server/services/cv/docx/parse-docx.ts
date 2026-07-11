import { unzipSync } from "fflate";
import {
  DEFAULT_MAX_EXPANDED_BYTES,
  DEFAULT_MAX_PART_COUNT,
  MARKER_CLOSE,
  MARKER_OPEN,
} from "./constants";
import { extractStoryText } from "./extract-text";
import {
  childElements,
  isElement,
  parseXml,
  textOf,
  W_NS,
  type XmlDocument,
  type XmlElement,
  XmlParseError,
} from "./xml";

/**
 * Stage-1 ingest for the docx substrate: unzip, validate, and parse the
 * story parts. Every reject is a typed code — the upload pipeline maps
 * them onto the aliased LaTeX stage vocabulary (parse failures surface
 * as stage "flatten" → HTTP 400).
 *
 * Part-order contract (cited by extract-segments / extract-text /
 * splice-markers): `word/document.xml` FIRST, then header and footer
 * parts in the order their Overrides appear in `[Content_Types].xml`.
 * Deterministic per file; all downstream document-order semantics build
 * on this one definition.
 *
 * Zip-bomb enforcement is dual: declared (attacker-controlled) entry
 * sizes are summed BEFORE any extraction, and the actual inflated size
 * of every entry we read is accumulated against the same cap during
 * extraction. Entries we never inflate (media) are covered by the
 * declared-size gate plus the part-count cap.
 *
 * Zip layer is fflate, NOT adm-zip: adm-zip's local-header-based reader
 * fails on entries written with data descriptors (streaming zip
 * writers; observed on a real-world Word CV — "No descriptor present"),
 * while fflate reads the central directory where sizes are always
 * present. The entry table is collected via a filter callback that
 * inflates NOTHING; parts are inflated selectively afterwards.
 */

export type ParseDocxErrorCode =
  | "NOT_DOCX"
  | "MACRO_PACKAGE"
  | "TRACKED_CHANGES"
  | "EXTERNAL_REF_FIELD"
  | "ZIP_BOMB"
  | "PATH_TRAVERSAL"
  | "MARKER_COLLISION"
  | "DOCTYPE_FORBIDDEN"
  | "PART_UNPARSEABLE";

export class ParseDocxError extends Error {
  readonly code: ParseDocxErrorCode;
  readonly partName?: string;
  constructor(message: string, code: ParseDocxErrorCode, partName?: string) {
    super(message);
    this.name = "ParseDocxError";
    this.code = code;
    this.partName = partName;
  }
}

export interface ParseDocxOptions {
  maxExpandedBytes?: number;
  maxPartCount?: number;
}

export interface DocxPackage {
  /** Story parts keyed by part name, parsed. */
  storyParts: Map<string, XmlDocument>;
  /** Canonical story-part order (see module doc). */
  storyPartOrder: string[];
}

const CONTENT_TYPES_PART = "[Content_Types].xml";
const MAIN_PART_DEFAULT = "word/document.xml";
const MAIN_CONTENT_TYPE_SUFFIX = "wordprocessingml.document.main+xml";
const HEADER_CONTENT_TYPE_SUFFIX = "wordprocessingml.header+xml";
const FOOTER_CONTENT_TYPE_SUFFIX = "wordprocessingml.footer+xml";

// The four TEXT-bearing revision classes. Property-level tracked changes
// (w:pPrChange / w:rPrChange) deliberately pass through — they carry no
// text, so neither extraction nor span math can be corrupted by them.
const TRACKED_CHANGE_ELEMENTS = ["ins", "del", "moveFrom", "moveTo"] as const;
const EXTERNAL_FIELD_PATTERN =
  /\b(INCLUDETEXT|INCLUDEPICTURE|DDEAUTO|DDE|IMPORT|LINK)\b/i;

export function parseDocx(
  archive: Uint8Array,
  opts?: ParseDocxOptions,
): DocxPackage {
  const maxExpandedBytes = opts?.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES;
  const maxPartCount = opts?.maxPartCount ?? DEFAULT_MAX_PART_COUNT;
  const buf = Buffer.from(archive);

  if (looksLikeCfb(buf)) {
    throw new ParseDocxError(
      "This file is an OLE compound document — a password-protected .docx or a legacy .doc. Remove the password / save as .docx in Word and re-upload.",
      "NOT_DOCX",
    );
  }
  if (!looksLikeZip(buf)) {
    throw new ParseDocxError(
      "Not a .docx file (not a zip archive).",
      "NOT_DOCX",
    );
  }

  // Pass 1: entry table only — the filter always returns false, so
  // nothing is inflated while we validate names and declared sizes.
  const entryNames = new Set<string>();
  let entryCount = 0;
  let declaredTotal = 0;
  try {
    unzipSync(buf, {
      filter: (file) => {
        entryCount += 1;
        entryNames.add(file.name);
        declaredTotal += file.originalSize;
        return false;
      },
    });
  } catch (error) {
    throw new ParseDocxError(
      `Not a readable .docx archive: ${error instanceof Error ? error.message : String(error)}`,
      "NOT_DOCX",
    );
  }

  if (entryCount > maxPartCount) {
    throw new ParseDocxError(
      `Archive has ${entryCount} entries (limit ${maxPartCount}).`,
      "ZIP_BOMB",
    );
  }
  if (declaredTotal > maxExpandedBytes) {
    throw new ParseDocxError(
      `Archive declares ${declaredTotal} uncompressed bytes (limit ${maxExpandedBytes}).`,
      "ZIP_BOMB",
    );
  }
  for (const name of entryNames) {
    if (
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..")
    ) {
      throw new ParseDocxError(
        `Archive entry "${name}" has an unsafe path.`,
        "PATH_TRAVERSAL",
      );
    }
    if (name.split("/").pop() === "vbaProject.bin") {
      throw new ParseDocxError(
        "Macro-enabled documents are not accepted. Save as a plain .docx (without macros) and re-upload.",
        "MACRO_PACKAGE",
      );
    }
  }

  let inflatedTotal = 0;
  const readEntry = (name: string): string => {
    if (!entryNames.has(name)) {
      throw new ParseDocxError(
        `Part "${name}" is referenced but missing from the archive.`,
        "PART_UNPARSEABLE",
        name,
      );
    }
    let data: Uint8Array | undefined;
    try {
      data = unzipSync(buf, { filter: (file) => file.name === name })[name];
    } catch (error) {
      throw new ParseDocxError(
        `Part "${name}" could not be extracted: ${error instanceof Error ? error.message : String(error)}`,
        "PART_UNPARSEABLE",
        name,
      );
    }
    if (!data) {
      throw new ParseDocxError(
        `Part "${name}" could not be extracted.`,
        "PART_UNPARSEABLE",
        name,
      );
    }
    inflatedTotal += data.length;
    if (inflatedTotal > maxExpandedBytes) {
      throw new ParseDocxError(
        `Archive inflates past ${maxExpandedBytes} bytes.`,
        "ZIP_BOMB",
      );
    }
    return Buffer.from(data).toString("utf8");
  };

  // Deliberately requires the LITERAL word/document.xml entry even though
  // resolveStoryPartOrder can honor an Override-declared main-part name:
  // every real-world producer uses the canonical name, and over-strict is
  // the safe direction for an acceptance gate. The Override support below
  // only affects ORDERING, not existence.
  if (
    !entryNames.has(CONTENT_TYPES_PART) ||
    !entryNames.has(MAIN_PART_DEFAULT)
  ) {
    throw new ParseDocxError(
      "Not a .docx package (missing [Content_Types].xml or word/document.xml).",
      "NOT_DOCX",
    );
  }

  const contentTypesXml = readEntry(CONTENT_TYPES_PART);
  if (/macroEnabled/i.test(contentTypesXml)) {
    throw new ParseDocxError(
      "Macro-enabled documents are not accepted. Save as a plain .docx (without macros) and re-upload.",
      "MACRO_PACKAGE",
    );
  }
  const contentTypes = parsePart(contentTypesXml, CONTENT_TYPES_PART);

  const storyPartOrder = resolveStoryPartOrder(contentTypes);
  const storyParts = new Map<string, XmlDocument>();
  for (const partName of storyPartOrder) {
    storyParts.set(partName, parsePart(readEntry(partName), partName));
  }

  for (const [partName, doc] of storyParts) {
    for (const local of TRACKED_CHANGE_ELEMENTS) {
      if (doc.getElementsByTagNameNS(W_NS, local).length > 0) {
        throw new ParseDocxError(
          "This document has unresolved tracked changes. Open it in Word, accept or reject all changes, and upload again.",
          "TRACKED_CHANGES",
          partName,
        );
      }
    }
  }

  for (const [partName, doc] of storyParts) {
    const instr = collectFieldInstructions(doc);
    const match = instr.match(EXTERNAL_FIELD_PATTERN);
    if (match) {
      throw new ParseDocxError(
        `This document contains a ${match[1].toUpperCase()} field, which references external content. Remove it in Word and re-upload.`,
        "EXTERNAL_REF_FIELD",
        partName,
      );
    }
  }

  for (const [partName, text] of extractStoryText(storyParts, storyPartOrder)) {
    if (text.includes(MARKER_OPEN) || text.includes(MARKER_CLOSE)) {
      throw new ParseDocxError(
        `This document's text contains the reserved marker character "${MARKER_OPEN}"/"${MARKER_CLOSE}". Remove it and re-upload.`,
        "MARKER_COLLISION",
        partName,
      );
    }
  }

  return { storyParts, storyPartOrder };
}

function parsePart(xml: string, partName: string): XmlDocument {
  try {
    return parseXml(xml, partName);
  } catch (error) {
    if (error instanceof XmlParseError) {
      throw new ParseDocxError(error.message, error.code, partName);
    }
    throw error;
  }
}

function resolveStoryPartOrder(contentTypes: XmlDocument): string[] {
  let mainPart = MAIN_PART_DEFAULT;
  const headersAndFooters: string[] = [];
  const root = contentTypes.documentElement;
  if (root) {
    for (const child of childElements(root as XmlElement)) {
      if (child.localName !== "Override") continue;
      const partName = (child.getAttribute("PartName") ?? "").replace(
        /^\//,
        "",
      );
      const contentType = child.getAttribute("ContentType") ?? "";
      if (!partName) continue;
      if (contentType.endsWith(MAIN_CONTENT_TYPE_SUFFIX)) {
        mainPart = partName;
      } else if (
        contentType.endsWith(HEADER_CONTENT_TYPE_SUFFIX) ||
        contentType.endsWith(FOOTER_CONTENT_TYPE_SUFFIX)
      ) {
        headersAndFooters.push(partName);
      }
    }
  }
  return [mainPart, ...headersAndFooters];
}

function collectFieldInstructions(doc: XmlDocument): string {
  const chunks: string[] = [];
  const instrTexts = doc.getElementsByTagNameNS(W_NS, "instrText");
  for (let i = 0; i < instrTexts.length; i++) {
    const node = instrTexts.item(i);
    if (isElement(node)) chunks.push(textOf(node));
  }
  const fldSimples = doc.getElementsByTagNameNS(W_NS, "fldSimple");
  for (let i = 0; i < fldSimples.length; i++) {
    const node = fldSimples.item(i);
    if (!isElement(node)) continue;
    chunks.push(
      node.getAttributeNS(W_NS, "instr") || node.getAttribute("w:instr") || "",
    );
  }
  return chunks.join("\n");
}

function looksLikeZip(buf: Buffer): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04
  );
}

function looksLikeCfb(buf: Buffer): boolean {
  return (
    buf.length >= 4 &&
    buf[0] === 0xd0 &&
    buf[1] === 0xcf &&
    buf[2] === 0x11 &&
    buf[3] === 0xe0
  );
}
