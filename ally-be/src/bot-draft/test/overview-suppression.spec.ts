import {
  looksIdentifying,
  safeCount,
  suppressBreakdown,
  topUnanswered,
} from '../scorecard/overview-suppression';

const asked = (text: string, people: number, reason = 'no_hits') =>
  Array.from({ length: people }, (_, i) => ({
    text,
    contactId: `c-${text}-${i}`,
    reason,
  }));

describe('Overview small-number rule (D8)', () => {
  it('shows 0 and 5+ plainly, and 1 to 4 as fewer than 5', () => {
    expect(safeCount(0)).toBe(0);
    expect(safeCount(1)).toEqual({ lessThan: 5 });
    expect(safeCount(4)).toEqual({ lessThan: 5 });
    expect(safeCount(5)).toBe(5);
  });

  it('suppresses breakdown groups under five, keeps the rest', () => {
    expect(
      suppressBreakdown([
        { key: 'hi', count: 2 },
        { key: 'en', count: 40 },
        { key: 'ta', count: 5 },
      ]),
    ).toEqual([
      { key: 'en', count: 40 },
      { key: 'ta', count: 5 },
      { key: 'hi', count: { lessThan: 5 } },
    ]);
  });

  it('quotes a question only when five different people asked it', () => {
    const out = topUnanswered([
      ...asked('Do you open on Sunday?', 5),
      ...asked('Is parking free?', 4),
    ]);
    expect(out).toEqual([
      { kind: 'question', text: 'Do you open on Sunday?', count: 5 },
      { kind: 'theme', theme: 'no_hits', count: { lessThan: 5 } },
    ]);
    expect(JSON.stringify(out)).not.toContain('parking');
  });

  it('five repeats by one person are not five people', () => {
    const rows = Array.from({ length: 5 }, () => ({
      text: 'Is it safe for my son Arjun?',
      contactId: 'same',
      reason: 'no_hits',
    }));
    expect(topUnanswered(rows)).toEqual([
      { kind: 'theme', theme: 'no_hits', count: { lessThan: 5 } },
    ]);
  });

  it('never quotes a message with a phone number, email or link, even from many people', () => {
    expect(looksIdentifying('call me on 98765 43210')).toBe(true);
    expect(looksIdentifying('write to a.b@example.com')).toBe(true);
    expect(looksIdentifying('see https://x.example/p')).toBe(true);
    expect(looksIdentifying('Do you open on Sunday?')).toBe(false);
    const out = topUnanswered(asked('Call me on 98765 43210', 6));
    expect(out).toEqual([{ kind: 'theme', theme: 'no_hits', count: 6 }]);
  });

  it('matches the same question across case and punctuation', () => {
    const rows = [
      ...asked('Do you open Sunday?', 3),
      ...asked('do you  open sunday', 2),
    ].map((r, i) => ({ ...r, contactId: `p${i}` }));
    expect(topUnanswered(rows)[0]).toMatchObject({
      kind: 'question',
      count: 5,
    });
  });
});
