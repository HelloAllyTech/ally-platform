import type { DebriefMyComment } from "@types";

import { ANCHOR_ATTR, ANCHOR_WRAP_ATTR } from "./selectionAnchor";

/** The name the page's stylesheet gives the highlight (`::highlight(my-debrief-comments)`). */
export const HIGHLIGHT_NAME = "my-debrief-comments";

/**
 * The DOM range for characters [start, end) of an anchored line's stored text, counting from the
 * line's own text nodes (a quote line carries its quotation marks, which the offsets skip).
 */
export function rangeForSpan(
  line: HTMLElement,
  start: number,
  end: number,
  wrap = 0,
): Range | null {
  const from = start + wrap;
  const to = end + wrap;
  if (end <= start || to > (line.textContent ?? "").length) return null;
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let seen = 0;
  let started = false;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const length = node.data.length;
    if (!started && from < seen + length) {
      range.setStart(node, from - seen);
      started = true;
    }
    if (started && to <= seen + length) {
      range.setEnd(node, to - seen);
      return range;
    }
    seen += length;
  }
  return null;
}

/** The ranges of the words a person commented on, found in the debrief the lines sit in. */
export function rangesFor(container: HTMLElement, comments: DebriefMyComment[]): Range[] {
  const ranges: Range[] = [];
  for (const c of comments) {
    if (!c.section || c.spanStart == null || c.spanEnd == null) continue;
    const line = container.querySelector<HTMLElement>(`[${ANCHOR_ATTR}="card:${c.section}"]`);
    if (!line) continue;
    const wrap = Number(line.getAttribute(ANCHOR_WRAP_ATTR) ?? 0) || 0;
    const range = rangeForSpan(line, c.spanStart, c.spanEnd, wrap);
    if (range) ranges.push(range);
  }
  return ranges;
}

type HighlightRegistry = {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
};

/**
 * Marks the words with the browser's CSS highlight, or does nothing where it is not there (the
 * list under the feedback box still shows every comment). Returns a function that clears it.
 */
export function applyHighlights(container: HTMLElement, comments: DebriefMyComment[]): () => void {
  const registry = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights;
  const Highlight = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!registry || !Highlight) return () => undefined;
  const ranges = rangesFor(container, comments);
  if (ranges.length === 0) return () => undefined;
  registry.set(HIGHLIGHT_NAME, new Highlight(...ranges));
  return () => registry.delete(HIGHLIGHT_NAME);
}
