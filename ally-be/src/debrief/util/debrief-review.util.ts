import {
  DebriefCommentAnchor,
  DebriefCommentTag,
} from '../enum/debrief-review.enum';

export const COMMENT_BODY_MAX = 4000;
export const QUOTE_MAX = 2000;

/** Top-level card keys that are one string. */
const STRING_SECTIONS = new Set([
  'opening',
  'reflective_question',
  'progress_note',
]);

/** The fields of each card a reviewer can select text in. */
const CARD_FIELDS: Record<string, readonly string[]> = {
  important_moment: ['lead', 'quote', 'body'],
  what_worked: ['lead', 'quote', 'body'],
  work_on_this: ['lead', 'quote', 'why', 'try_saying'],
  practise_next: ['skill', 'reason'],
};

export interface ParsedSection {
  /** The card key with its index, e.g. `work_on_this[1]` or `opening`. */
  card: string;
  /** The field inside it, when the anchor is a span. */
  field: string | null;
}

/**
 * `work_on_this[1].why` → `{card: 'work_on_this[1]', field: 'why'}`. Null for
 * anything that is not a card the learner reads.
 */
export function parseSection(section: string): ParsedSection | null {
  const m =
    /^(important_moment|practise_next|opening|reflective_question|progress_note|(?:what_worked|work_on_this)\[\d{1,2}\])(?:\.([a-z_]+))?$/.exec(
      section,
    );
  if (!m) return null;
  const card = m[1];
  const field = m[2] ?? null;
  if (STRING_SECTIONS.has(card)) return field ? null : { card, field: null };
  const key = card.replace(/\[\d+\]$/, '');
  if (field && !CARD_FIELDS[key]?.includes(field)) return null;
  return { card, field };
}

function cardAt(
  cards: Record<string, any> | null | undefined,
  card: string,
): unknown {
  if (!cards) return undefined;
  const m = /^(what_worked|work_on_this)\[(\d+)\]$/.exec(card);
  if (m) return cards[m[1]]?.[Number(m[2])];
  return cards[card];
}

/**
 * The text a card anchor's offsets index into: the field's string, or the
 * whole string for `opening`, `reflective_question` and `progress_note`.
 * Undefined when the card or field does not exist on this debrief.
 */
export function sectionFieldText(
  cards: Record<string, any> | null | undefined,
  section: string,
): string | undefined {
  const parsed = parseSection(section);
  if (!parsed) return undefined;
  const card = cardAt(cards, parsed.card);
  if (card === undefined || card === null) return undefined;
  if (parsed.field === null) {
    return typeof card === 'string' ? card : '';
  }
  const value = (card as Record<string, unknown>)[parsed.field];
  return typeof value === 'string' ? value : undefined;
}

export interface CommentAnchorInput {
  anchorKind: DebriefCommentAnchor;
  turnIndex?: number | null;
  section?: string | null;
  spanStart?: number | null;
  spanEnd?: number | null;
  quotedText?: string | null;
}

export interface CommentAnchor {
  anchorKind: DebriefCommentAnchor;
  turnIndex: number | null;
  section: string | null;
  spanStart: number | null;
  spanEnd: number | null;
  quotedText: string | null;
}

/**
 * Checks an anchor against the run it is on and returns it normalised, or
 * the problem as a sentence a reviewer can act on. The quoted text must be
 * exactly the selected span, so the PM agent can trust what it reads.
 */
export function validateAnchor(
  input: CommentAnchorInput,
  run: {
    transcript: Array<{ turnIndex: number; text: string }>;
    cards: Record<string, any> | null | undefined;
  },
): { anchor: CommentAnchor } | { problem: string } {
  const none: CommentAnchor = {
    anchorKind: input.anchorKind,
    turnIndex: null,
    section: null,
    spanStart: null,
    spanEnd: null,
    quotedText: null,
  };
  const hasSpan = input.spanStart != null || input.spanEnd != null;
  let text: string | undefined;
  switch (input.anchorKind) {
    case DebriefCommentAnchor.DEBRIEF:
      return { anchor: none };
    case DebriefCommentAnchor.TRANSCRIPT: {
      const turn = run.transcript.find((t) => t.turnIndex === input.turnIndex);
      if (!turn) return { problem: 'That turn is not in this transcript.' };
      none.turnIndex = turn.turnIndex;
      text = turn.text;
      break;
    }
    case DebriefCommentAnchor.CARD: {
      const section = String(input.section ?? '');
      const parsed = parseSection(section);
      if (!parsed) return { problem: 'That is not a card in this debrief.' };
      text = sectionFieldText(run.cards, section);
      if (text === undefined) {
        return { problem: 'That card is not in this debrief.' };
      }
      if (
        hasSpan &&
        parsed.field === null &&
        typeof cardAt(run.cards, parsed.card) !== 'string'
      ) {
        return { problem: 'Select text inside one line of the card.' };
      }
      none.section = section;
      break;
    }
    default:
      return { problem: 'Unknown comment anchor.' };
  }
  if (!hasSpan) return { anchor: none };
  const start = Number(input.spanStart);
  const end = Number(input.spanEnd);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > text.length
  ) {
    return { problem: 'The selected text is outside that line.' };
  }
  const quoted = text.slice(start, end);
  if (end - start > QUOTE_MAX) {
    return { problem: 'Select a shorter passage.' };
  }
  if (input.quotedText != null && input.quotedText !== quoted) {
    return {
      problem:
        'The selected text no longer matches. Reload and select it again.',
    };
  }
  return {
    anchor: { ...none, spanStart: start, spanEnd: end, quotedText: quoted },
  };
}

export function isCommentTag(tag: unknown): tag is DebriefCommentTag {
  return (Object.values(DebriefCommentTag) as unknown[]).includes(tag);
}

/** A comment as the PM agent reads it (gateway `comments_read`): no transcript, no reviewer identity. */
export interface GatewayComment {
  id: string;
  run_id: string;
  session_type: string | null;
  language: string | null;
  anchor: {
    kind: string;
    turn_index: number | null;
    section: string | null;
    span_start: number | null;
    span_end: number | null;
  };
  quoted_text: string | null;
  body: string;
  tag: string | null;
  status: string;
  idea: { id: string; status: string } | null;
  repeat_of_id: string | null;
  created_at: string;
  replies: Array<{
    id: string;
    body: string;
    tag: string | null;
    created_at: string;
  }>;
}

export interface CommentRow {
  id: string;
  runId: string;
  parentId: string | null;
  anchorKind: string;
  turnIndex: number | null;
  section: string | null;
  spanStart: number | null;
  spanEnd: number | null;
  quotedText: string | null;
  body: string;
  tag: string | null;
  status: string;
  ideaId: string | null;
  ideaStatus?: string | null;
  repeatOfId: string | null;
  createdAt: Date | string;
  recipeKey?: string | null;
  language?: string | null;
}

const iso = (d: Date | string) => new Date(d).toISOString();

/** Threads for the PM agent: top-level comments with their replies, oldest reply first. */
export function toGatewayComments(
  top: CommentRow[],
  replies: CommentRow[],
): GatewayComment[] {
  const byParent = new Map<string, CommentRow[]>();
  for (const r of replies) {
    if (!r.parentId) continue;
    byParent.set(r.parentId, [...(byParent.get(r.parentId) ?? []), r]);
  }
  return top.map((c) => ({
    id: c.id,
    run_id: c.runId,
    session_type: c.recipeKey ?? null,
    language: c.language ?? null,
    anchor: {
      kind: c.anchorKind,
      turn_index: c.turnIndex ?? null,
      section: c.section ?? null,
      span_start: c.spanStart ?? null,
      span_end: c.spanEnd ?? null,
    },
    quoted_text: c.quotedText ?? null,
    body: c.body,
    tag: c.tag ?? null,
    status: c.status,
    idea: c.ideaId ? { id: c.ideaId, status: c.ideaStatus ?? 'unknown' } : null,
    repeat_of_id: c.repeatOfId ?? null,
    created_at: iso(c.createdAt),
    replies: (byParent.get(c.id) ?? [])
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
      .map((r) => ({
        id: r.id,
        body: r.body,
        tag: r.tag ?? null,
        created_at: iso(r.createdAt),
      })),
  }));
}
