import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { DebriefSettingsService } from './debrief-settings.service';

/** Rows cleared per statement, so one run never holds a long lock. */
export const RETENTION_BATCH = 2000;
/** Statements per run: a backlog is worked off over several days, not in one night. */
export const RETENTION_MAX_BATCHES = 50;

/**
 * Agent logs keep each model call's exact input and reply, which hold learner quotes. This job
 * (Settings › Schedules, `debrief-run-log-retention`, shipped OFF) clears those two fields on rows
 * older than the owner setting `agentLogRetentionDays` and keeps the step, tokens, cost and timing.
 * It deletes data, so nothing runs it until an owner switches the schedule on.
 */
@Injectable()
export class DebriefRunLogRetentionService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: DebriefSettingsService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.registerConfigurable(
      'debrief-run-log-retention',
      async () => {
        const r = await this.run();
        return r.cleared
          ? `Cleared the text of ${r.cleared} log row${r.cleared === 1 ? '' : 's'} older than ${r.days} days`
          : `Nothing older than ${r.days} days to clear`;
      },
    );
  }

  private async days(): Promise<number> {
    const { agentLogRetentionDays } = await this.settings.get();
    return Number(agentLogRetentionDays) || 90;
  }

  /** How many rows a run would clear now, without clearing any. */
  async preview(): Promise<{ wouldClear: number; days: number }> {
    const days = await this.days();
    const [row] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM debrief_run_logs
        WHERE created_at < now() - make_interval(days => $1)
          AND (input IS NOT NULL OR output IS NOT NULL)`,
      [days],
    );
    return { wouldClear: Number(row?.n ?? 0), days };
  }

  /** Clears the exact input and reply of old rows, in batches. Returns how many it cleared. */
  async run(): Promise<{ cleared: number; days: number }> {
    const days = await this.days();
    let cleared = 0;
    for (let i = 0; i < RETENTION_MAX_BATCHES; i++) {
      const res = await this.dataSource.query(
        `UPDATE debrief_run_logs SET input = NULL, output = NULL
          WHERE id IN (
            SELECT id FROM debrief_run_logs
             WHERE created_at < now() - make_interval(days => $1)
               AND (input IS NOT NULL OR output IS NOT NULL)
             LIMIT $2)
        RETURNING id`,
        [days, RETENTION_BATCH],
      );
      const rows = Array.isArray(res?.[0]) ? res[0] : (res ?? []);
      cleared += rows.length;
      if (rows.length < RETENTION_BATCH) break;
    }
    return { cleared, days };
  }
}
