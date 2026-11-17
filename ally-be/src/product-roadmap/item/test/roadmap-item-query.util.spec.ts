import {
  bodyOf,
  codeDigits,
  compareRows,
  decodeCursor,
  encodeCursor,
  ItemQueryFacts,
  joinDescription,
  matchesFilters,
  page,
  parseItemQuery,
  titleOf,
} from '../roadmap-item-query.util';

const row = (over: Partial<ItemQueryFacts> = {}): ItemQueryFacts => ({
  id: 'a',
  code: 'OPP-0388',
  title: 'Streak on start screen',
  authorName: 'Ravi',
  shownStage: 'planning',
  reviewState: 'accepted',
  goalId: 'g1',
  authorId: 1,
  leadId: 2,
  services: ['be'],
  starred: false,
  openQuestion: false,
  votedByMe: false,
  plannedMonth: '2026-12',
  votes: 3,
  queueRank: 4,
  compositeScore: 50,
  createdAt: '2026-11-01T00:00:00.000Z',
  lastActivityAt: '2026-11-10T00:00:00.000Z',
  stageSince: '2026-11-05T00:00:00.000Z',
  ...over,
});

describe('parseItemQuery', () => {
  it('defaults the view to all and its sort to rank', () => {
    expect(parseItemQuery({})).toEqual({
      view: 'all',
      filters: {},
      sort: 'rank',
      offset: 0,
      limit: 50,
    });
  });

  it('gives each view its default sort and keeps a valid explicit one', () => {
    expect(parseItemQuery({ view: 'for-you' }).sort).toBe('waiting');
    expect(parseItemQuery({ view: 'to-triage' }).sort).toBe('waiting');
    expect(parseItemQuery({ view: 'all', sort: 'votes' }).sort).toBe('votes');
    expect(parseItemQuery({ view: 'all', sort: 'nope' }).sort).toBe('rank');
  });

  it('reads comma lists, drops unknown values, and never throws', () => {
    const q = parseItemQuery({
      stage: 'planning, shipped,draft,bogus',
      review: 'pending,maybe',
      author: '12,abc,-3,40',
      lead: '',
      service: 'BE,frontend',
      starred: '1',
      openQuestion: '0',
      votedByMe: 'true',
      month: '2026-13',
      q: '  streak  ',
      limit: '9999',
      cursor: '%%%',
    });
    expect(q.filters).toEqual({
      q: 'streak',
      stage: ['planning', 'shipped'],
      review: ['pending'],
      author: [12, 40],
      service: ['be', 'frontend'],
      starred: true,
      votedByMe: true,
    });
    expect(q.limit).toBe(200);
    expect(q.offset).toBe(0);
  });

  it('takes a valid planned month', () => {
    expect(parseItemQuery({ month: '2026-03' }).filters.month).toBe('2026-03');
  });
});

describe('matchesFilters', () => {
  it('matches q against title, code, a short code and the author', () => {
    expect(matchesFilters(row(), { q: 'streak' })).toBe(true);
    expect(matchesFilters(row(), { q: 'opp-388' })).toBe(true);
    expect(matchesFilters(row(), { q: '388' })).toBe(true);
    expect(matchesFilters(row(), { q: 'ravi' })).toBe(true);
    expect(matchesFilters(row(), { q: 'hindi' })).toBe(false);
  });

  it('applies every structured filter', () => {
    expect(matchesFilters(row(), { stage: ['building'] })).toBe(false);
    expect(matchesFilters(row(), { review: ['accepted'] })).toBe(true);
    expect(matchesFilters(row(), { goal: ['g2'] })).toBe(false);
    expect(matchesFilters(row(), { lead: [2] })).toBe(true);
    expect(matchesFilters(row({ leadId: null }), { lead: [2] })).toBe(false);
    expect(matchesFilters(row(), { service: ['ai'] })).toBe(false);
    expect(matchesFilters(row(), { starred: true })).toBe(false);
    expect(matchesFilters(row(), { openQuestion: true })).toBe(false);
    expect(matchesFilters(row(), { month: '2026-12' })).toBe(true);
  });
});

describe('compareRows', () => {
  const a = row({ id: 'a', code: 'OPP-1', queueRank: 2, votes: 1 });
  const b = row({ id: 'b', code: 'OPP-2', queueRank: 1, votes: 9 });
  const c = row({ id: 'c', code: 'OPP-3', queueRank: null, votes: 5 });

  it('ranks by queue rank with unranked last', () => {
    expect([a, c, b].sort(compareRows('rank')).map((r) => r.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('sorts by votes, and by waiting longest using why-here first', () => {
    expect([a, b, c].sort(compareRows('votes')).map((r) => r.id)).toEqual([
      'b',
      'c',
      'a',
    ]);
    const old = row({
      id: 'old',
      code: 'OPP-9',
      whyHere: {
        kind: 'awaitingReview',
        since: '2026-10-01T00:00:00.000Z',
      },
    });
    expect([a, old].sort(compareRows('waiting')).map((r) => r.id)[0]).toBe(
      'old',
    );
  });

  it('is a total order: identical rows fall back to code', () => {
    const x = row({ id: 'x', code: 'OPP-5' });
    const y = row({ id: 'y', code: 'OPP-4' });
    expect([x, y].sort(compareRows('votes')).map((r) => r.id)).toEqual([
      'y',
      'x',
    ]);
  });
});

describe('cursor and page', () => {
  it('round-trips an offset and ignores junk', () => {
    expect(decodeCursor(encodeCursor(150))).toBe(150);
    expect(decodeCursor('not-base64-json')).toBe(0);
    expect(decodeCursor(undefined)).toBe(0);
  });

  it('pages without repeating or skipping', () => {
    const rows = Array.from({ length: 5 }, (_, i) => i);
    const first = page(rows, 0, 2);
    expect(first).toMatchObject({ rows: [0, 1], total: 5 });
    const second = page(rows, decodeCursor(first.nextCursor), 2);
    expect(second.rows).toEqual([2, 3]);
    const last = page(rows, decodeCursor(second.nextCursor), 2);
    expect(last.rows).toEqual([4]);
    expect(last.nextCursor).toBeUndefined();
  });
});

describe('title and body', () => {
  it('splits the idea text at its first line', () => {
    const text = '\n Streak on start screen \nLearners drop off.\nMore.';
    expect(titleOf(text)).toBe('Streak on start screen');
    expect(bodyOf(text)).toBe('Learners drop off.\nMore.');
    expect(bodyOf('Only a title')).toBeNull();
  });

  it('joins them back with a blank line, or the title alone', () => {
    expect(joinDescription(' New  title ', 'Body')).toBe('New title\n\nBody');
    expect(joinDescription('New title', null)).toBe('New title');
  });

  it('reads codes the ways people type them', () => {
    expect(codeDigits('OPP-0388')).toBe('388');
    expect(codeDigits('opp388')).toBe('388');
    expect(codeDigits('388')).toBe('388');
    expect(codeDigits('streak')).toBeNull();
  });
});
