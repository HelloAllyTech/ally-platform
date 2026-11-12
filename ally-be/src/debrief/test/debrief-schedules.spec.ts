import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureToggleGuard } from 'src/auth/guards/feature-toggle.guard';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import {
  DEBRIEF_SCHEDULE_JOBS,
  scheduleJob,
} from '../constants/debrief-schedule.constants';
import { DebriefSchedulesController } from '../controller/debrief-schedules.controller';
import { DebriefScheduleService } from '../service/debrief-schedule.service';
import {
  applyScheduleChange,
  monthlySpendUsd,
  nextRunAt,
} from '../util/debrief-schedule.util';

const utc = (s: string) => new Date(s);

describe('debrief schedules: when a job is next due (India time)', () => {
  it('daily: today at the time if still ahead, else tomorrow', () => {
    const s = {
      frequency: 'daily' as const,
      time: '05:35',
      weekday: null,
      monthDay: null,
    };
    // 2026-11-12 00:00 UTC = 05:30 IST → 05:35 IST today = 00:05 UTC
    expect(nextRunAt(s, utc('2026-11-12T00:00:00Z')).toISOString()).toBe(
      '2026-11-12T00:05:00.000Z',
    );
    expect(nextRunAt(s, utc('2026-11-12T00:05:00Z')).toISOString()).toBe(
      '2026-11-13T00:05:00.000Z',
    );
  });

  it('daily: the IST day, not the UTC day (20:00 UTC is already tomorrow in India)', () => {
    const s = {
      frequency: 'daily' as const,
      time: '03:00',
      weekday: null,
      monthDay: null,
    };
    // 2026-11-12 20:00 UTC = 13 Nov 01:30 IST → 13 Nov 03:00 IST = 12 Nov 21:30 UTC
    expect(nextRunAt(s, utc('2026-11-12T20:00:00Z')).toISOString()).toBe(
      '2026-11-12T21:30:00.000Z',
    );
  });

  it('weekly: the next chosen weekday at the time', () => {
    const s = {
      frequency: 'weekly' as const,
      time: '07:30',
      weekday: 1,
      monthDay: null,
    };
    // Thu 12 Nov 2026 → Mon 16 Nov 07:30 IST = 02:00 UTC
    expect(nextRunAt(s, utc('2026-11-12T10:00:00Z')).toISOString()).toBe(
      '2026-11-16T02:00:00.000Z',
    );
    // Monday after the time → the Monday after
    expect(nextRunAt(s, utc('2026-11-16T02:00:00Z')).toISOString()).toBe(
      '2026-11-23T02:00:00.000Z',
    );
  });

  it('every 2 weeks: skips a week when the last run was under 13 days before', () => {
    const s = {
      frequency: '2weeks' as const,
      time: '07:30',
      weekday: 1,
      monthDay: null,
    };
    const last = utc('2026-11-16T02:00:00Z');
    expect(nextRunAt(s, last, last).toISOString()).toBe(
      '2026-11-30T02:00:00.000Z',
    );
    expect(nextRunAt(s, utc('2026-11-12T10:00:00Z'), null).toISOString()).toBe(
      '2026-11-16T02:00:00.000Z',
    );
  });

  it('monthly: the chosen day this month if ahead, else next month (rolls the year)', () => {
    const s = {
      frequency: 'monthly' as const,
      time: '08:30',
      weekday: null,
      monthDay: 1,
    };
    expect(nextRunAt(s, utc('2026-11-12T10:00:00Z')).toISOString()).toBe(
      '2026-12-01T03:00:00.000Z',
    );
    expect(nextRunAt(s, utc('2026-12-01T03:00:00Z')).toISOString()).toBe(
      '2027-01-01T03:00:00.000Z',
    );
    expect(
      nextRunAt(
        { ...s, monthDay: 15 },
        utc('2026-11-12T10:00:00Z'),
      ).toISOString(),
    ).toBe('2026-11-15T03:00:00.000Z');
  });

  it('intervals line up on clock boundaries', () => {
    const at = utc('2026-11-12T10:07:12Z');
    const f = (frequency: any) =>
      nextRunAt(
        { frequency, time: null, weekday: null, monthDay: null },
        at,
      ).toISOString();
    expect(f('1min')).toBe('2026-11-12T10:08:00.000Z');
    expect(f('5min')).toBe('2026-11-12T10:10:00.000Z');
    expect(f('30min')).toBe('2026-11-12T10:30:00.000Z');
    // every hour on the hour India time = :30 UTC
    expect(f('60min')).toBe('2026-11-12T10:30:00.000Z');
  });
});

describe('debrief schedules: defaults are the old @Cron ticks', () => {
  // Old ticks (UTC): 5min, 30min, daily 00:05, weekly Mon 02:00, monthly 1st 03:00.
  const after = utc('2026-11-12T10:07:00Z'); // a Thursday
  const due = (key: string) =>
    nextRunAt(scheduleJob(key)!.defaults, after).toISOString();

  it('every job is on, with the frequency and time it had', () => {
    expect(DEBRIEF_SCHEDULE_JOBS.every((j) => j.defaults.enabled)).toBe(true);
    expect(due('debrief-agent-drain')).toBe('2026-11-12T10:10:00.000Z');
    expect(due('debrief-stuck-sweep')).toBe('2026-11-12T10:10:00.000Z');
    expect(due('debrief-console-alerts')).toBe('2026-11-12T10:30:00.000Z');
    for (const k of [
      'debrief-cost-reconcile',
      'debrief-pm-agent-expiry',
      'debrief-autonomy-relock',
      'debrief-pm-agent-forecasts',
    ])
      expect(due(k)).toBe('2026-11-13T00:05:00.000Z');
    expect(due('debrief-pm-agent')).toBe('2026-11-16T02:00:00.000Z');
    expect(due('debrief-pm-agent-review')).toBe('2026-12-01T03:00:00.000Z');
    expect(due('debrief-baseline')).toBe('2026-12-01T03:00:00.000Z');
  });
});

describe('debrief schedules: what a change may do', () => {
  const drain = scheduleJob('debrief-agent-drain')!;
  const alerts = scheduleJob('debrief-console-alerts')!;

  it('a job that keeps debriefs flowing cannot be switched off', () => {
    const r = applyScheduleChange(drain, drain.defaults, { enabled: false });
    expect('refusal' in r && r.refusal).toMatch(/cannot be switched off/);
  });

  it('…and only takes its safe frequencies', () => {
    expect(
      'refusal' in
        applyScheduleChange(drain, drain.defaults, { frequency: '30min' }),
    ).toBe(true);
    expect(
      'refusal' in
        applyScheduleChange(alerts, alerts.defaults, { frequency: '5min' }),
    ).toBe(true);
    const ok = applyScheduleChange(drain, drain.defaults, {
      frequency: '1min',
    });
    expect('schedule' in ok && ok.schedule.frequency).toBe('1min');
  });

  it('switching to weekly fills a weekday and time; to an interval clears them', () => {
    const pm = scheduleJob('debrief-pm-agent')!;
    const daily = applyScheduleChange(pm, pm.defaults, { frequency: 'daily' });
    expect('schedule' in daily && daily.schedule).toMatchObject({
      weekday: null,
      time: '07:30',
    });
    const recon = scheduleJob('debrief-cost-reconcile')!;
    const hourly = applyScheduleChange(recon, recon.defaults, {
      frequency: '60min',
    });
    expect('schedule' in hourly && hourly.schedule).toMatchObject({
      time: null,
      weekday: null,
    });
  });

  it('monthly spend scales with runs a month', () => {
    expect(monthlySpendUsd('weekly', true, 0.84)).toBe(3.6);
    expect(monthlySpendUsd('daily', true, 0.84)).toBe(25.2);
    expect(monthlySpendUsd('daily', false, 0.84)).toBe(0);
  });
});

/** A DataSource fake: schedules and runs in memory, advisory locks per key. */
function fakeDb() {
  const schedules = new Map<string, any>();
  const runs: any[] = [];
  const locks = new Set<string>();
  let n = 0;
  const query = jest.fn(async (sql: string, p: any[] = []) => {
    if (sql.startsWith('SELECT * FROM debrief_schedules WHERE'))
      return [schedules.get(p[0])].filter(Boolean);
    if (sql.startsWith('SELECT * FROM debrief_schedules'))
      return [...schedules.values()];
    if (sql.includes('INSERT INTO debrief_schedules')) {
      const row = {
        key: p[0],
        frequency: p[1],
        time: p[2],
        weekday: p[3],
        monthDay: p[4],
        enabled: p[5],
        nextRunAt: p[6],
        lastRunAt: null,
      };
      schedules.set(p[0], row);
      return [row];
    }
    if (sql.includes('UPDATE debrief_schedules SET "lastRunAt"')) {
      Object.assign(schedules.get(p[0]), { lastRunAt: p[1], nextRunAt: p[2] });
      return [];
    }
    if (sql.includes('UPDATE debrief_schedules')) {
      Object.assign(schedules.get(p[0]), {
        frequency: p[1],
        time: p[2],
        weekday: p[3],
        monthDay: p[4],
        enabled: p[5],
        nextRunAt: p[6],
        updatedBy: p[7],
      });
      return [];
    }
    if (sql.includes('pg_try_advisory_lock')) {
      const k = `${p[0]}:${p[1]}`;
      if (locks.has(k)) return [{ locked: false }];
      locks.add(k);
      return [{ locked: true }];
    }
    if (sql.includes('pg_advisory_unlock')) {
      locks.delete(`${p[0]}:${p[1]}`);
      return [];
    }
    if (sql.includes('INSERT INTO debrief_schedule_runs')) {
      const row = sql.includes("'config_change'")
        ? {
            id: `run-${++n}`,
            jobKey: p[0],
            trigger: 'config_change',
            triggeredBy: p[1],
            change: p[2],
            result: 'ok',
          }
        : {
            id: `run-${++n}`,
            jobKey: p[0],
            trigger: 'schedule',
            triggeredBy: null,
            result: 'running',
          };
      runs.push(row);
      return [row];
    }
    if (sql.includes("SET result = 'ok'")) {
      Object.assign(
        runs.find((r) => r.id === p[0]),
        { result: 'ok', durationMs: p[1], summary: p[2] },
      );
      return [];
    }
    if (sql.includes("SET result = 'failed'")) {
      Object.assign(
        runs.find((r) => r.id === p[0]),
        { result: 'failed', durationMs: p[1], error: p[2] },
      );
      return [];
    }
    if (sql.includes('agent_lesson_audit')) return [{ avg: '0.84' }];
    if (sql.includes('pg_locks')) return [];
    if (sql.includes('DISTINCT ON')) return [];
    return [];
  });
  const dataSource = {
    query,
    createQueryRunner: () => ({
      connect: jest.fn(),
      release: jest.fn(),
      query,
    }),
  };
  return { dataSource, schedules, runs, locks };
}

describe('DebriefScheduleService', () => {
  const now = utc('2026-11-12T10:07:00Z');
  let db: ReturnType<typeof fakeDb>;
  let svc: DebriefScheduleService;
  const handlers: Record<string, jest.Mock> = {};

  beforeEach(() => {
    db = fakeDb();
    svc = new DebriefScheduleService(db.dataSource as any);
    for (const j of DEBRIEF_SCHEDULE_JOBS) {
      handlers[j.key] = jest.fn().mockResolvedValue(`${j.key} done`);
      scheduledTaskRegistry.registerConfigurable(j.key, handlers[j.key]);
    }
  });

  it('first read stores every job at its default', async () => {
    await svc.rows(now);
    expect(db.schedules.size).toBe(DEBRIEF_SCHEDULE_JOBS.length);
    expect(db.schedules.get('debrief-pm-agent')).toMatchObject({
      frequency: 'weekly',
      time: '07:30',
      weekday: 1,
      enabled: true,
    });
  });

  it('the tick runs only due jobs, logs them, and moves their next run on', async () => {
    await svc.rows(now);
    db.schedules.get('debrief-pm-agent-expiry').nextRunAt = utc(
      '2026-11-12T10:00:00Z',
    );
    await svc.tick(now);
    expect(handlers['debrief-pm-agent-expiry']).toHaveBeenCalledTimes(1);
    expect(handlers['debrief-agent-drain']).not.toHaveBeenCalled();
    expect(db.runs.filter((r) => r.trigger === 'schedule')).toEqual([
      expect.objectContaining({
        jobKey: 'debrief-pm-agent-expiry',
        trigger: 'schedule',
        result: 'ok',
      }),
    ]);
    expect(
      new Date(
        db.schedules.get('debrief-pm-agent-expiry').nextRunAt,
      ).toISOString(),
    ).toBe('2026-11-13T00:05:00.000Z');
  });

  it('a switched-off job is not run by the tick', async () => {
    await svc.rows(now);
    Object.assign(db.schedules.get('debrief-judge'), {
      enabled: false,
      nextRunAt: utc('2026-11-12T10:00:00Z'),
    });
    await svc.tick(now);
    expect(handlers['debrief-judge']).not.toHaveBeenCalled();
  });

  it('a job another replica is running is skipped', async () => {
    await svc.rows(now);
    db.schedules.get('debrief-agent-drain').nextRunAt = utc(
      '2026-11-12T10:05:00Z',
    );
    db.locks.add(
      `${DebriefScheduleService.LOCK_NAMESPACE}:${require('../util/debrief-schedule.util').scheduleLockKey('debrief-agent-drain')}`,
    );
    await svc.tick(now);
    expect(handlers['debrief-agent-drain']).not.toHaveBeenCalled();
  });

  it('a job still running is not started again by the next tick, and a failure is logged', async () => {
    await svc.rows(now);
    let finish!: () => void;
    handlers['debrief-baseline'].mockImplementation(
      () => new Promise<void>((r) => (finish = r)),
    );
    db.schedules.get('debrief-baseline').nextRunAt = utc(
      '2026-11-12T10:00:00Z',
    );
    const first = svc.tick(now);
    await new Promise((r) => setImmediate(r));
    // Overdue again (say someone set it to every minute) while the first run goes on.
    db.schedules.get('debrief-baseline').nextRunAt = utc(
      '2026-11-12T10:00:00Z',
    );
    await svc.tick(now);
    expect(handlers['debrief-baseline']).toHaveBeenCalledTimes(1);
    finish();
    await first;
    handlers['debrief-baseline'].mockRejectedValueOnce(new Error('boom'));
    db.schedules.get('debrief-baseline').nextRunAt = utc(
      '2026-11-12T10:00:00Z',
    );
    await svc.tick(now);
    expect(db.runs.map((r) => r.result)).toEqual(['ok', 'failed']);
    expect(db.runs[1].error).toBe('boom');
  });

  it('a schedule change is logged with who and what (trigger config_change)', async () => {
    await svc.rows(now);
    await svc.update(
      'debrief-pm-agent-expiry',
      { frequency: '1min' },
      9,
      false,
      now,
    );
    const log = db.dataSource.query.mock.calls.find(([sql]) =>
      String(sql).includes("'config_change'"),
    );
    expect(log?.[1]?.[0]).toBe('debrief-pm-agent-expiry');
    expect(log?.[1]?.[1]).toBe(9);
    expect(JSON.parse(log?.[1]?.[2])).toMatchObject({
      before: { frequency: 'daily' },
      after: { frequency: '1min' },
    });
  });

  it('"Every 1 min" for testing only on jobs that call no model', async () => {
    await svc.rows(now);
    for (const k of [
      'debrief-cost-reconcile',
      'debrief-pm-agent-expiry',
      'debrief-autonomy-relock',
      'debrief-pm-agent-forecasts',
      'debrief-console-alerts',
    ])
      await expect(
        svc.update(k, { frequency: '1min' }, 1, false, now),
      ).resolves.toBeDefined();
    for (const k of [
      'debrief-pm-agent',
      'debrief-pm-agent-review',
      'debrief-judge',
    ])
      await expect(
        svc.update(k, { frequency: '1min' }, 1, true, now),
      ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses switching off a job that keeps debriefs flowing, or an unsafe frequency (400)', async () => {
    await expect(
      svc.update('debrief-agent-drain', { enabled: false }, 1, false, now),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.update('debrief-stuck-sweep', { frequency: 'daily' }, 1, false, now),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.update(
        'debrief-console-alerts',
        { frequency: '5min' },
        1,
        false,
        now,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a PM agent frequency change needs the budget confirmation, with the spend effect', async () => {
    await svc.rows(now);
    const err = await svc
      .update('debrief-pm-agent', { frequency: 'daily' }, 1, false, now)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({
      code: 'BUDGET_CONFIRM_REQUIRED',
      spend: { runCostUsd: 0.84, monthlyBeforeUsd: 3.6, monthlyAfterUsd: 25.2 },
    });
    expect(db.schedules.get('debrief-pm-agent').frequency).toBe('weekly');
    await svc.update('debrief-pm-agent', { frequency: 'daily' }, 7, true, now);
    expect(db.schedules.get('debrief-pm-agent')).toMatchObject({
      frequency: 'daily',
      updatedBy: 7,
      weekday: null,
    });
  });

  it('a time change on the PM agent, or any change to other jobs, needs no confirmation', async () => {
    await svc.rows(now);
    await svc.update('debrief-pm-agent', { time: '09:00' }, 1, false, now);
    await svc.update(
      'debrief-cost-reconcile',
      { frequency: '6h' },
      1,
      false,
      now,
    );
    expect(db.schedules.get('debrief-pm-agent').time).toBe('09:00');
    expect(db.schedules.get('debrief-cost-reconcile').frequency).toBe('6h');
  });
});

describe('Schedules access: the debrief_schedules toggle, person by person', () => {
  const ctx = {
    getHandler: () => DebriefSchedulesController.prototype.list,
    getClass: () => DebriefSchedulesController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 5 }, query: {} }),
    }),
  } as unknown as ExecutionContext;
  const guard = (has: boolean) =>
    new FeatureToggleGuard(
      new Reflector(),
      {
        isWithheld: jest.fn().mockResolvedValue(false),
        hasToggle: jest.fn(
          async (_u: number, k: string) =>
            has && k === FeatureToggleKey.DEBRIEF_SCHEDULES,
        ),
        isLimitedToOrgScopedRoutes: jest.fn().mockResolvedValue(false),
      } as any,
      { isEnabledForTenant: jest.fn().mockResolvedValue(false) } as any,
      {} as any,
      {
        getUserPermissions: jest.fn().mockResolvedValue(['system:access']),
      } as any,
    );

  it('403 without the toggle (platform access alone is not enough)', async () => {
    await expect(guard(false).canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('passes with it', async () => {
    await expect(guard(true).canActivate(ctx)).resolves.toBe(true);
  });
});
