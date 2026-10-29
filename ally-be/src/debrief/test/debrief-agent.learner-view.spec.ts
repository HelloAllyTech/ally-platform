import { ForbiddenException } from '@nestjs/common';
import { DebriefAgentService } from '../service/debrief-agent.service';

function build(opts: {
  owner?: number;
  live?: boolean;
  runs?: Array<Record<string, unknown>>;
  endedMinutesAgo?: number;
}) {
  const ended = new Date(Date.now() - (opts.endedMinutesAgo ?? 10) * 60_000);
  const dataSource = {
    query: jest.fn(async () => [
      {
        counselor_id: opts.owner ?? 7,
        tenant_id: 't1',
        status: 'ENDED',
        ended_at: ended,
      },
    ]),
  };
  const runs = { find: jest.fn(async () => opts.runs ?? []) };
  const overrides = {
    get: jest.fn(async () =>
      opts.live === false ? null : { values: { live: true } },
    ),
  };
  return new DebriefAgentService(
    dataSource as any,
    runs as any,
    {} as any,
    {} as any,
    {} as any,
    overrides as any,
    { debriefAgentMode: 'shadow' } as any,
  );
}

describe('DebriefAgentService.learnerView', () => {
  it('refuses anyone but the learner who did the session', async () => {
    await expect(
      build({ owner: 9 }).learnerView('s', 7),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps today’s debrief when the organisation is not switched on', async () => {
    expect(await build({ live: false }).learnerView('s', 7)).toEqual({
      state: 'not_available',
    });
  });

  it('serves a published live debrief, cards only', async () => {
    const view = await build({
      runs: [
        {
          mode: 'live',
          status: 'published',
          cards: { opening: 'x' },
          language: 'hi',
          steps: [],
        },
      ],
    }).learnerView('s', 7);
    expect(view).toEqual({
      state: 'ready',
      cards: { opening: 'x' },
      language: 'hi',
    });
  });

  it('is working only while the drain will still pick the session up', async () => {
    expect((await build({}).learnerView('s', 7)).state).toBe('working');
    expect(
      (await build({ endedMinutesAgo: 60 * 72 }).learnerView('s', 7)).state,
    ).toBe('not_available');
    expect(
      (
        await build({
          runs: [{ mode: 'shadow', status: 'published' }],
        }).learnerView('s', 7)
      ).state,
    ).toBe('not_available');
  });

  it('a run a person must finish reads as on its way', async () => {
    expect(
      (
        await build({
          runs: [{ mode: 'live', status: 'needs_person', steps: [] }],
        }).learnerView('s', 7)
      ).state,
    ).toBe('on_its_way');
  });
});
