import { PmLaneToolsService } from '../lane/pm-lane-tools.service';
import { PM_LANES, PmTool } from '../lane/pm-lane-definitions';
import { PmLane, PmSignalStatus } from '../enum/pm-agent.enum';

const row = (key: string, count: number) => ({
  id: `id-${key}`,
  key,
  detector: 'dead_code_scan',
  metrics: {
    repo: 'ally-ai',
    count,
    kinds: { function: count },
    items: ['function f'],
  },
  lastSeenAt: new Date(),
});

/** The code_health lane's dead_code_list tool: fresh, undecided modules only, biggest first. */
describe('dead_code_list lane tool', () => {
  const build = (rows: unknown[]) => {
    const find = jest.fn().mockResolvedValue(rows);
    const args: unknown[] = new Array(19).fill({});
    args[2] = { find };
    const service = new PmLaneToolsService(
      ...(args as ConstructorParameters<typeof PmLaneToolsService>),
    );
    const record = jest.fn(
      async (_run: string, e: { source: string; label: string }) => ({
        id: `ev-${e.label}`,
        source: e.source,
        label: e.label,
      }),
    );
    (service as unknown as { record: typeof record }).record = record;
    return { service, find, record };
  };

  it('is given to the code_health lane only', () => {
    expect(PM_LANES[PmLane.CODE_HEALTH].tools).toContain(PmTool.DEAD_CODE_LIST);
    for (const lane of Object.values(PM_LANES)) {
      if (lane.lane !== PmLane.CODE_HEALTH)
        expect(lane.tools).not.toContain(PmTool.DEAD_CODE_LIST);
    }
  });

  it('asks only for new, recent dead_code rows and cites the biggest module first', async () => {
    const { service, find, record } = build([
      row('ally-ai/app/a', 2),
      row('ally-ai/app/b', 9),
    ]);

    const out = await service.execute(PmTool.DEAD_CODE_LIST, {}, {
      runId: 'run-1',
    } as never);

    const where = find.mock.calls[0][0].where;
    expect(where.source).toBe('dead_code');
    expect(where.status).toBe(PmSignalStatus.NEW);
    expect(where.lastSeenAt).toBeDefined();
    expect(out.ok).toBe(true);
    expect(out.evidence.map((e) => e.label)).toEqual([
      'Dead code: ally-ai/app/b',
      'Dead code: ally-ai/app/a',
    ]);
    expect(record.mock.calls[0][1].source).toBe('dead_code');
  });

  it('says there is nothing to cite when no report is fresh', async () => {
    const { service } = build([]);
    const out = await service.execute(PmTool.DEAD_CODE_LIST, {}, {
      runId: 'run-1',
    } as never);
    expect(out.evidence).toEqual([]);
    expect(out.modelResult).toContain('nothing to cite');
  });
});
