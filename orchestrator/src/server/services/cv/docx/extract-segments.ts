import { paragraphText, walkParagraphs } from "./traverse";
import { isElement, type XmlDocument, type XmlElement } from "./xml";

/**
 * The LLM-facing view of the document: one segment per NON-EMPTY
 * paragraph, in document order per the part-order contract
 * (parse-docx.ts). The LLM selects verbatim spans within a single
 * segment; splice-markers re-derives the same index from the same DOMs,
 * so segmentIds are stable as long as the DOMs are not mutated between
 * extraction and splicing (the upload pipeline's normalize → extract →
 * splice sequence guarantees that).
 */

export interface DocxSegment {
  segmentId: number;
  partName: string;
  text: string;
}

export interface SegmentIndex {
  segments: DocxSegment[];
  /** segmentId → its w:p element, for splice-markers. */
  paragraphBySegmentId: Map<number, XmlElement>;
}

export function extractSegments(
  storyParts: ReadonlyMap<string, XmlDocument>,
  storyPartOrder: readonly string[],
): SegmentIndex {
  const segments: DocxSegment[] = [];
  const paragraphBySegmentId = new Map<number, XmlElement>();
  for (const partName of storyPartOrder) {
    const doc = storyParts.get(partName);
    if (!doc) continue;
    const root = doc.documentElement;
    if (!isElement(root)) continue;
    walkParagraphs(root as XmlElement, (p) => {
      const text = paragraphText(p);
      if (text.length === 0) return;
      const segmentId = segments.length;
      segments.push({ segmentId, partName, text });
      paragraphBySegmentId.set(segmentId, p);
    });
  }
  return { segments, paragraphBySegmentId };
}
