import { partnerScoreboard } from '../builder-partner-metrics.service';

/** Every number on the partner scoreboard is defined here, once. */
describe('partnerScoreboard', () => {
  const at = (minutes: number) =>
    new Date(Date.parse('2026-10-20T10:00:00Z') + minutes * 60_000);
  const row = (over: Record<string, any> = {}): any => ({
    entryType: 'decision',
    kind: 'question',
    questionType: 'behaviour',
    surface: 'now',
    client: 'desktop',
    oneWay: false,
    matchedRecommendation: true,
    waitSeconds: 600,
    msToDecide: 4000,
    undoneAt: null,
    raisedAt: at(-10),
    decidedAt: at(0),
    ...over,
  });

  it('leaves undone and rule-decided answers out of everything but their own counts', () => {
    const board = partnerScoreboard(
      [
        row(),
        row({ undoneAt: at(1), decidedAt: at(1) }),
        row({ surface: 'rule', decidedAt: at(2) }),
      ],
      [],
      30,
    );
    expect(board.decisions).toBe(1);
    expect(board.caution).toMatchObject({ undone: 1, answered: 2 });
    expect(board.decidedByRules).toBe(1);
    expect(board.waitingOnYou.totalMinutes).toBe(10);
  });

  it('counts a hasty one-way decision as a caution, not a win', () => {
    const board = partnerScoreboard(
      [
        row({
          oneWay: true,
          msToDecide: 900,
          kind: 'pr_merge',
          matchedRecommendation: null,
        }),
        row({
          oneWay: true,
          msToDecide: 9000,
          kind: 'pr_merge',
          matchedRecommendation: null,
        }),
      ],
      [],
      30,
    );
    expect(board.caution).toMatchObject({ hastyOneWay: 1, oneWay: 2 });
    expect(board.agreement).toEqual([]);
  });

  it('counts an answer a rule already covered as asked twice', () => {
    const board = partnerScoreboard(
      [row({ kind: 'budget', questionType: null })],
      [
        {
          match: { kind: 'budget', optionId: 'raise_10' },
          createdAt: at(-60),
        } as any,
      ],
      30,
    );
    expect(board.askedTwice).toEqual({ count: 1, ofDecisions: 1 });
  });

  it('splits sittings on a 15 minute gap for pace', () => {
    const board = partnerScoreboard(
      [
        row({ decidedAt: at(0) }),
        row({ decidedAt: at(5) }),
        row({ decidedAt: at(60) }),
      ],
      [],
      30,
    );
    // 5 minutes, then a lone answer counted as one minute.
    expect(board.pace.sittingMinutes).toBe(6);
    expect(board.pace.perHour).toBe(30);
  });
});
