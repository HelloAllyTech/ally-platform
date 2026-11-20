import { DebriefFeedbackService } from '../service/debrief-feedback.service';
import { DebriefCards } from '../util/debrief-cards.util';

const cards = {
  opening: 'Opening.',
  what_worked: [],
  work_on_this: [
    {
      skill: 'a',
      turn_index: 1,
      quote: 'q',
      lead: 'Grow 0',
      why: 'w',
      try_saying: 'Say this',
    },
    {
      skill: 'b',
      turn_index: 2,
      quote: 'q',
      lead: 'Grow 1',
      why: 'w',
      try_saying: 'Say that',
    },
  ],
  practise_next: {
    skill: 'Asking about safety',
    reason: 'It did not come up.',
  },
  skill_words: [],
  reflective_question: 'Q?',
} as unknown as DebriefCards;

function build(rows: any[], removed: string[] = []) {
  const dataSource = { query: jest.fn(async () => rows) };
  const feedback = {
    find: jest.fn(async () => removed.map((section) => ({ section }))),
  };
  return {
    svc: new DebriefFeedbackService(
      dataSource as any,
      {} as any,
      feedback as any,
    ),
    dataSource,
  };
}

describe('latestPoints (Reminders on the roleplay call screen)', () => {
  it('returns nothing when the learner has no live debrief for the roleplay', async () => {
    const { svc } = build([]);
    expect(await svc.latestPoints(5, 7)).toEqual({
      runId: null,
      workOnThis: [],
      practiseNext: null,
    });
  });

  it("asks only for the learner's own live, published debrief of that roleplay", async () => {
    const { svc, dataSource } = build([{ id: 'run-1', cards }]);
    await svc.latestPoints(5, 7);
    const [sql, params] = dataSource.query.mock.calls[0] as unknown as [
      string,
      unknown[],
    ];
    expect(sql).toContain(`s."counselorId" = $1 AND s."scenarioId" = $2`);
    expect(sql).toContain(`r.mode = 'live'`);
    expect(sql).toContain(`'published','below_bar'`);
    expect(params).toEqual([7, 5]);
  });

  it('returns the try-saying lines and the next-practice nudge', async () => {
    const { svc } = build([{ id: 'run-1', cards }]);
    expect(await svc.latestPoints(5, 7)).toEqual({
      runId: 'run-1',
      workOnThis: [
        { lead: 'Grow 0', trySaying: 'Say this' },
        { lead: 'Grow 1', trySaying: 'Say that' },
      ],
      practiseNext: {
        skill: 'Asking about safety',
        reason: 'It did not come up.',
      },
    });
  });

  it('leaves out a point a reviewer removed', async () => {
    const { svc } = build(
      [{ id: 'run-1', cards }],
      ['work_on_this[0]', 'practise_next'],
    );
    expect(await svc.latestPoints(5, 7)).toEqual({
      runId: 'run-1',
      workOnThis: [{ lead: 'Grow 1', trySaying: 'Say that' }],
      practiseNext: null,
    });
  });
});
