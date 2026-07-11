import { markerFor } from "./constants";
import { extractSegments } from "./extract-segments";
import { paragraphAtoms, type TextAtom } from "./traverse";
import {
  childElements,
  childNodesOf,
  getXmlSpace,
  isW,
  serializeXml,
  W_NS,
  XML_NS,
  type XmlDocument,
  type XmlElement,
} from "./xml";

/**
 * Marker splicing: turn located field spans into `⟦id⟧` marker runs.
 * The server owns this entirely — the LLM only ever names verbatim
 * spans, so orphan-marker/orphan-field failure classes are structurally
 * impossible; what CAN fail is span location, and each failure mode is
 * a typed error the upload pipeline feeds back into the LLM retry loop:
 *
 * - SPAN_NOT_FOUND   — value absent from its segment (or crosses a
 *                      structural boundary such as a hyperlink edge).
 * - SPAN_AMBIGUOUS   — value occurs more than once in the segment.
 * - OVERLAPPING_SPANS — two fields claim intersecting text.
 *
 * Mechanics: boundaries are aligned to run boundaries (splitting w:t
 * elements and runs as needed, cloned rPr on the split-off half), then
 * the covered run range is replaced by ONE marker run carrying the
 * first covered run's rPr. The marker w:t gets xml:space="preserve" so
 * substituted values with leading/trailing whitespace survive render.
 * Non-run siblings inside the range (e.g. bookmarks) are kept — they
 * carry no text and hyperlink anchors may reference them.
 *
 * Fields within one segment are spliced in DESCENDING start order:
 * each splice mutates only text at/after its own offset, so every
 * remaining (earlier) span's offsets stay valid against the original
 * segment text.
 *
 * Returns ALL story parts serialized (spliced or not) — the persisted
 * template must carry the NORMALIZED serialization of every part so a
 * later render reproduces exactly what the gate verified.
 */

export interface DocxFieldSpan {
  id: string;
  value: string;
  segmentId: number;
}

export type SpliceErrorCode =
  | "SPAN_NOT_FOUND"
  | "SPAN_AMBIGUOUS"
  | "OVERLAPPING_SPANS";

export class SpliceError extends Error {
  readonly code: SpliceErrorCode;
  readonly fieldId: string;
  constructor(message: string, code: SpliceErrorCode, fieldId: string) {
    super(message);
    this.name = "SpliceError";
    this.code = code;
    this.fieldId = fieldId;
  }
}

interface LocatedSpan {
  field: DocxFieldSpan;
  start: number;
  end: number;
}

export function spliceMarkers(
  storyParts: ReadonlyMap<string, XmlDocument>,
  storyPartOrder: readonly string[],
  fields: readonly DocxFieldSpan[],
): Map<string, string> {
  const index = extractSegments(storyParts, storyPartOrder);

  const bySegment = new Map<number, LocatedSpan[]>();
  for (const field of fields) {
    const segment = index.segments[field.segmentId];
    const paragraph = index.paragraphBySegmentId.get(field.segmentId);
    if (!segment || !paragraph) {
      throw new SpliceError(
        `Field "${field.id}" references unknown segmentId ${field.segmentId}.`,
        "SPAN_NOT_FOUND",
        field.id,
      );
    }
    if (field.value.length === 0) {
      throw new SpliceError(
        `Field "${field.id}" has an empty value.`,
        "SPAN_NOT_FOUND",
        field.id,
      );
    }
    const first = segment.text.indexOf(field.value);
    if (first === -1) {
      throw new SpliceError(
        `Field "${field.id}": value not found in segment ${field.segmentId}. The value must be a verbatim substring of the segment text.`,
        "SPAN_NOT_FOUND",
        field.id,
      );
    }
    if (segment.text.indexOf(field.value, first + 1) !== -1) {
      throw new SpliceError(
        `Field "${field.id}": value occurs more than once in segment ${field.segmentId}. Choose a longer, unambiguous span.`,
        "SPAN_AMBIGUOUS",
        field.id,
      );
    }
    const located: LocatedSpan = {
      field,
      start: first,
      end: first + field.value.length,
    };
    const list = bySegment.get(field.segmentId);
    if (list) list.push(located);
    else bySegment.set(field.segmentId, [located]);
  }

  for (const [segmentId, spans] of bySegment) {
    spans.sort((a, b) => a.start - b.start);
    for (let i = 1; i < spans.length; i++) {
      if (spans[i].start < spans[i - 1].end) {
        throw new SpliceError(
          `Fields "${spans[i - 1].field.id}" and "${spans[i].field.id}" overlap in segment ${segmentId}.`,
          "OVERLAPPING_SPANS",
          spans[i].field.id,
        );
      }
    }
    const paragraph = index.paragraphBySegmentId.get(segmentId);
    if (!paragraph) continue;
    for (const span of [...spans].reverse()) {
      spliceOne(paragraph, span);
    }
  }

  const out = new Map<string, string>();
  for (const partName of storyPartOrder) {
    const doc = storyParts.get(partName);
    if (!doc?.documentElement) continue;
    out.set(partName, serializeXml(doc));
  }
  return out;
}

function spliceOne(paragraph: XmlElement, span: LocatedSpan): void {
  ensureRunBoundary(paragraph, span.start, span.field.id);
  ensureRunBoundary(paragraph, span.end, span.field.id);

  const atoms = paragraphAtoms(paragraph);
  const covered = atoms.filter(
    (a) => a.start >= span.start && a.start + a.length <= span.end,
  );
  const coveredText = covered
    .map((a) =>
      a.kind === "t" ? textAtomContent(a) : a.kind === "tab" ? "\t" : "\n",
    )
    .join("");
  if (coveredText !== span.field.value) {
    throw new SpliceError(
      `Field "${span.field.id}": internal span mapping mismatch (expected ${JSON.stringify(span.field.value)}, mapped ${JSON.stringify(coveredText)}).`,
      "SPAN_NOT_FOUND",
      span.field.id,
    );
  }

  const runs: XmlElement[] = [];
  for (const atom of covered) {
    if (runs[runs.length - 1] !== atom.run) runs.push(atom.run);
  }
  const parent = runs[0]?.parentNode;
  if (!parent) {
    throw new SpliceError(
      `Field "${span.field.id}": span maps to no runs.`,
      "SPAN_NOT_FOUND",
      span.field.id,
    );
  }
  for (const run of runs) {
    if (run.parentNode !== parent) {
      throw new SpliceError(
        `Field "${span.field.id}": span crosses a structural boundary (e.g. a hyperlink edge). Choose a span within one formatting context.`,
        "SPAN_NOT_FOUND",
        span.field.id,
      );
    }
  }

  const doc = paragraph.ownerDocument;
  if (!doc) {
    throw new SpliceError(
      `Field "${span.field.id}": paragraph is detached.`,
      "SPAN_NOT_FOUND",
      span.field.id,
    );
  }
  const markerRun = doc.createElementNS(W_NS, "w:r");
  const firstRPr = childElements(runs[0]).find((c) => isW(c, "rPr"));
  if (firstRPr) markerRun.appendChild(firstRPr.cloneNode(true));
  const markerT = doc.createElementNS(W_NS, "w:t");
  markerT.setAttributeNS(XML_NS, "xml:space", "preserve");
  markerT.appendChild(doc.createTextNode(markerFor(span.field.id)));
  markerRun.appendChild(markerT);

  parent.insertBefore(markerRun, runs[0]);
  for (const run of runs) {
    parent.removeChild(run);
  }
}

function textAtomContent(atom: TextAtom): string {
  let out = "";
  for (const child of childNodesOf(atom.el)) {
    if (child.nodeType === 3 || child.nodeType === 4) {
      out += (child as unknown as { data: string }).data;
    }
  }
  return out;
}

/**
 * Guarantee a run boundary at text offset `offset` within the
 * paragraph, splitting a w:t element and/or its run when the boundary
 * falls inside one. Offsets at 0 / total length need nothing.
 */
function ensureRunBoundary(
  paragraph: XmlElement,
  offset: number,
  fieldId: string,
): void {
  const atoms = paragraphAtoms(paragraph);
  const total = atoms.reduce((sum, a) => sum + a.length, 0);
  if (offset <= 0 || offset >= total) return;

  const inside = atoms.find(
    (a) => a.start < offset && offset < a.start + a.length,
  );
  if (inside) {
    // Boundary mid-atom: only multi-char atoms (w:t) can contain one.
    const charOffset = offset - inside.start;
    const text = textAtomContent(inside);
    const doc = inside.el.ownerDocument;
    if (!doc) return;
    const before = text.slice(0, charOffset);
    const after = text.slice(charOffset);
    const afterT = inside.el.cloneNode(false) as XmlElement;
    setT(inside.el, before);
    setT(afterT, after);
    inside.el.parentNode?.insertBefore(afterT, inside.el.nextSibling);
    splitRunBeforeChild(inside.run, afterT);
    return;
  }

  const atAtom = atoms.find((a) => a.start === offset);
  if (!atAtom) {
    throw new SpliceError(
      `Field "${fieldId}": cannot align a span boundary at offset ${offset}.`,
      "SPAN_NOT_FOUND",
      fieldId,
    );
  }
  const previous = atoms[atoms.indexOf(atAtom) - 1];
  if (!previous || previous.run !== atAtom.run) return;
  splitRunBeforeChild(atAtom.run, atAtom.el);
}

function setT(t: XmlElement, text: string): void {
  for (const node of childNodesOf(t)) t.removeChild(node);
  const doc = t.ownerDocument;
  if (doc) t.appendChild(doc.createTextNode(text));
  if (text !== text.trim() || getXmlSpace(t) === "preserve") {
    t.setAttributeNS(XML_NS, "xml:space", "preserve");
  }
}

/** Split `run` so that `child` becomes the first content of a new run
 * inserted immediately after; the new run clones the original's rPr. */
function splitRunBeforeChild(run: XmlElement, child: XmlElement): void {
  const doc = run.ownerDocument;
  const parent = run.parentNode;
  if (!doc || !parent) return;
  const second = run.cloneNode(false) as XmlElement;
  const rPr = childElements(run).find((c) => isW(c, "rPr"));
  if (rPr) second.appendChild(rPr.cloneNode(true));
  let move = false;
  for (const node of childNodesOf(run)) {
    if (node === child) move = true;
    if (move) second.appendChild(node);
  }
  parent.insertBefore(second, run.nextSibling);
}
