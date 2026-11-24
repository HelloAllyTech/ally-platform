import { ForbiddenException } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { INSIGHT_LIMITS } from '../../constants/tenant-insight-rules.constants';
import { TenantInsightsService, isoWeekKey } from '../tenant-insights.service';

const TENANT = 'tenant-1';
const USER = 7;
const NOW = new Date('2026-11-24T09:00:00Z');

/** Data that makes several rules fire at once. */
const DATA: Record<string, unknown> = {
  'TSQ-007': {
    total: 40,
    counts: { active: 10, at_risk: 5, dormant: 15, never_started: 10 },
  },
  'TSQ-015': { rows: [{ id: 'c1', title: 'Basics', count: 8 }] },
  'TSQ-016': { rows: [] },
  'TSQ-027': { completedSessions: 40, reviewedSessions: 4 },
  'TSQ-024': { rows: [] },
  'TSQ-026': { count: 20, average: 2.5 },
  'TSQ-002': {
    activeUsers: [2, 3, 4, 5, 6, 9].map((count, i) => ({
      bucket: `w${i}`,
      count,
    })),
  },
  'TSQ-021': { improving: 8, total: 10 },
};

describe('isoWeekKey', () => {
  it.each([
    ['2026-11-24', '2026-W48'],
    ['2026-01-01', '2026-W01'],
    ['2025-12-29', '2026-W01'],
    ['2027-01-03', '2026-W53'],
    ['2024-12-30', '2025-W01'],
  ])('%s is %s', (date, week) => {
    expect(isoWeekKey(new Date(`${date}T12:00:00Z`))).toBe(week);
  });
});

describe('TenantInsightsService', () => {
  let charts: { isEnabled: jest.Mock; getChartData: jest.Mock };
  let state: { hiddenFingerprints: jest.Mock; put: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock };
  let warn: jest.SpyInstance;
  let service: TenantInsightsService;

  beforeEach(() => {
    charts = {
      isEnabled: jest.fn().mockResolvedValue(true),
      getChartData: jest.fn(async (_t: string, id: string) => {
        if (!(id in DATA)) throw new ForbiddenException('not enough data');
        return { id, state: 'available', data: DATA[id] };
      }),
    };
    state = {
      hiddenFingerprints: jest.fn().mockResolvedValue(new Set()),
      put: jest.fn().mockResolvedValue(undefined),
    };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    };
    warn = jest
      .spyOn(LoggerService.prototype, 'warn')
      .mockImplementation(() => undefined);
    service = new TenantInsightsService(
      charts as never,
      state as never,
      redis as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('refuses an organisation the page is off for', async () => {
    charts.isEnabled.mockResolvedValue(false);
    await expect(service.getInsights(TENANT, USER, NOW)).rejects.toThrow(
      ForbiddenException,
    );
    expect(charts.getChartData).not.toHaveBeenCalled();
  });

  it('splits what is found into things to look at and things to celebrate, strongest first', async () => {
    const out = await service.getInsights(TENANT, USER, NOW);
    expect(out.attention.map((f) => f.ruleId)).toEqual(
      expect.arrayContaining([
        'learners.dormant',
        'learners.neverStarted',
        'courses.stalled',
        'reviews.backlog',
        'ratings.low',
      ]),
    );
    expect(out.celebrate.map((f) => f.ruleId).sort()).toEqual([
      'learners.improving',
      'usage.high',
    ]);
    const severities = out.attention.map((f) => f.severity);
    expect(severities).toEqual([...severities].sort((a, b) => b - a));
    out.attention.forEach((f) => expect(f.polarity).toBe('attention'));
  });

  it('names each finding by rule, what it is about and the week, so it comes back next week', async () => {
    const out = await service.getInsights(TENANT, USER, NOW);
    const stalled = out.attention.find((f) => f.ruleId === 'courses.stalled');
    expect(stalled?.fingerprint).toBe('courses.stalled:c1:2026-W48');
    expect(
      out.attention.find((f) => f.ruleId === 'learners.dormant')?.fingerprint,
    ).toBe('learners.dormant:2026-W48');
    const next = await service.getInsights(
      TENANT,
      USER,
      new Date('2026-12-01T09:00:00Z'),
    );
    expect(
      next.attention.find((f) => f.ruleId === 'learners.dormant')?.fingerprint,
    ).toBe('learners.dormant:2026-W49');
  });

  it('carries where "See the chart" goes', async () => {
    const out = await service.getInsights(TENANT, USER, NOW);
    expect(
      out.attention.find((f) => f.ruleId === 'courses.stalled'),
    ).toMatchObject({
      view: 'course',
      chartId: 'TSQ-045',
      filters: { course: 'c1' },
    });
    expect(
      out.attention.find((f) => f.ruleId === 'reviews.backlog'),
    ).toMatchObject({ view: 'organisation', chartId: 'TSQ-027' });
  });

  it('reads each chart once, however many rules read it', async () => {
    await service.getInsights(TENANT, USER, NOW);
    const calls = charts.getChartData.mock.calls.map((c) => c[1]);
    expect(calls.filter((id) => id === 'TSQ-007')).toHaveLength(1);
    expect(new Set(calls).size).toBe(calls.length);
  });

  it('leaves out what the person has put away, and lets the next one in', async () => {
    const all = await service.getInsights(TENANT, USER, NOW);
    const first = all.attention[0].fingerprint;
    state.hiddenFingerprints.mockResolvedValue(new Set([first]));
    const after = await service.getInsights(TENANT, USER, NOW);
    expect(after.attention.map((f) => f.fingerprint)).not.toContain(first);
    expect(state.hiddenFingerprints).toHaveBeenLastCalledWith(
      USER,
      expect.arrayContaining([first]),
    );
  });

  it('shows no more than the limit of each kind', async () => {
    const out = await service.getInsights(TENANT, USER, NOW);
    expect(out.attention.length).toBeLessThanOrEqual(INSIGHT_LIMITS.attention);
    expect(out.celebrate.length).toBeLessThanOrEqual(INSIGHT_LIMITS.celebrate);
  });

  it('keeps the findings for a few minutes, per organisation, and does not read the charts again', async () => {
    await service.getInsights(TENANT, USER, NOW);
    expect(redis.set).toHaveBeenCalledWith(
      `statistics:insights:${TENANT}:2026-W48`,
      expect.any(String),
      expect.any(Number),
    );
    const cached = redis.set.mock.calls[0][1];
    redis.get.mockResolvedValue(cached);
    charts.getChartData.mockClear();
    const again = await service.getInsights(TENANT, USER, NOW);
    expect(charts.getChartData).not.toHaveBeenCalled();
    expect(again.attention.length).toBeGreaterThan(0);
  });

  it('still answers when the cache is down', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));
    redis.set.mockRejectedValue(new Error('redis down'));
    const out = await service.getInsights(TENANT, USER, NOW);
    expect(out.attention.length).toBeGreaterThan(0);
  });

  it('says nothing for a chart the organisation cannot fill, without complaining', async () => {
    delete DATA['TSQ-027'];
    try {
      const out = await service.getInsights(TENANT, USER, NOW);
      expect(out.attention.map((f) => f.ruleId)).not.toContain(
        'reviews.backlog',
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      DATA['TSQ-027'] = { completedSessions: 40, reviewedSessions: 4 };
    }
  });

  it('logs a chart that fails for another reason, and carries on', async () => {
    charts.getChartData.mockImplementation(async (_t: string, id: string) => {
      if (id === 'TSQ-026') throw new Error('query failed');
      return { id, state: 'available', data: DATA[id] };
    });
    const out = await service.getInsights(TENANT, USER, NOW);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('TSQ-026'));
    expect(out.attention.map((f) => f.ruleId)).not.toContain('ratings.low');
    expect(out.attention.map((f) => f.ruleId)).toContain('learners.dormant');
  });

  it('does not let one rule that throws on odd data take the others down', async () => {
    charts.getChartData.mockImplementation(async (_t: string, id: string) => ({
      id,
      state: 'available',
      data: id === 'TSQ-026' ? null : DATA[id],
    }));
    const out = await service.getInsights(TENANT, USER, NOW);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ratings.low'));
    expect(out.attention.map((f) => f.ruleId)).toContain('learners.dormant');
  });

  describe('setState', () => {
    it('marks a finding done for this person', async () => {
      await service.setState(TENANT, USER, 'learners.dormant:2026-W48', 'done');
      expect(state.put).toHaveBeenCalledWith(
        TENANT,
        USER,
        'learners.dormant:2026-W48',
        'done',
        7,
      );
    });

    it('snoozes for the days asked, or a week', async () => {
      await service.setState(TENANT, USER, 'a:2026-W48', 'snoozed', 3);
      expect(state.put).toHaveBeenLastCalledWith(
        TENANT,
        USER,
        'a:2026-W48',
        'snoozed',
        3,
      );
      await service.setState(TENANT, USER, 'a:2026-W48', 'snoozed');
      expect(state.put).toHaveBeenLastCalledWith(
        TENANT,
        USER,
        'a:2026-W48',
        'snoozed',
        7,
      );
    });

    it('refuses an organisation the page is off for', async () => {
      charts.isEnabled.mockResolvedValue(false);
      await expect(
        service.setState(TENANT, USER, 'a:2026-W48', 'done'),
      ).rejects.toThrow(ForbiddenException);
      expect(state.put).not.toHaveBeenCalled();
    });
  });
});
