import { ExpertComment, ExpertCommentDraftAnchor } from "@types";

/**
 * Every selectable line on the review screen is an element carrying `data-anchor`: a transcript
 * turn (`turn:3`) or one field of one card (`card:work_on_this[0].why`). Offsets are counted in that
 * element's text, so they match what ally-be checks the quote against.
 */
export const ANCHOR_ATTR = "data-anchor";

export const turnAnchor = (turnIndex: number) => `turn:${turnIndex}`;
export const cardAnchor = (section: string) => `card:${section}`;
export const askAnchor = (i: number) => `ask:${i}`;

/** `turn:3` → transcript anchor; `card:opening` → card anchor; anything else → null. */
export function parseAnchorKey(
  key: string | null | undefined,
): Pick<ExpertCommentDraftAnchor, "anchorKind" | "turnIndex" | "section"> | null {
  if (!key) return null;
  const turn = /^turn:(\d+)$/.exec(key);
  if (turn) return { anchorKind: "transcript", turnIndex: Number(turn[1]) };
  const card = /^card:(.+)$/.exec(key);
  if (card) return { anchorKind: "card", section: card[1] };
  // Ask Ally exchanges: a comment on the debrief as a whole, quoting the words.
  const ask = /^ask:(\d+)$/.exec(key);
  if (ask) return { anchorKind: "debrief", section: `ask_ally[${ask[1]}]` };
  return null;
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
 * The current selection as a comment anchor, or null when it is empty, crosses two lines, or sits
 * outside any selectable line. Leading and trailing spaces are trimmed off the span.
 */
export function selectionToAnchor(selection: Selection | null): ExpertCommentDraftAnchor | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const root = anchorElement(range.startContainer);
  if (!root || root !== anchorElement(range.endContainer)) return null;
  const parsed = parseAnchorKey(root.getAttribute(ANCHOR_ATTR));
  if (!parsed) return null;
  const text = root.textContent ?? "";
  let start = offsetWithin(root, range.startContainer, range.startOffset);
  let end = offsetWithin(root, range.endContainer, range.endOffset);
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (end <= start) return null;
  return { ...parsed, spanStart: start, spanEnd: end, quotedText: text.slice(start, end) };
}

export interface TextSegment {
  text: string;
  /** The thread this stretch of text is highlighted for. */
  commentId: string | null;
  resolved: boolean;
}

/**
 * Splits a line into plain and highlighted stretches for the comments anchored on it. Where two
 * comments overlap, the earlier-starting one keeps the overlap: highlights never nest.
 */
export function segmentText(
  text: string,
  comments: Array<Pick<ExpertComment, "id" | "spanStart" | "spanEnd" | "status">>,
): TextSegment[] {
  const spans = comments
    .filter(
      c =>
        c.spanStart !== null &&
        c.spanEnd !== null &&
        c.spanStart >= 0 &&
        c.spanEnd <= text.length &&
        c.spanEnd > c.spanStart,
    )
    .sort((a, b) => (a.spanStart as number) - (b.spanStart as number));
  const out: TextSegment[] = [];
  let at = 0;
  for (const c of spans) {
    const start = Math.max(c.spanStart as number, at);
    const end = c.spanEnd as number;
    if (end <= start) continue;
    if (start > at) out.push({ text: text.slice(at, start), commentId: null, resolved: false });
    out.push({ text: text.slice(start, end), commentId: c.id, resolved: c.status === "resolved" });
    at = end;
  }
  if (at < text.length) out.push({ text: text.slice(at), commentId: null, resolved: false });
  return out.length ? out : [{ text, commentId: null, resolved: false }];
}
