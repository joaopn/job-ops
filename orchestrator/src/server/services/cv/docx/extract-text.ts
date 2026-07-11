import { paragraphText, walkParagraphs } from "./traverse";
import { isElement, type XmlDocument, type XmlElement } from "./xml";

/**
 * The gate's comparator input: visible text per story part, document
 * order, one line per paragraph (including empty paragraphs — the
 * comparator wants completeness, not the segment list's LLM-facing
 * economy). Tabs/breaks use the same placeholder mapping as segments
 * (see traverse.ts), so "substitute defaults back into the template"
 * reproduces this text exactly when the implementation is correct.
 */
export function extractStoryText(
  storyParts: ReadonlyMap<string, XmlDocument>,
  storyPartOrder: readonly string[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const partName of storyPartOrder) {
    const doc = storyParts.get(partName);
    if (!doc) continue;
    const root = doc.documentElement;
    if (!isElement(root)) {
      out.set(partName, "");
      continue;
    }
    const lines: string[] = [];
    walkParagraphs(root as XmlElement, (p) => {
      lines.push(paragraphText(p));
    });
    out.set(partName, lines.join("\n"));
  }
  return out;
}
