import {
  allElements,
  childElements,
  childNodesOf,
  getXmlSpace,
  isElement,
  isMc,
  isW,
  serializeXml,
  textOf,
  W_NS,
  XML_NS,
  type XmlDocument,
  type XmlElement,
} from "./xml";

/**
 * Normalization: the precondition for reliable span→run mapping. Word
 * fractures a phrase across arbitrarily many runs (spell-check
 * boundaries, rsid revision stamps); splice-markers needs "one span of
 * text = a small, contiguous set of runs" to hold.
 *
 * Mutates the story-part DOM in place:
 * 1. `mc:AlternateContent` pruning — keep the FIRST `mc:Choice` only;
 *    every other `Choice` and the `Fallback` are REMOVED (not merely
 *    skipped). Removal is load-bearing for content integrity: the
 *    branches duplicate the same text, and a marker spliced into the
 *    kept branch would leave STALE untailored text in the others —
 *    invisible to the gate (extraction skips them) and rendered by any
 *    consumer that picks that branch. Structural removal makes the
 *    divergence impossible; the recorded cost is that pre-2010-era
 *    consumers render an empty shape instead of stale content. An
 *    AlternateContent with NO Choice keeps its Fallback(s) — they are
 *    the only content.
 * 2. Drop `w:proofErr` and `w:lastRenderedPageBreak` (spell-check
 *    bookends / pagination cache — noise that blocks run merging).
 * 3. Strip `w:rsid*` attributes everywhere (revision stamps; the reason
 *    visually identical runs compare unequal).
 * 4. Merge adjacent sibling `w:r` runs whose effective `w:rPr` is
 *    identical (serialized comparison, post-rsid-strip) and whose
 *    content is plain text atoms (`w:t`/`w:tab`/`w:br`/`w:cr`). Runs
 *    carrying anything else (drawings, field chars, footnote refs) are
 *    never merged. Merging never crosses a non-run sibling (bookmarks
 *    are kept — hyperlink anchors reference them — so a bookmark between
 *    runs simply prevents merging across it).
 *
 * Invariant (unit-pinned): normalization never changes extracted text.
 */
export function normalizeStoryPart(doc: XmlDocument): void {
  const root = doc.documentElement;
  if (!isElement(root)) return;

  pruneAlternateContent(root as XmlElement);

  for (const el of allElements(root as XmlElement)) {
    if (isW(el, "proofErr") || isW(el, "lastRenderedPageBreak")) {
      el.parentNode?.removeChild(el);
    }
  }

  for (const el of allElements(root as XmlElement)) {
    stripRsidAttributes(el);
  }

  for (const el of allElements(root as XmlElement)) {
    mergeAdjacentRuns(el);
  }
}

function pruneAlternateContent(root: XmlElement): void {
  for (const el of allElements(root)) {
    if (!isMc(el, "AlternateContent")) continue;
    const kids = childElements(el);
    const firstChoice = kids.find((k) => isMc(k, "Choice"));
    if (!firstChoice) continue;
    for (const kid of kids) {
      if (kid !== firstChoice) el.removeChild(kid);
    }
  }
}

function stripRsidAttributes(el: XmlElement): void {
  const toRemove: Array<{ ns: string | null; local: string; name: string }> =
    [];
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes.item(i);
    if (!attr) continue;
    const local = attr.localName ?? attr.name;
    if (local.startsWith("rsid")) {
      toRemove.push({ ns: attr.namespaceURI, local, name: attr.name });
    }
  }
  for (const attr of toRemove) {
    if (attr.ns) el.removeAttributeNS(attr.ns, attr.local);
    else el.removeAttribute(attr.name);
  }
}

const MERGEABLE_RUN_CHILDREN = new Set(["rPr", "t", "tab", "br", "cr"]);

function isMergeableRun(el: XmlElement): boolean {
  if (!isW(el, "r")) return false;
  for (const child of childNodesOf(el)) {
    if (child.nodeType === 3) {
      const data = (child as unknown as { data: string }).data;
      if (data.trim().length > 0) return false;
      continue;
    }
    if (!isElement(child)) continue;
    if (
      child.namespaceURI !== W_NS ||
      !MERGEABLE_RUN_CHILDREN.has(child.localName ?? "")
    ) {
      return false;
    }
  }
  return true;
}

function runPropsKey(run: XmlElement): string {
  const rPr = childElements(run).find((c) => isW(c, "rPr"));
  return rPr ? serializeXml(rPr) : "";
}

function mergeAdjacentRuns(parent: XmlElement): void {
  let current: XmlElement | null = null;
  let currentKey = "";
  for (const child of childElements(parent)) {
    if (!isW(child, "r") || !isMergeableRun(child)) {
      current = null;
      continue;
    }
    const key = runPropsKey(child);
    if (current && key === currentKey) {
      for (const node of childNodesOf(child)) {
        if (isW(node, "rPr")) continue;
        current.appendChild(node);
      }
      parent.removeChild(child);
      coalesceTextElements(current);
    } else {
      current = child;
      currentKey = key;
    }
  }
}

function coalesceTextElements(run: XmlElement): void {
  let previous: XmlElement | null = null;
  for (const child of childElements(run)) {
    if (!isW(child, "t")) {
      previous = null;
      continue;
    }
    if (previous) {
      const combined = textOf(previous) + textOf(child);
      const preserve =
        getXmlSpace(previous) === "preserve" ||
        getXmlSpace(child) === "preserve" ||
        combined !== combined.trim();
      setTextContent(previous, combined, preserve);
      run.removeChild(child);
    } else {
      previous = child;
    }
  }
}

function setTextContent(t: XmlElement, text: string, preserve: boolean): void {
  for (const node of childNodesOf(t)) t.removeChild(node);
  const doc = t.ownerDocument;
  if (doc) t.appendChild(doc.createTextNode(text));
  if (preserve) t.setAttributeNS(XML_NS, "xml:space", "preserve");
}
