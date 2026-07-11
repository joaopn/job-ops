import {
  childElements,
  getXmlSpace,
  isElement,
  isMc,
  isW,
  textOf,
  type XmlElement,
  type XmlNode,
} from "./xml";

/**
 * Shared document-order walker for story parts. Every module that reads
 * or edits text (extract-segments, extract-text, splice-markers,
 * normalize-runs) goes through these rules so they cannot drift apart:
 *
 * - Traversal descends everywhere (tables, hyperlinks, sdt content, text
 *   boxes in both dialects — `w:txbxContent` is the W-namespace child of
 *   DrawingML `wps:txbx` and VML `v:textbox` alike).
 * - `mc:AlternateContent`: take the FIRST `mc:Choice`; every other
 *   `Choice` and the `Fallback` carry alternate representations of the
 *   SAME content and are skipped, or extraction would double-count every
 *   dual-encoded text box. An AlternateContent with NO Choice traverses
 *   its Fallback(s) as the only content, so nothing becomes invisible on
 *   malformed input. (normalize-runs REMOVES the skipped branches from
 *   the DOM — see its module doc.)
 * - Text atoms live only inside `w:r`: `w:t` (character data), `w:tab`
 *   (→ "\t"), `w:br`/`w:cr` (→ "\n"). `w:tab` under `w:pPr/w:tabs` is a
 *   tab-stop DEFINITION, not text — collecting only run children makes
 *   that distinction structural. `w:instrText` (field code) is skipped;
 *   a field's cached display text is ordinary `w:t` and is collected.
 * - Paragraphs nest via text boxes (a `w:p` can contain a drawing whose
 *   `w:txbxContent` holds more `w:p`s). The OUTER paragraph's text
 *   excludes nested-paragraph subtrees; the nested paragraphs are their
 *   own entries in document order (yielded after their host, since the
 *   walker descends into the host's children after visiting it).
 */

export function mcSelectedChildren(el: XmlElement): XmlNode[] {
  const kids = childElements(el);
  const firstChoice = kids.find((k) => isMc(k, "Choice"));
  if (firstChoice) return [firstChoice];
  return kids.filter((k) => isMc(k, "Fallback"));
}

function walkChildren(node: XmlElement, visit: (el: XmlElement) => void): void {
  const targets = isMc(node, "AlternateContent")
    ? mcSelectedChildren(node)
    : childElements(node);
  for (const child of targets) {
    if (!isElement(child)) continue;
    visit(child);
  }
}

/** Visit every w:p under `root` (inclusive descent), document order. */
export function walkParagraphs(
  root: XmlElement,
  visit: (p: XmlElement) => void,
): void {
  const step = (el: XmlElement): void => {
    if (isW(el, "p")) visit(el);
    walkChildren(el, step);
  };
  step(root);
}

/**
 * All w:r elements belonging to paragraph `p` itself — descends through
 * hyperlinks/fldSimple/sdt/smartTag wrappers, applies the mc rule, and
 * stops at nested w:p boundaries (text-box content is not this
 * paragraph's text).
 */
export function collectRuns(p: XmlElement): XmlElement[] {
  const runs: XmlElement[] = [];
  const step = (el: XmlElement): void => {
    if (isW(el, "r")) {
      runs.push(el);
      return;
    }
    if (isW(el, "p") && el !== p) return;
    walkChildren(el, step);
  };
  walkChildren(p, step);
  return runs;
}

/** The visible text of one run, with tab/break placeholders. */
export function runText(run: XmlElement): string {
  let out = "";
  for (const child of childElements(run)) {
    if (isW(child, "t")) out += textOf(child);
    else if (isW(child, "tab")) out += "\t";
    else if (isW(child, "br") || isW(child, "cr")) out += "\n";
  }
  return out;
}

export function paragraphText(p: XmlElement): string {
  return collectRuns(p).map(runText).join("");
}

/**
 * Text atoms of a paragraph with character offsets into
 * `paragraphText(p)` — the offset↔DOM mapping splice-markers needs.
 * `kind: "t"` atoms point at the w:t ELEMENT (splittable); tab/br atoms
 * are single indivisible placeholder characters.
 */
export interface TextAtom {
  kind: "t" | "tab" | "br";
  el: XmlElement;
  run: XmlElement;
  start: number;
  length: number;
}

export function paragraphAtoms(p: XmlElement): TextAtom[] {
  const atoms: TextAtom[] = [];
  let offset = 0;
  for (const run of collectRuns(p)) {
    for (const child of childElements(run)) {
      if (isW(child, "t")) {
        const len = textOf(child).length;
        atoms.push({ kind: "t", el: child, run, start: offset, length: len });
        offset += len;
      } else if (isW(child, "tab")) {
        atoms.push({ kind: "tab", el: child, run, start: offset, length: 1 });
        offset += 1;
      } else if (isW(child, "br") || isW(child, "cr")) {
        atoms.push({ kind: "br", el: child, run, start: offset, length: 1 });
        offset += 1;
      }
    }
  }
  return atoms;
}

export { getXmlSpace };
