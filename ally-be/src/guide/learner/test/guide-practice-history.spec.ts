import {
  GuidePracticeHistoryService,
  learnerFacingDebrief,
} from '../guide-practice-history.service';

describe('learnerFacingDebrief', () => {
  it('reads what the learner was shown, without transcript anchors', () => {
    expect(
      learnerFacingDebrief({
        positives: ['You let the silence sit.'],
        areasOfGrowth: [
          { improvement: 'Reassured early', recommendation: 'Reflect first' },
          { improvement: '', recommendation: 'dropped' },
        ],
        improvements: ['legacy ignored when areasOfGrowth exists'],
        supervisorNote: 'At [[msg:12]] you paused. Good.',
        memoryUpdate: { trajectory: 'never read' },
      }),
    ).toEqual({
      positives: ['You let the silence sit.'],
      growth: [
        { improvement: 'Reassured early', recommendation: 'Reflect first' },
      ],
      note: 'At you paused. Good.',
    });
  });

  it('falls back to the legacy improvements, and survives odd shapes', () => {
    expect(
      learnerFacingDebrief({ improvements: ['Slow down'] }).growth,
    ).toEqual([{ improvement: 'Slow down', recommendation: null }]);
    expect(learnerFacingDebrief(null)).toEqual({
      positives: [],
      growth: [],
      note: null,
    });
    expect(
      learnerFacingDebrief({ positives: 'nope', areasOfGrowth: 3 }),
    ).toEqual({
      positives: [],
      growth: [],
      note: null,
    });
  });
});

describe('GuidePracticeHistoryService', () => {
  it("reads only the learner's own ended sessions on the course's items", async () => {
    const query = jest.fn(async () => [
      {
        id: 's1',
        trackItemId: 'rp',
        endedAt: new Date('2026-10-20T10:00:00Z'),
        score: '71.5',
        feedback: { positives: ['Calm'] },
      },
    ]);
    const service = new GuidePracticeHistoryService({ query } as never);
    const out = await service.recent({ userId: 3, trackItemIds: ['rp'] });
    expect(out).toEqual([
      {
        scenarioSessionId: 's1',
        trackItemId: 'rp',
        endedAt: '2026-10-20T10:00:00.000Z',
        score: 71.5,
        positives: ['Calm'],
        growth: [],
        note: null,
      },
    ]);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/s\."counselorId" = \$1/);
    expect(sql).toMatch(/p\."userId" = \$1/);
    expect(sql).toMatch(/"endedAt" IS NOT NULL/);
    expect(sql).not.toMatch(/sessionMemory|memory_update|supervisor_memory/i);
    expect(params).toEqual([3, ['rp'], 6]);
  });

  it('reads nothing for a course with no practice items', async () => {
    const query = jest.fn();
    const service = new GuidePracticeHistoryService({ query } as never);
    expect(await service.recent({ userId: 3, trackItemIds: [] })).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
