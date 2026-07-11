import {
  DOMParser,
  XMLSerializer,
  type Document as XmlDocument,
  type Element as XmlElement,
  type Node as XmlNode,
} from "@xmldom/xmldom";

/**
 * XML layer for the docx substrate. One place owns parsing and
 * serialization so the hardening rules cannot be bypassed:
 *
 * - A DOCTYPE anywhere in a part is a hard reject. Legitimate OOXML parts
 *   never carry one, and rejecting outright eliminates the whole XML
 *   entity-expansion attack class instead of configuring around it.
 * - xmldom's default error handling is permissive (malformed input can
 *   yield a partial DOM); we collect `error`/`fatalError` reports and
 *   throw, so a broken part surfaces as PART_UNPARSEABLE rather than a
 *   silently truncated document.
 */

export const W_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const MC_NS =
  "http://schemas.openxmlformats.org/markup-compatibility/2006";
export const XML_NS = "http://www.w3.org/XML/1998/namespace";

export type { XmlDocument, XmlElement, XmlNode };

export class XmlParseError extends Error {
  readonly code: "DOCTYPE_FORBIDDEN" | "PART_UNPARSEABLE";
  readonly partName: string;
  constructor(
    message: string,
    code: "DOCTYPE_FORBIDDEN" | "PART_UNPARSEABLE",
    partName: string,
  ) {
    super(message);
    this.name = "XmlParseError";
    this.code = code;
    this.partName = partName;
  }
}

const DOCTYPE_PATTERN = /<!DOCTYPE/i;

export function parseXml(xml: string, partName: string): XmlDocument {
  if (DOCTYPE_PATTERN.test(xml)) {
    throw new XmlParseError(
      `Part "${partName}" contains a DOCTYPE declaration, which is never present in legitimate OOXML and is rejected outright.`,
      "DOCTYPE_FORBIDDEN",
      partName,
    );
  }

  const problems: string[] = [];
  let doc: XmlDocument;
  try {
    const parser = new DOMParser({
      onError: (level, message) => {
        if (level !== "warning") problems.push(`${level}: ${message}`);
      },
    });
    doc = parser.parseFromString(xml, "text/xml");
  } catch (error) {
    throw new XmlParseError(
      `Part "${partName}" is not parseable XML: ${error instanceof Error ? error.message : String(error)}`,
      "PART_UNPARSEABLE",
      partName,
    );
  }
  if (problems.length > 0 || !doc.documentElement) {
    throw new XmlParseError(
      `Part "${partName}" is not well-formed XML: ${problems[0] ?? "no document element"}`,
      "PART_UNPARSEABLE",
      partName,
    );
  }
  return doc;
}

export function serializeXml(node: XmlNode): string {
  return new XMLSerializer().serializeToString(node);
}

export function isElement(
  node: XmlNode | null | undefined,
): node is XmlElement {
  return !!node && node.nodeType === 1;
}

export function isW(
  node: XmlNode | null | undefined,
  local: string,
): node is XmlElement {
  return (
    isElement(node) && node.namespaceURI === W_NS && node.localName === local
  );
}

export function isMc(
  node: XmlNode | null | undefined,
  local: string,
): node is XmlElement {
  return (
    isElement(node) && node.namespaceURI === MC_NS && node.localName === local
  );
}

export function childElements(el: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes.item(i);
    if (isElement(child)) out.push(child);
  }
  return out;
}

export function childNodesOf(el: XmlElement): XmlNode[] {
  const out: XmlNode[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes.item(i);
    if (child) out.push(child);
  }
  return out;
}

/** Concatenated data of all direct text/CDATA children. */
export function textOf(el: XmlElement): string {
  let out = "";
  for (const child of childNodesOf(el)) {
    if (child.nodeType === 3 || child.nodeType === 4) {
      out += (child as unknown as { data: string }).data;
    }
  }
  return out;
}

export function getXmlSpace(el: XmlElement): string | null {
  return (
    el.getAttributeNS(XML_NS, "space") || el.getAttribute("xml:space") || null
  );
}

/** Every element under `root` (inclusive), document order, snapshotted. */
export function allElements(root: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const step = (el: XmlElement): void => {
    out.push(el);
    for (const child of childElements(el)) step(child);
  };
  step(root);
  return out;
}
