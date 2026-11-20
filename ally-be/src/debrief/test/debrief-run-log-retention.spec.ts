import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { DEBRIEF_SCHEDULE_JOBS } from '../constants/debrief-schedule.constants';
import { OWNER_SETTINGS_SPEC } from '../constants/debrief-owner-settings.constants';
import {
  DebriefRunLogRetentionService,
  RETENTION_BATCH,
  RETENTION_MAX_BATCHES,
} from '../service/debrief-run-log-retention.service';
import { AddDebriefRunSnapshot1984440000000 } from '../../database/migrations/1984440000000-AddDebriefRunSnapshot';

function build(days: number | undefined, batches: number[]) {
  const sql: Array<[string, unknown[]]> = [];
  const dataSource = {
    query: jest.fn(async (s: string, p: unknown[]) => {
      sql.push([s, p]);
      if (s.includes('SELECT count(*)')) return [{ n: 7 }];
      const n = batches.shift() ?? 0;
      return [Array.from({ length: n }, (_, i) => ({ id: `r${i}` })), n];
    }),
  } as any;
  const settings = {
    get: jest.fn(async () => ({ agentLogRetentionDays: days })),
  } as any;
  return { svc: new DebriefRunLogRetentionService(dataSource, settings), sql };
}

describe('clearing old agent-log text', () => {
  it('ships off, as a job a person switches on, and the days are an owner setting with a default of 90', () => {
    const job = DEBRIEF_SCHEDULE_JOBS.find(
      (j) => j.key === 'debrief-run-log-retention',
    )!;
    expect(job.defaults.enabled).toBe(false);
    expect(OWNER_SETTINGS_SPEC.agentLogRetentionDays).toMatchObject({
      default: 90,
      kind: 'int',
      min: 7,
    });
  });

  it('registers itself as a schedulable task', () => {
    const { svc } = build(90, []);
    svc.onModuleInit();
    expect(
      scheduledTaskRegistry.getConfigurable('debrief-run-log-retention'),
    ).toBeDefined();
  });

  it('clears only the two text fields of rows older than the setting, and says how many', async () => {
    const { svc, sql } = build(30, [3]);
    expect(await svc.run()).toEqual({ cleared: 3, days: 30 });
    const [update, params] = sql[0];
    expect(update).toContain('SET input = NULL, output = NULL');
    // Cost, tokens, timing and the step stay: nothing else is touched or deleted.
    expect(update).not.toMatch(/DELETE|tokens|cost_usd|\bms\b\s*=/i);
    expect(update).toContain('created_at < now() - make_interval(days => $1)');
    expect(params).toEqual([30, RETENTION_BATCH]);
  });

  it('works a backlog off in batches and stops at the cap or at a short batch', async () => {
    const full = build(90, [RETENTION_BATCH, RETENTION_BATCH, 5]);
    expect((await full.svc.run()).cleared).toBe(2 * RETENTION_BATCH + 5);
    const endless = build(
      90,
      Array(RETENTION_MAX_BATCHES + 10).fill(RETENTION_BATCH),
    );
    expect((await endless.svc.run()).cleared).toBe(
      RETENTION_MAX_BATCHES * RETENTION_BATCH,
    );
  });

  it('can say what it would clear without clearing anything, and falls back to 90 days', async () => {
    const { svc, sql } = build(undefined, []);
    expect(await svc.preview()).toEqual({ wouldClear: 7, days: 90 });
    expect(sql.every(([s]) => s.startsWith('SELECT'))).toBe(true);
  });
});

describe('AddDebriefRunSnapshot', () => {
  const run = async (dir: 'up' | 'down') => {
    const q: string[] = [];
    await new AddDebriefRunSnapshot1984440000000()[dir]({
      query: async (s: string) => void q.push(s),
    } as any);
    return q.join('\n');
  };
  it('only adds two nullable columns, and goes back by dropping them', async () => {
    const up = await run('up');
    expect(up).toContain('ADD COLUMN IF NOT EXISTS "bundleHash"');
    expect(up).toContain('ADD COLUMN IF NOT EXISTS "promptVersions"');
    expect(up).not.toMatch(/NOT NULL|DROP|DELETE|UPDATE/i);
    expect(await run('down')).toContain('DROP COLUMN IF EXISTS "bundleHash"');
  });
});
