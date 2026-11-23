/**
 * Every selectable line of a debrief card is an element carrying `data-anchor="card:<section>"`,
 * e.g. `card:work_on_this[0].why`. Offsets are counted in that element's own text, so they match
 * what ally-be checks the selected words against (the card field's stored text).
 */
export const ANCHOR_ATTR = "data-anchor";

/**
 * A line drawn between its own marks (a quote: “text”) says how many characters of marks sit on each
 * side, so offsets still count in the stored text.
 */
export const ANCHOR_WRAP_ATTR = "data-anchor-wrap";

/** A selection longer than this is a paragraph, not a point to comment on. */
export const SELECTION_MAX_CHARS = 300;

export const cardAnchor = (section: string) => `card:${section}`;

export interface SelectionAnchor {
  section: string;
  spanStart: number;
  spanEnd: number;
  quotedText: string;
}

const anchorElement = (node: Node | null): HTMLElement | null => {
  const el = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  return el?.closest<HTMLElement>(`[${ANCHOR_ATTR}]`) ?? null;
};

/** Characters from the start of `root` to (`node`, `offset`). */
const offsetWithin = (root: HTMLElement, node: Node, offset: number): number => {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
};

/**
 * The current selection as a card anchor, or null when it is empty, crosses two lines, sits outside
 * `container`, or is too long. Leading and trailing spaces are trimmed off the span.
 */
export function selectionToAnchor(
  selection: Selection | null,
  container: HTMLElement | null,
): { anchor: SelectionAnchor; rect: DOMRect } | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !container) return null;
  const range = selection.getRangeAt(0);
  const root = anchorElement(range.startContainer);
  if (!root || root !== anchorElement(range.endContainer) || !container.contains(root)) return null;
  const key = /^card:(.+)$/.exec(root.getAttribute(ANCHOR_ATTR) ?? "");
  if (!key) return null;
  const full = root.textContent ?? "";
  const wrap = Number(root.getAttribute(ANCHOR_WRAP_ATTR) ?? 0) || 0;
  const text = full.slice(wrap, full.length - wrap);
  const clamp = (n: number) => Math.min(Math.max(n - wrap, 0), text.length);
  let start = clamp(offsetWithin(root, range.startContainer, range.startOffset));
  let end = clamp(offsetWithin(root, range.endContainer, range.endOffset));
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (end <= start || end - start > SELECTION_MAX_CHARS) return null;
  return {
    anchor: {
      section: key[1],
      spanStart: start,
      spanEnd: end,
      quotedText: text.slice(start, end),
    },
    // Where the words are; the line itself where a browser cannot say.
    rect:
      typeof range.getBoundingClientRect === "function"
        ? range.getBoundingClientRect()
        : root.getBoundingClientRect(),
  };
}
