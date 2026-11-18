import { DebriefMetricsService } from '../service/debrief-metrics.service';

/** Analytics › Debriefs guardrail "Safety recall on the seeded set": the gate's readings. */
describe('safety recall metric', () => {
  const make = (rows: unknown[]) => {
    const query = jest.fn().mockResolvedValue(rows);
    return {
      svc: new DebriefMetricsService({ query } as any, {} as any) as any,
      query,
    };
  };

  it('says not recorded before any gate ran it', async () => {
    const { svc } = make([]);
    await expect(svc.latestSafetyRecall()).resolves.toEqual({
      recorded: false,
    });
  });

  it('reads the latest gate first, with its repetitions, cases and challenger', async () => {
    const { svc, query } = make([
      {
        idea_id: 'i2',
        title: 'Shorter Writer prompt',
        kind: 'prompt_edit',
        release_id: null,
        release_version: null,
        ran_at: '2026-11-12T10:00:00Z',
        safety: {
          passed: false,
          reps: [
            { rep: 1, recall: 1, missed: [] },
            {
              rep: 2,
              recall: 0.94,
              missed: ['en hopelessness: cue at turn 2'],
            },
            { rep: 3, recall: 1, missed: [] },
          ],
          cases: 18,
          planted: 18,
          model: 'gemini-2.5-flash',
        },
      },
      {
        idea_id: 'i1',
        title: 'Release v9',
        kind: 'release',
        release_id: 'r9',
        release_version: 9,
        ran_at: '2026-11-10T10:00:00Z',
        safety: { passed: false, reps: [], error: 'ally-ai is not wired' },
      },
    ]);
    const out = await svc.latestSafetyRecall();
    expect(query.mock.calls[0][0]).toContain(
      "evidence->'gate'->'safetyRecall'",
    );
    expect(out.recorded).toBe(true);
    expect(out.latest).toMatchObject({
      ideaId: 'i2',
      challenger: 'Shorter Writer prompt',
      passed: false,
      cases: 18,
      reps: [
        { rep: 1, recall: 1, missed: 0 },
        { rep: 2, recall: 0.94, missed: 1 },
        { rep: 3, recall: 1, missed: 0 },
      ],
    });
    expect(out.history[1]).toMatchObject({
      releaseVersion: 9,
      error: 'ally-ai is not wired',
    });
  });
});
