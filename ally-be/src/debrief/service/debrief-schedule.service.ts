import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { DEBRIEF_AGENT_KEY } from '../constants/debrief-release.constants';
import {
  BASELINE_RUN_COST_USD,
  DEBRIEF_SCHEDULE_JOBS,
  DebriefSchedule,
  DebriefScheduleJob,
  ScheduleFrequency,
  scheduleJob,
} from '../constants/debrief-schedule.constants';
import {
  applyScheduleChange,
  monthlySpendUsd,
  nextRunAt,
  ScheduleChange,
  scheduleLockKey,
} from '../util/debrief-schedule.util';
import { DebriefSettingsService } from './debrief-settings.service';

/** A scheduled run, or a person changing a job's schedule (who, what, when). */
export type ScheduleTrigger = 'schedule' | 'config_change';
export type ScheduleRunResult = 'running' | 'ok' | 'failed';

interface ScheduleRow {
  key: string;
  frequency: ScheduleFrequency;
  time: string | null;
  weekday: number | null;
  monthDay: number | null;
  enabled: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  updatedBy: number | null;
  updatedAt: Date;
}

const SUMMARY_MAX = 300;
const ERROR_MAX = 1000;

/**
 * Debrief › Settings › Schedules. The debrief and PM-agent jobs run when their
 * stored schedule says (`debrief_schedules`), not on a fixed @Cron tick: a
 * one-minute tick runs every job that is due. Each job runs under its own
 * Postgres advisory lock, so two replicas — or a schedule and a Run now —
 * never run the same job at once. Every run, and every change to a schedule
 * (who, what, when), is logged in `debrief_schedule_runs`. There is no Run now:
 * to test a job, set it to run often and set it back. Other modules' tasks stay
 * on ScheduledTaskRunnerService.
 */
@Injectable()
export class DebriefScheduleService {
  private readonly logger = LoggerService.getInstance(
    DebriefScheduleService.name,
  );
  /** Separate from ScheduledTaskRunnerService's 4919 so the keys can't collide. */
  static readonly LOCK_NAMESPACE = 4920;

  constructor(
    private readonly dataSource: DataSource,
    @Optional() private readonly settings?: DebriefSettingsService,
  ) {}

  // --- Stored schedules -------------------------------------------------------

  /** Every job's row, creating any missing one from its default (today's schedule). */
  async rows(now = new Date()): Promise<Map<string, ScheduleRow>> {
    const found: ScheduleRow[] = await this.dataSource.query(
      `SELECT * FROM debrief_schedules`,
    );
    const byKey = new Map(found.map((r) => [r.key, r]));
    for (const job of DEBRIEF_SCHEDULE_JOBS) {
      if (byKey.has(job.key)) continue;
      const d = job.defaults;
      const [row] = await this.dataSource.query(
        `INSERT INTO debrief_schedules
           (key, frequency, "time", weekday, "monthDay", enabled, "nextRunAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key
         RETURNING *`,
        [
          job.key,
          d.frequency,
          d.time,
          d.weekday,
          d.monthDay,
          d.enabled,
          nextRunAt(d, now),
        ],
      );
      byKey.set(job.key, row);
    }
    return byKey;
  }

  private static schedule(r: ScheduleRow): DebriefSchedule {
    return {
      frequency: r.frequency,
      time: r.time,
      weekday: r.weekday,
      monthDay: r.monthDay,
      enabled: r.enabled,
    };
  }

  // --- The tick ---------------------------------------------------------------

  /** Every minute: run each enabled job whose next run has come. */
  @Cron('0 * * * * *')
  async tick(now = new Date()): Promise<void> {
    let rows: Map<string, ScheduleRow>;
    try {
      rows = await this.rows(now);
    } catch (e) {
      this.logger.error(
        `[schedules] could not read schedules: ${(e as Error).message}`,
      );
      return;
    }
    const due = DEBRIEF_SCHEDULE_JOBS.filter((job) => {
      const r = rows.get(job.key);
      return (
        r &&
        r.enabled &&
        r.nextRunAt &&
        new Date(r.nextRunAt) <= now &&
        scheduledTaskRegistry.getConfigurable(job.key)
      );
    });
    // Each job has its own lock, so a long one (the PM agent) never holds up the drain.
    await Promise.allSettled(
      due.map((job) => this.start(job, now).then((s) => s?.done)),
    );
  }

  /**
   * Take the job's lock and start it. Null when it is already running (here or
   * on another replica) or no longer due once locked.
   * `done` settles when the run has finished and been logged.
   */
  private async start(
    job: DebriefScheduleJob,
    now = new Date(),
  ): Promise<{ runId: string; done: Promise<void> } | null> {
    const task = scheduledTaskRegistry.getConfigurable(job.key);
    if (!task) return null;
    const lock = [
      DebriefScheduleService.LOCK_NAMESPACE,
      scheduleLockKey(job.key),
    ];
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    let handedOff = false;
    try {
      const [l] = await runner.query(
        'SELECT pg_try_advisory_lock($1, $2) AS locked',
        lock,
      );
      if (!l?.locked) return null;
      try {
        // Another replica may have run it between our read and our lock.
        const [r]: ScheduleRow[] = await runner.query(
          `SELECT * FROM debrief_schedules WHERE key = $1`,
          [job.key],
        );
        if (!r?.enabled || !r.nextRunAt || new Date(r.nextRunAt) > now)
          return null;
        // Move the schedule on before running, so a long run is not started twice.
        await runner.query(
          `UPDATE debrief_schedules SET "lastRunAt" = $2, "nextRunAt" = $3 WHERE key = $1`,
          [
            job.key,
            now,
            nextRunAt(DebriefScheduleService.schedule(r), now, now),
          ],
        );
        const [run] = await runner.query(
          `INSERT INTO debrief_schedule_runs ("jobKey", trigger, "startedAt", result)
           VALUES ($1, 'schedule', now(), 'running') RETURNING id`,
          [job.key],
        );
        const startedMs = Date.now();
        const done = (async () => {
          try {
            const summary = await task.handler();
            await runner.query(
              `UPDATE debrief_schedule_runs
                  SET result = 'ok', "durationMs" = $2, summary = $3
                WHERE id = $1`,
              [
                run.id,
                Date.now() - startedMs,
                summary ? String(summary).slice(0, SUMMARY_MAX) : null,
              ],
            );
          } catch (e) {
            const message = (e as Error)?.message ?? String(e);
            this.logger.error(`[schedules] ${job.key} failed: ${message}`);
            await runner
              .query(
                `UPDATE debrief_schedule_runs
                    SET result = 'failed', "durationMs" = $2, error = $3
                  WHERE id = $1`,
                [run.id, Date.now() - startedMs, message.slice(0, ERROR_MAX)],
              )
              .catch(() => undefined);
          } finally {
            await runner
              .query('SELECT pg_advisory_unlock($1, $2)', lock)
              .catch(() => undefined);
            await runner.release();
          }
        })();
        handedOff = true;
        return { runId: run.id as string, done };
      } finally {
        if (!handedOff)
          await runner.query('SELECT pg_advisory_unlock($1, $2)', lock);
      }
    } finally {
      if (!handedOff) await runner.release();
    }
  }

  // --- Changing a schedule ----------------------------------------------------

  /** Cost of one run of a learning-budget job: the average of its last runs, else its cap. */
  async runCostUsd(key: string): Promise<number | null> {
    if (key === 'debrief-baseline') return BASELINE_RUN_COST_USD;
    if (key !== 'debrief-pm-agent' && key !== 'debrief-pm-agent-review')
      return null;
    const review = key === 'debrief-pm-agent' ? 'weekly' : 'monthly';
    const [r] = await this.dataSource
      .query(
        `SELECT avg((detail->>'costUsd')::numeric) AS avg FROM (
           SELECT detail FROM agent_lesson_audit
            WHERE "agentKey" = $1 AND action = 'curator_run'
              AND detail->>'review' = $2 AND detail->>'costUsd' IS NOT NULL
            ORDER BY "createdAt" DESC LIMIT 6) t`,
        [DEBRIEF_AGENT_KEY, review],
      )
      .catch(() => [{ avg: null }]);
    if (r?.avg != null) return Math.round(Number(r.avg) * 100) / 100;
    const s = await this.settings?.get().catch(() => null);
    const cap = (s as { pmAgentRunCapUsd?: number } | null)?.pmAgentRunCapUsd;
    return cap ?? null;
  }

  async update(
    key: string,
    change: ScheduleChange,
    userId: number,
    confirmBudget = false,
    now = new Date(),
  ) {
    const job = scheduleJob(key);
    if (!job) throw new NotFoundException('no such job');
    const rows = await this.rows(now);
    const row = rows.get(key) as ScheduleRow;
    const current = DebriefScheduleService.schedule(row);
    const applied = applyScheduleChange(job, current, change);
    if ('refusal' in applied) throw new BadRequestException(applied.refusal);
    const next = applied.schedule;
    if (
      job.learningBudget &&
      (next.frequency !== current.frequency ||
        next.enabled !== current.enabled) &&
      !confirmBudget
    ) {
      const cost = await this.runCostUsd(key);
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'BUDGET_CONFIRM_REQUIRED',
        message:
          'This changes how much of the learning budget is spent. Confirm to save.',
        spend:
          cost == null
            ? null
            : {
                runCostUsd: cost,
                monthlyBeforeUsd: monthlySpendUsd(
                  current.frequency,
                  current.enabled,
                  cost,
                ),
                monthlyAfterUsd: monthlySpendUsd(
                  next.frequency,
                  next.enabled,
                  cost,
                ),
              },
      });
    }
    await this.dataSource.query(
      `UPDATE debrief_schedules
          SET frequency = $2, "time" = $3, weekday = $4, "monthDay" = $5,
              enabled = $6, "nextRunAt" = $7, "updatedBy" = $8, "updatedAt" = now()
        WHERE key = $1`,
      [
        key,
        next.frequency,
        next.time,
        next.weekday,
        next.monthDay,
        next.enabled,
        nextRunAt(next, now, row.lastRunAt ? new Date(row.lastRunAt) : null),
        userId,
      ],
    );
    // The history shows who changed what, and when.
    await this.dataSource.query(
      `INSERT INTO debrief_schedule_runs ("jobKey", trigger, "triggeredBy", "startedAt", result, change)
       VALUES ($1, 'config_change', $2, now(), 'ok', $3)`,
      [key, userId, JSON.stringify({ before: current, after: next })],
    );
    return (await this.view(now)).jobs.find((j) => j.key === key);
  }

  // --- Reading ----------------------------------------------------------------

  /** Keys of the jobs whose lock some connection holds right now. */
  private async runningKeys(): Promise<Set<string>> {
    const rows: Array<{ objid: string }> = await this.dataSource
      .query(
        `SELECT objid FROM pg_locks
          WHERE locktype = 'advisory' AND classid = $1 AND objsubid = 2 AND granted`,
        [DebriefScheduleService.LOCK_NAMESPACE],
      )
      .catch(() => []);
    const held = new Set(rows.map((r) => Number(r.objid)));
    return new Set(
      DEBRIEF_SCHEDULE_JOBS.filter((j) => held.has(scheduleLockKey(j.key))).map(
        (j) => j.key,
      ),
    );
  }

  /** A "running" row whose lock nobody holds was cut off (a restart): show it as failed. */
  private static settle<
    T extends { result: ScheduleRunResult; error: string | null },
  >(run: T, running: boolean): T {
    if (run.result !== 'running' || running) return run;
    return {
      ...run,
      result: 'failed',
      error: run.error ?? 'stopped before it finished',
    };
  }

  async view(now = new Date()) {
    const [rows, running, lastRuns] = await Promise.all([
      this.rows(now),
      this.runningKeys(),
      this.dataSource.query(
        `SELECT DISTINCT ON ("jobKey") "jobKey", trigger, "startedAt", "durationMs", result, summary, error
           FROM debrief_schedule_runs
          WHERE trigger = 'schedule'
          ORDER BY "jobKey", "startedAt" DESC`,
      ) as Promise<
        Array<{
          jobKey: string;
          trigger: ScheduleTrigger;
          startedAt: Date;
          durationMs: number | null;
          result: ScheduleRunResult;
          summary: string | null;
          error: string | null;
        }>
      >,
    ]);
    const last = new Map(lastRuns.map((r) => [r.jobKey, r]));
    const jobs = await Promise.all(
      DEBRIEF_SCHEDULE_JOBS.map(async (job) => {
        const r = rows.get(job.key) as ScheduleRow;
        const l = last.get(job.key);
        const isRunning = running.has(job.key);
        const settled = l ? DebriefScheduleService.settle(l, isRunning) : null;
        const runCostUsd = job.learningBudget
          ? await this.runCostUsd(job.key)
          : null;
        return {
          key: job.key,
          frequency: r.frequency,
          time: r.time,
          weekday: r.weekday,
          monthDay: r.monthDay,
          enabled: r.enabled,
          locked: job.locked,
          options: [...job.options],
          learningBudget: job.learningBudget,
          runCostUsd,
          nextRunAt: r.enabled ? r.nextRunAt : null,
          running: isRunning,
          lastRun: settled
            ? {
                trigger: settled.trigger,
                startedAt: settled.startedAt,
                durationMs: settled.durationMs,
                result: settled.result,
                summary: settled.summary,
                error: settled.error,
              }
            : null,
        };
      }),
    );
    return { timezone: 'Asia/Kolkata', jobs };
  }

  async history(page = 1, pageSize = 20) {
    const size = Math.min(Math.max(pageSize, 1), 100);
    const p = Math.max(page, 1);
    const [rows, [count], running] = await Promise.all([
      this.dataSource.query(
        `SELECT r.id, r."jobKey", r.trigger, r."startedAt", r."durationMs", r.result,
                r.summary, r.error, r.change, r."triggeredBy", u.name AS "triggeredByName"
           FROM debrief_schedule_runs r
           LEFT JOIN users u ON u.id = r."triggeredBy"
          ORDER BY r."startedAt" DESC
          LIMIT $1 OFFSET $2`,
        [size, (p - 1) * size],
      ),
      this.dataSource.query(
        `SELECT count(*)::int AS n FROM debrief_schedule_runs`,
      ),
      this.runningKeys(),
    ]);
    return {
      page: p,
      pageSize: size,
      total: count?.n ?? 0,
      runs: (rows as Array<Record<string, any>>).map((r) => {
        const s = DebriefScheduleService.settle(
          r as { result: ScheduleRunResult; error: string | null },
          running.has(r.jobKey),
        );
        return {
          id: r.id,
          key: r.jobKey,
          trigger: r.trigger,
          by:
            r.triggeredBy == null
              ? null
              : { id: r.triggeredBy, name: r.triggeredByName ?? null },
          startedAt: r.startedAt,
          durationMs: r.durationMs,
          result: s.result,
          summary: r.summary,
          error: s.error,
          change: r.change ?? null,
        };
      }),
    };
  }
}
