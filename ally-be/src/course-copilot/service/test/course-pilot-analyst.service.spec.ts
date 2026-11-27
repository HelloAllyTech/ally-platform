import { CoursePilotAnalystService } from '../course-pilot-analyst.service';

const results = (over: any = {}) => ({
  trackId: 't1',
  enrolled: 10,
  started: 10,
  completed: 9,
  medianDaysToComplete: 2,
  withheld: 0,
  items: [
    {
      itemId: 'r1',
      section: 1,
      type: 'ROLEPLAY',
      title: 'Jamie',
      reached: 10,
      completed: 9,
      completionPct: 90,
      avgAttempts: 1.2,
      avgScore: 80,
      medianMinutes: 8,
      notes: [],
    },
  ],
  ...over,
});

const setup = (data: any, analyst?: any) => {
  const learnerResults = {
    forCourse: jest.fn().mockResolvedValue(data),
    render: jest.fn().mockReturnValue('rendered results'),
  };
  const dataSource = { query: jest.fn().mockResolvedValue([{ seq: 42 }]) };
  const service = new CoursePilotAnalystService(
    dataSource as any,
    learnerResults as any,
    analyst,
  );
  return { service, learnerResults };
};

const session: any = { id: 's1', trackId: 't1', tenantId: 'org-1' };

describe('CoursePilotAnalystService', () => {
  it("reads the session's organisation only, and measures nothing below five learners", async () => {
    const analyst = { analyse: jest.fn() };
    const { service, learnerResults } = setup(
      results({ enrolled: 3, completed: 1 }),
      analyst,
    );
    const record = await service.analyse(session, 'outline');
    expect(learnerResults.forCourse).toHaveBeenCalledWith('t1', 'org-1');
    expect(record).toMatchObject({
      enough: false,
      learners: 3,
      afterSeq: 42,
      suggestions: [],
    });
    expect(record.summary).toContain('Not enough learners yet: 3 enrolled');
    expect(analyst.analyse).not.toHaveBeenCalled();
  });

  it('calls no model when nothing stands out', async () => {
    const analyst = { analyse: jest.fn() };
    const { service } = setup(results(), analyst);
    const record = await service.analyse(session, 'outline');
    expect(record.signals).toEqual([]);
    expect(record.summary).toBe(
      '9 of 10 learners finished; no item stands out.',
    );
    expect(analyst.analyse).not.toHaveBeenCalled();
  });

  it('asks the Analyst about the signals, with the rendered results', async () => {
    const analyst = {
      analyse: jest.fn().mockResolvedValue({
        summary: 'Jamie stalls learners.',
        suggestions: [
          {
            itemId: 'r1',
            signal: 's',
            cause: 'c',
            change: 'Lower the pass mark.',
            kind: 'rule',
          },
        ],
      }),
    };
    const stalled = results({
      completed: 3,
      items: [{ ...results().items[0], completed: 4, completionPct: 40 }],
    });
    const { service } = setup(stalled, analyst);
    const record = await service.analyse(session, 'outline');
    expect(analyst.analyse).toHaveBeenCalledWith(
      expect.objectContaining({
        outline: 'outline',
        results: 'rendered results',
        itemIds: ['r1'],
      }),
    );
    expect(record.signals.map((s) => s.kind)).toEqual([
      'low_completion',
      'stall',
    ]);
    expect(record.suggestions).toHaveLength(1);
    expect(record.summary).toBe('Jamie stalls learners.');
  });

  it('keeps the signals when the Analyst fails', async () => {
    const analyst = { analyse: jest.fn().mockRejectedValue(new Error('down')) };
    const { service } = setup(results({ completed: 2 }), analyst);
    const record = await service.analyse(session, 'outline');
    expect(record).toMatchObject({
      enough: true,
      error: 'down',
      suggestions: [],
    });
    expect(record.signals).toHaveLength(1);
  });
});
