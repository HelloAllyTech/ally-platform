import { extractWikilinks, isValidSlug } from '../util/manual-slug.util';
import { istMonthStart, nextWeeklyRunAt } from '../util/manual-time.util';
import { parseLimit } from '../util/manual-http.util';

describe('slug rules', () => {
  it.each(['a', 'running-a-roleplay', 'step-2', '2024-plan', 'a'.repeat(120)])(
    'accepts %s',
    (slug) => expect(isValidSlug(slug)).toBe(true),
  );
  it.each([
    '',
    'Upper',
    'two--hyphens',
    '-lead',
    'trail-',
    'has space',
    'under_score',
    'a'.repeat(121),
    '../etc',
    null,
    undefined,
    42,
  ])('rejects %p', (slug) => expect(isValidSlug(slug)).toBe(false));
});

describe('extractWikilinks', () => {
  it('finds [[slug]] and [[slug|label]], deduplicated in first-seen order', () => {
    const body =
      'See [[running-a-roleplay]] and [[roles|who can do what]]; again [[running-a-roleplay]].';
    expect(extractWikilinks(body)).toEqual(['running-a-roleplay', 'roles']);
  });

  it('ignores anything that is not a valid slug link', () => {
    expect(
      extractWikilinks('[[Some Title]] [[UPPER]] [[ok-slug ]] [x] [[]] [[a|b'),
    ).toEqual([]);
  });

  it('finds links across lines and inside markdown', () => {
    expect(extractWikilinks('- [[a]]\n- **[[b-1|B]]**\n`[[c]]`')).toEqual([
      'a',
      'b-1',
      'c',
    ]);
  });

  it('is safe on empty input', () => {
    expect(extractWikilinks('')).toEqual([]);
  });
});

describe('time helpers', () => {
  it('istMonthStart is midnight IST on the 1st, as UTC', () => {
    // 2026-11-30 19:00 UTC is already 1 Dec 00:30 IST.
    expect(istMonthStart(new Date('2026-11-30T19:00:00Z')).toISOString()).toBe(
      '2026-11-30T18:30:00.000Z',
    );
    expect(istMonthStart(new Date('2026-11-15T10:00:00Z')).toISOString()).toBe(
      '2026-10-31T18:30:00.000Z',
    );
  });

  it('nextWeeklyRunAt is the next Monday 02:00 UTC, strictly after now', () => {
    // 2026-11-23 is a Monday.
    expect(
      nextWeeklyRunAt(new Date('2026-11-23T01:00:00Z')).toISOString(),
    ).toBe('2026-11-23T02:00:00.000Z');
    expect(
      nextWeeklyRunAt(new Date('2026-11-23T02:00:00Z')).toISOString(),
    ).toBe('2026-11-30T02:00:00.000Z');
    expect(
      nextWeeklyRunAt(new Date('2026-11-26T12:00:00Z')).toISOString(),
    ).toBe('2026-11-30T02:00:00.000Z');
    expect(
      nextWeeklyRunAt(new Date('2026-11-29T23:59:00Z')).toISOString(),
    ).toBe('2026-11-30T02:00:00.000Z');
  });

  it('parseLimit clamps and falls back', () => {
    expect(parseLimit(undefined, 30, 100)).toBe(30);
    expect(parseLimit('abc', 30, 100)).toBe(30);
    expect(parseLimit('0', 30, 100)).toBe(30);
    expect(parseLimit('500', 30, 100)).toBe(100);
    expect(parseLimit('7', 30, 100)).toBe(7);
  });
});
