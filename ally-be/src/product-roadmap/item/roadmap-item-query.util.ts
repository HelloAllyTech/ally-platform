import {
  SIMPLE_STAGES,
  simpleStageOf,
  type ShownStage,
  type SimpleStage,
} from 'src/product-planning/util/plan-stage.util';
import type { WhyHere } from './roadmap-item.types';

/**
 * The queue's views, filters, sorts and cursor (plans/roadmap-builder-merge
 * §4.3), as pure functions over rows the read service has already loaded.
 *
 * The query encoding is shared with the frontend (P2-contract.md): one param
 * per filter, multi-value filters comma-separated, flags as '1'. Unknown values
 * are dropped rather than rejected, because a saved view or a pasted link
 * outliving a renamed value should narrow to nothing, not break the page.
 */

export const ITEM_VIEWS = ['for-you', 'leading', 'to-triage', 'all'] as const;
export type ItemView = (typeof ITEM_VIEWS)[number];

export const ITEM_SORTS = [
  'rank',
  'waiting',
  'newest',
  'votes',
  'activity',
  'stageAge',
] as const;
export type ItemSort = (typeof ITEM_SORTS)[number];

/**
 * The `stage` filter speaks the simple stages. The finer values a saved view or an old link may
 * still carry are read as the stage they fall in, so they narrow to the same ideas, never to nothing.
 */
const LEGACY_STAGE: Record<string, SimpleStage> = {
  new: 'backlog',
  submitted: 'backlog',
  accepted: 'backlog',
  prioritised: 'being_built',
  planning: 'being_built',
  building: 'being_built',
  released: 'shipped',
  closed: 'declined',
  archived: 'declined',
};
const toSimpleStages = (value: unknown): SimpleStage[] => [
  ...new Set(
    list(value)
      .map((v) =>
        (SIMPLE_STAGES as string[]).includes(v)
          ? (v as SimpleStage)
          : LEGACY_STAGE[v],
      )
      .filter((v): v is SimpleStage => !!v),
  ),
];
const REVIEW_STATES = ['pending', 'accepted', 'declined'] as const;
type ReviewState = (typeof REVIEW_STATES)[number];

export const DEFAULT_SORT: Record<ItemView, ItemSort> = {
  'for-you': 'waiting',
  leading: 'waiting',
  // Backlog ideas are ranked like everything not yet released; the Owner picks from the top.
  'to-triage': 'rank',
  all: 'rank',
};

export const ITEM_PAGE_DEFAULT = 50;
export const ITEM_PAGE_MAX = 200;

export interface ItemFilters {
  q?: string;
  stage?: SimpleStage[];
  review?: ReviewState[];
  goal?: string[];
  author?: number[];
  lead?: number[];
  service?: string[];
  starred?: boolean;
  openQuestion?: boolean;
  votedByMe?: boolean;
  month?: string;
}

export interface ItemQuery {
  view: ItemView;
  filters: ItemFilters;
  sort: ItemSort;
  offset: number;
  limit: number;
}

/** What filtering and sorting read about one idea. */
export interface ItemQueryFacts {
  id: string;
  code: string;
  title: string;
  authorName: string;
  shownStage: ShownStage;
  reviewState: ReviewState;
  goalId: string | null;
  authorId: number;
  leadId: number | null;
  services: string[];
  starred: boolean;
  openQuestion: boolean;
  votedByMe: boolean;
  plannedMonth: string | null;
  votes: number;
  queueRank: number | null;
  compositeScore: number;
  createdAt: string;
  lastActivityAt: string;
  stageSince: string;
  whyHere?: WhyHere;
}

type RawQuery = Record<string, unknown>;

const list = (value: unknown): string[] => {
  const raw = Array.isArray(value) ? value.join(',') : value;
  if (typeof raw !== 'string') return [];
  return [
    ...new Set(
      raw
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0 && part.length <= 64),
    ),
  ].slice(0, 50);
};

const ids = (value: unknown): number[] =>
  list(value)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

const flag = (value: unknown): boolean | undefined =>
  value === '1' || value === 'true' || value === true ? true : undefined;

const oneOf = <T extends string>(values: readonly T[], value: unknown) =>
  list(value).filter((v): v is T => (values as readonly string[]).includes(v));

const nonEmpty = <T>(values: T[]): T[] | undefined =>
  values.length ? values : undefined;

/** The request's query string into a query. Never throws. */
export function parseItemQuery(raw: RawQuery): ItemQuery {
  const view = (ITEM_VIEWS as readonly string[]).includes(String(raw.view))
    ? (raw.view as ItemView)
    : 'all';
  const sort = (ITEM_SORTS as readonly string[]).includes(String(raw.sort))
    ? (raw.sort as ItemSort)
    : DEFAULT_SORT[view];
  const month =
    typeof raw.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw.month)
      ? raw.month
      : undefined;
  const q =
    typeof raw.q === 'string' && raw.q.trim()
      ? raw.q.trim().slice(0, 200)
      : undefined;
  const limitN = Number(raw.limit);
  const filters: ItemFilters = {
    q,
    stage: nonEmpty(toSimpleStages(raw.stage)),
    review: nonEmpty(oneOf(REVIEW_STATES, raw.review)),
    goal: nonEmpty(list(raw.goal)),
    author: nonEmpty(ids(raw.author)),
    lead: nonEmpty(ids(raw.lead)),
    service: nonEmpty(list(raw.service).map((s) => s.toLowerCase())),
    starred: flag(raw.starred),
    openQuestion: flag(raw.openQuestion),
    votedByMe: flag(raw.votedByMe),
    month,
  };
  for (const key of Object.keys(filters) as (keyof ItemFilters)[]) {
    if (filters[key] === undefined) delete filters[key];
  }
  return {
    view,
    filters,
    sort,
    offset: decodeCursor(raw.cursor),
    limit:
      Number.isInteger(limitN) && limitN > 0
        ? Math.min(limitN, ITEM_PAGE_MAX)
        : ITEM_PAGE_DEFAULT,
  };
}

/** An idea's code as typed: "OPP-0388", "opp-388" or "388" → "OPP-0388" form digits. */
export function codeDigits(input: string): string | null {
  const match = /^(?:opp-?)?0*(\d{1,9})$/i.exec(input.trim());
  return match ? match[1] : null;
}

/** True when the row passes every filter given. Pure. */
export function matchesFilters(row: ItemQueryFacts, f: ItemFilters): boolean {
  if (f.q) {
    const needle = f.q.toLowerCase();
    const digits = codeDigits(f.q);
    const hit =
      row.title.toLowerCase().includes(needle) ||
      row.code.toLowerCase().includes(needle) ||
      row.authorName.toLowerCase().includes(needle) ||
      (digits !== null && codeDigits(row.code) === digits);
    if (!hit) return false;
  }
  if (f.stage && !f.stage.includes(simpleStageOf(row.shownStage, row.leadId)))
    return false;
  if (f.review && !f.review.includes(row.reviewState)) return false;
  if (f.goal && !(row.goalId && f.goal.includes(row.goalId))) return false;
  if (f.author && !f.author.includes(row.authorId)) return false;
  if (f.lead && !(row.leadId && f.lead.includes(row.leadId))) return false;
  if (f.service && !row.services.some((s) => f.service!.includes(s)))
    return false;
  if (f.starred && !row.starred) return false;
  if (f.openQuestion && !row.openQuestion) return false;
  if (f.votedByMe && !row.votedByMe) return false;
  if (f.month && row.plannedMonth !== f.month) return false;
  return true;
}

/** When the row started waiting: its why-here moment, else its stage's start. */
export function waitingSince(row: ItemQueryFacts): string {
  const why = row.whyHere;
  if (why && 'since' in why) return why.since;
  if (why?.kind === 'reassign') {
    return new Date(Date.now() - why.idleDays * 86_400_000).toISOString();
  }
  return row.stageSince;
}

const time = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/**
 * A total order for each sort, so a cursor over it can never repeat or skip a
 * row. Ties fall through to newest first, then code.
 */
export function compareRows(
  sort: ItemSort,
): (a: ItemQueryFacts, b: ItemQueryFacts) => number {
  const tiebreak = (a: ItemQueryFacts, b: ItemQueryFacts) =>
    time(b.createdAt) - time(a.createdAt) || a.code.localeCompare(b.code);
  const primary: (a: ItemQueryFacts, b: ItemQueryFacts) => number = (() => {
    switch (sort) {
      case 'rank':
        // The board's queue rank first (ranked ideas), then the composite.
        return (a, b) =>
          (a.queueRank ?? Number.MAX_SAFE_INTEGER) -
            (b.queueRank ?? Number.MAX_SAFE_INTEGER) ||
          b.compositeScore - a.compositeScore;
      case 'waiting':
        return (a, b) => time(waitingSince(a)) - time(waitingSince(b));
      case 'newest':
        return (a, b) => time(b.createdAt) - time(a.createdAt);
      case 'votes':
        return (a, b) => b.votes - a.votes;
      case 'activity':
        return (a, b) => time(b.lastActivityAt) - time(a.lastActivityAt);
      case 'stageAge':
        return (a, b) => time(a.stageSince) - time(b.stageSince);
    }
  })();
  return (a, b) => primary(a, b) || tiebreak(a, b);
}

/** The opaque cursor is an offset into the sorted, filtered list. */
export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

export function decodeCursor(cursor: unknown): number {
  if (typeof cursor !== 'string' || !cursor || cursor.length > 200) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    const o = Number(parsed?.o);
    return Number.isInteger(o) && o > 0 ? o : 0;
  } catch {
    return 0;
  }
}

/** One page of rows and the cursor for the next. */
export function page<T>(
  rows: T[],
  offset: number,
  limit: number,
): { rows: T[]; nextCursor?: string; total: number } {
  const slice = rows.slice(offset, offset + limit);
  const next = offset + slice.length;
  return {
    rows: slice,
    total: rows.length,
    ...(next < rows.length ? { nextCursor: encodeCursor(next) } : {}),
  };
}

/** The longest title the idea page shows and lets you save (the PATCH DTO allows the same). */
export const TITLE_MAX = 200;

/**
 * Splits the idea's first non-empty line into a title of at most `TITLE_MAX` characters and the
 * overflow. A longer line is cut at the last space (so a word is not sliced in half) and the rest
 * moves to the body, so no text is ever dropped between what is stored and what the page shows —
 * and saving a title edit rebuilds exactly what was stored.
 */
function splitFirstLine(description: string | null | undefined): {
  title: string;
  overflow: string;
} {
  const line =
    (description ?? '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? '';
  if (line.length <= TITLE_MAX) return { title: line, overflow: '' };
  const space = line.lastIndexOf(' ', TITLE_MAX);
  const cut = space >= TITLE_MAX / 2 ? space : TITLE_MAX;
  return {
    title: line.slice(0, cut).trimEnd(),
    overflow: line.slice(cut).trim(),
  };
}

/** The first line of an idea's text, which is its title (the row has no title column). */
export function titleOf(description: string | null | undefined): string {
  return splitFirstLine(description).title;
}

/** Everything after the title, trimmed (a long first line's overflow, then the later lines); null when there is nothing. */
export function bodyOf(description: string | null | undefined): string | null {
  const text = (description ?? '').trim();
  const newline = text.indexOf('\n');
  const rest = newline < 0 ? '' : text.slice(newline + 1).trim();
  const body = [splitFirstLine(description).overflow, rest]
    .filter(Boolean)
    .join('\n\n');
  return body.length ? body : null;
}

/** Rebuild the idea's text from a title and a body. */
export function joinDescription(title: string, body: string | null): string {
  const t = title.replace(/\s+/g, ' ').trim();
  const b = (body ?? '').trim();
  return b ? `${t}\n\n${b}` : t;
}
