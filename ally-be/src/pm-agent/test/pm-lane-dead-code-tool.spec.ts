import { PmLaneToolsService } from '../lane/pm-lane-tools.service';
import { PM_LANES, PmTool } from '../lane/pm-lane-definitions';
import { PmLane, PmSignalStatus } from '../enum/pm-agent.enum';
import { buildDeadCodeSnapshot } from '../util/dead-code-snapshot.util';
import { DEAD_CODE_LIMITS } from '../constants/pm-agent.constants';

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

  it('keeps dead code out of ux_signals_list but leaves UX and security-audit rows in', async () => {
    const { service, find } = build([]);

    await service.execute(PmTool.UX_SIGNALS_LIST, {}, {
      runId: 'run-1',
    } as never);

    const sources = find.mock.calls[0][0].where.source._value;
    expect(sources).toEqual(['ux_signals', 'security_audit']);
    expect(sources).not.toContain('dead_code');
  });
});

/** The 2026-11-26 prod failure: the lane quoted 51 while its evidence listed 21. */
describe('dead-code snapshot: honest counts', () => {
  const mod = (count: number, items: string[]) => ({
    key: 'ally-web/apps/admin/src/constants',
    lastSeenAt: new Date('2026-11-26T00:00:00Z'),
    metrics: { repo: 'ally-web', count, kinds: { export: count }, items },
  });
  const item = (i: number) =>
    `export SOME_LONG_CONSTANT_NAME_${i} in file${i}.ts [knip: import graph]`;

  it('names the module total and the listed items separately, and says so when some are cut', () => {
    const items = Array.from({ length: 40 }, (_, i) => item(i));
    const snap = buildDeadCodeSnapshot(mod(51, items), 100_000);
    expect(snap.totalUnused).toBe(51);
    expect(snap.itemsListed).toBe(40);
    expect(snap.itemsOmitted).toBe(11);
    expect(snap.note).toContain('51 flagged, 40 listed');
  });

  it('drops whole items to fit the budget instead of cutting the JSON, and the counts follow', () => {
    const items = Array.from({ length: 40 }, (_, i) => item(i));
    const snap = buildDeadCodeSnapshot(mod(51, items), 1200);
    expect(JSON.stringify(snap).length).toBeLessThanOrEqual(1200);
    expect(snap.itemsListed).toBeLessThan(40);
    expect(snap.itemsListed).toBe(snap.items.length);
    expect(snap.totalUnused).toBe(51);
    expect(snap.itemsOmitted).toBe(51 - snap.itemsListed);
    expect(() => JSON.parse(JSON.stringify(snap))).not.toThrow();
  });

  it('has no note when every item is listed', () => {
    const snap = buildDeadCodeSnapshot(mod(2, [item(1), item(2)]), 5000);
    expect(snap.itemsOmitted).toBe(0);
    expect(snap.note).toBeUndefined();
  });

  it('never reports a total below the items it lists (old rows with a stale count)', () => {
    const snap = buildDeadCodeSnapshot(
      mod(1, [item(1), item(2), item(3)]),
      5000,
    );
    expect(snap.totalUnused).toBe(3);
  });

  it('copes with a row that has no metrics', () => {
    const snap = buildDeadCodeSnapshot(
      { key: 'x', lastSeenAt: new Date(), metrics: null },
      3000,
    );
    expect(snap.totalUnused).toBe(0);
    expect(snap.items).toEqual([]);
  });

  it('the production-size snapshot fits the budget with real-format items', () => {
    const items = Array.from(
      { length: DEAD_CODE_LIMITS.ITEMS_MAX },
      (_, i) =>
        `file components/deeply/nested/Thing${i}.tsx: no file imports it [knip: import graph]`,
    );
    const snap = buildDeadCodeSnapshot(
      mod(51, items),
      DEAD_CODE_LIMITS.SNAPSHOT_MAX_CHARS,
    );
    expect(JSON.stringify(snap).length).toBeLessThanOrEqual(
      DEAD_CODE_LIMITS.SNAPSHOT_MAX_CHARS,
    );
    expect(snap.itemsListed).toBeGreaterThan(20);
  });
});

describe('dead_code_list tool description', () => {
  it('tells the agent to verify by the method each scanner tag names', async () => {
    const args: unknown[] = new Array(19).fill({});
    const service = new PmLaneToolsService(
      ...(args as ConstructorParameters<typeof PmLaneToolsService>),
    );
    const [tool] = await service.definitions([PmTool.DEAD_CODE_LIST]);
    expect(tool.name).toBe(PmTool.DEAD_CODE_LIST);
    expect(tool.description).toContain('[knip: import graph]');
    expect(tool.description).toContain('[vulture: name match]');
    expect(tool.description).toMatch(/IMPORTS/);
    expect(tool.description).toContain('totalUnused');
    expect(tool.description).toContain('itemsListed');
  });
});
