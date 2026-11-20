import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import { DebriefConsoleViewController } from '../controller/debrief-console-view.controller';
import { DebriefGuidanceMetricsService } from '../service/debrief-guidance-metrics.service';
import { DebriefPmAgentToolsService } from '../service/debrief-pm-agent-tools.service';
import { PM_AGENT_GATEWAY_TOOLS } from '../service/debrief-run-token.service';
import {
  aggregateGuidanceMetrics,
  GuidanceRunFacts,
  parseGuidanceMetricsQuery,
  percentile,
} from '../util/debrief-guidance-metrics.util';

const call = (
  step: string,
  tool: string,
  codes: string[],
  ms: number,
  ok = true,
) => ({ step, tool, args: null, codes_returned: codes, ms, ok, order: 0 });

const planner = (
  actions: string[],
  considered: Array<[string, string]> = [],
) => ({
  step: 'planner',
  kind: 'model',
  ms: 10,
  actions: actions.map((agent) => ({ agent, why: 'x' })),
  considered: considered.map(([agent, why_not]) => ({ agent, why_not })),
});

const runs: GuidanceRunFacts[] = [
  // 1: new fields, both; planner chose the agent
  {
    id: 'r1',
    createdAt: '2026-11-10T08:00:00Z',
    guidanceMode: 'both',
    guidanceTimings: { lookupMs: 100, agentMs: 4000 },
    guidanceCalls: [
      call(
        'guidance_agent',
        'guidance_index',
        ['DG-0001', 'DG-0002', 'DG-0003'],
        20,
      ),
      call('guidance_agent', 'guidance_search', ['DG-0001'], 300),
      call('guidance_agent', 'guidance_fetch', ['DG-0001', 'DG-0002'], 200),
    ],
    guidanceGiven: [
      { code: 'DG-0001', via: 'agent_fetch' },
      { code: 'DG-0002', via: 'agent_fetch' },
    ],
    judge: 9,
    costUsd: '0.30',
    logs: [planner(['guidance_agent'])],
  },
  // 2: lookup only, planner skipped with a reason
  {
    id: 'r2',
    createdAt: '2026-11-10T09:00:00Z',
    guidanceMode: 'lookup',
    guidanceTimings: { lookupMs: 300 },
    guidanceGiven: [{ code: 'DG-0001', via: 'lookup' }],
    judge: 7,
    costUsd: '0.10',
    logs: [planner([], [['guidance_agent', 'Lookup already covers it.']])],
  },
  // 3: agent only (new fields)
  {
    id: 'r3',
    createdAt: '2026-11-11T09:00:00Z',
    guidanceMode: 'agent',
    guidanceTimings: { agentMs: 8000 },
    guidanceCalls: [
      call('guidance_agent', 'guidance_fetch', ['DG-0002'], 150, false),
    ],
    guidanceGiven: [],
    judge: 8,
    costUsd: '0.20',
    logs: [planner([], [['guidance_agent', 'Lookup already covers it.']])],
  },
  // 4: old run, no new fields: fall back to calls + logs; passages give the codes
  {
    id: 'r4',
    createdAt: '2026-11-11T10:00:00Z',
    guidanceCalls: [call('guidance_agent', 'guidance_fetch', ['DG-0003'], 120)],
    passages: [{ id: 'DG-0003' }, { id: 'not-a-code' }],
    judge: null,
    costUsd: null,
    logs: [
      { step: 'guidance_lookup', kind: 'code', ms: 50 },
      { step: 'guidance_agent', kind: 'model', ms: 2000 },
      { step: 'guidance_agent', kind: 'code', ms: 0 },
    ],
  },
  // 5: old run, only the planner's marker for the agent and no lookup: neither
  {
    id: 'r5',
    createdAt: '2026-11-11T11:00:00Z',
    logs: [{ step: 'guidance_agent', kind: 'code', ms: 0 }],
  },
];

const chunks = new Map([
  ['DG-0001', { title: 'Exploring risk', kind: 'skill' }],
  ['DG-0002', { title: 'Closing the call', kind: null }],
]);
const agg = (rs = runs) =>
  aggregateGuidanceMetrics({
    runs: rs,
    from: new Date('2026-10-18T00:00:00Z'),
    to: new Date('2026-11-17T00:00:00Z'),
    days: 30,
    mode: 'all',
    chunks,
  });

describe('guidance metrics aggregation', () => {
  const m = agg();

  it('counts runs by how guidance was reached, with fallback for absent fields', () => {
    expect(m.runs).toEqual({
      total: 5,
      withAgent: 3, // r1, r3, r4 (calls + real log)
      withLookup: 3, // r1, r2, r4 (lookup log)
      agentOnly: 1, // r3
      lookupOnly: 1, // r2
      neither: 1, // r5: a marker is not a run of the agent
    });
    expect(m.window).toEqual({
      from: '2026-10-18T00:00:00.000Z',
      to: '2026-11-17T00:00:00.000Z',
      days: 30,
    });
  });

  it('reads the planner: chose, skipped, and why', () => {
    expect(m.planner).toEqual({
      decided: 3,
      chose: 1,
      skipped: 2,
      skipReasons: [{ why: 'Lookup already covers it.', count: 2 }],
    });
  });

  it('one row per step and tool', () => {
    expect(m.tools).toEqual([
      {
        step: 'guidance_agent',
        tool: 'guidance_fetch',
        calls: 3,
        ok: 2,
        avgMs: 157,
        p90Ms: 200,
        avgCodes: 1.3,
      },
      {
        step: 'guidance_agent',
        tool: 'guidance_index',
        calls: 1,
        ok: 1,
        avgMs: 20,
        p90Ms: 20,
        avgCodes: 3,
      },
      {
        step: 'guidance_agent',
        tool: 'guidance_search',
        calls: 1,
        ok: 1,
        avgMs: 300,
        p90Ms: 300,
        avgCodes: 1,
      },
    ]);
  });

  it('entries: titles from the library, given vs fetched, index lists never count as fetched', () => {
    expect(m.entries).toEqual([
      {
        code: 'DG-0001',
        title: 'Exploring risk',
        kind: 'skill',
        fetched: 1,
        given: 2,
        runs: 2,
      },
      {
        code: 'DG-0002',
        title: 'Closing the call',
        kind: null,
        fetched: 2,
        given: 1,
        runs: 2,
      },
      {
        code: 'DG-0003',
        title: 'DG-0003',
        kind: null,
        fetched: 1,
        given: 1,
        runs: 1,
      },
    ]);
  });

  it('latency from timings first, then logs', () => {
    expect(m.latency.lookup).toEqual({ n: 3, p50Ms: 100, p90Ms: 300 });
    expect(m.latency.agent).toEqual({ n: 3, p50Ms: 4000, p90Ms: 8000 });
  });

  it('compares runs with and without the agent; null when nothing to average', () => {
    expect(m.compare.withAgent).toEqual({
      n: 3,
      avgJudge: 8.5,
      avgCostUsd: 0.25,
    });
    expect(m.compare.withoutAgent).toEqual({
      n: 2,
      avgJudge: 7,
      avgCostUsd: 0.1,
    });
    expect(agg([]).compare.withAgent).toEqual({
      n: 0,
      avgJudge: null,
      avgCostUsd: null,
    });
  });

  it('daily rows', () => {
    expect(m.daily).toEqual([
      {
        date: '2026-11-10',
        runs: 2,
        withAgent: 1,
        avgLookupMs: 200,
        avgAgentMs: 4000,
      },
      {
        date: '2026-11-11',
        runs: 3,
        withAgent: 2,
        avgLookupMs: 50,
        avgAgentMs: 5000,
      },
    ]);
  });

  it('carries no learner text: only aggregate keys', () => {
    const json = JSON.stringify(
      aggregateGuidanceMetrics({
        runs: [
          {
            id: 'x',
            createdAt: '2026-11-10T00:00:00Z',
            logs: [planner([], [['guidance_agent', 'a '.repeat(300)]])],
          },
        ],
        from: new Date(),
        to: new Date(),
        days: 1,
        mode: 'all',
      }),
    );
    expect(json).not.toMatch(/"id":"x"/);
    expect(m.planner.skipReasons.every((r) => r.why.length <= 200)).toBe(true);
    expect(
      agg([
        {
          id: 'x',
          createdAt: '2026-11-10T00:00:00Z',
          logs: [planner([], [['guidance_agent', 'a '.repeat(300)]])],
        },
      ]).planner.skipReasons[0].why.length,
    ).toBeLessThanOrEqual(200);
  });
});

describe('percentile and query parsing', () => {
  it('nearest rank', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([5], 90)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([10, 1, 2, 3, 4, 5, 6, 7, 8, 9], 90)).toBe(9);
  });
  it('days 1-90 default 30; mode all|live|shadow', () => {
    expect(parseGuidanceMetricsQuery({})).toEqual({ days: 30, mode: 'all' });
    expect(parseGuidanceMetricsQuery({ days: '90', mode: 'shadow' })).toEqual({
      days: 90,
      mode: 'shadow',
    });
    expect(parseGuidanceMetricsQuery({ days: '91', mode: 'replay' })).toEqual({
      days: 30,
      mode: 'all',
    });
    expect(parseGuidanceMetricsQuery({ days: '0' }).days).toBe(30);
  });
});

describe('guidance metrics service: window and mode filters', () => {
  it('queries live+shadow for all, one mode otherwise, from the window start, then titles', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'r1',
          createdAt: new Date(),
          guidance_mode: 'agent',
          guidance_calls: [
            call('guidance_agent', 'guidance_fetch', ['DG-0001'], 5),
          ],
          guidance_given: [{ code: 'DG-0001' }],
          evaluator_overall: '8.50',
          cost: '0.2',
        },
      ])
      .mockResolvedValueOnce([
        {
          run_id: 'r1',
          step: 'planner',
          kind: 'model',
          ms: 1,
          actions: [{ agent: 'guidance_agent' }],
          considered: null,
        },
      ])
      .mockResolvedValueOnce([
        { code: 'DG-0001', title: '  Exploring   risk ', kind: 'skill' },
      ]);
    const svc = new DebriefGuidanceMetricsService({ query } as any);
    const out = await svc.report({ days: '7', mode: 'live' });
    expect(query.mock.calls[0][1][1]).toEqual(['live']);
    const from = query.mock.calls[0][1][0] as Date;
    expect(Date.now() - from.getTime()).toBeGreaterThan(6.9 * 86_400_000);
    expect(Date.now() - from.getTime()).toBeLessThan(7.1 * 86_400_000);
    expect(out.window.days).toBe(7);
    expect(out.mode).toBe('live');
    expect(out.planner.chose).toBe(1);
    expect(out.compare.withAgent.avgJudge).toBe(8.5);
    expect(out.entries[0]).toMatchObject({
      code: 'DG-0001',
      title: 'Exploring risk',
      kind: 'skill',
      given: 1,
    });

    query.mockReset().mockResolvedValue([]);
    await svc.report({});
    expect(query.mock.calls[0][1][1]).toEqual(['live', 'shadow']);
    expect(query).toHaveBeenCalledTimes(1); // no runs: no further reads
  });
});

describe('guidance metrics permission', () => {
  const ctx = (): ExecutionContext =>
    ({
      getHandler: () =>
        DebriefConsoleViewController.prototype.guidanceMetricsView,
      getClass: () => DebriefConsoleViewController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 1 }, method: 'GET', url: '/x' }),
      }),
    }) as any;
  const guard = (perms: string[]) =>
    new PermissionsGuard(new Reflector(), {
      getUserPermissions: jest.fn(async () => perms),
    } as any);

  it('is behind the same read permission as the other metrics routes', async () => {
    const other = (h: string) =>
      Reflect.getMetadata(
        'permissions',
        (DebriefConsoleViewController.prototype as any)[h],
      );
    const mine = Reflect.getMetadata(
      'permissions',
      DebriefConsoleViewController.prototype.guidanceMetricsView,
    );
    expect(mine).toBeDefined();
    expect(mine).toEqual(other('metricsView'));
    await expect(
      guard(['view:admin:analytics']).canActivate(ctx()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await guard([PERMISSIONS.SYSTEM_ACCESS]).canActivate(ctx())).toBe(
      true,
    );
  });

  it('passes days and mode to the service', () => {
    const report = jest.fn(() => 'ok');
    const c = Object.create(DebriefConsoleViewController.prototype);
    c.guidanceMetrics = { report };
    expect(c.guidanceMetricsView('14', 'shadow')).toBe('ok');
    expect(report).toHaveBeenCalledWith({ days: '14', mode: 'shadow' });
  });
});

describe('PM agent tool guidance_report', () => {
  it('is a gateway tool and returns the report with days and mode', async () => {
    expect(PM_AGENT_GATEWAY_TOOLS).toContain('guidance_report');
    const report = jest.fn(async () => ({ runs: { total: 1 } }));
    const svc = new DebriefPmAgentToolsService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      { report } as any,
    );
    const claims = {
      kind: 'agent' as const,
      agent: 'pm_agent' as const,
      agentRunId: 'r',
      tools: ['guidance_report'],
      exp: 0,
    };
    expect(
      await svc.call('guidance_report', claims, { days: 14, mode: 'live' }),
    ).toEqual({ runs: { total: 1 } });
    expect(report).toHaveBeenCalledWith({ days: 14, mode: 'live' });
  });

  it('refuses (never throws) when analytics are unavailable', async () => {
    const pm = { audit: jest.fn(async () => undefined) };
    const svc = new DebriefPmAgentToolsService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      pm as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const claims = {
      kind: 'agent' as const,
      agent: 'pm_agent' as const,
      agentRunId: 'r',
      tools: [],
      exp: 0,
    };
    expect(await svc.call('guidance_report', claims, {})).toEqual({
      refused: 'guidance analytics are not available',
    });
  });
});
