import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { PM_IMPACT } from './impact-verdict';
import { PmAgentImpactService } from './pm-agent-impact.service';

/**
 * The daily due-reads job for impact checks (04:00 IST). Same multi-replica guard as the
 * outbox drain (PmAgentSchedulerService): a Postgres session advisory lock — here
 * `(1982000, 5)` — on a dedicated connection, so one replica reads per day and a dead
 * connection frees the lock; the rows' conditional `pending` updates are the second line.
 *
 * Runs even when the PM Agent is switched off: measuring something already shipped costs no
 * model spend, and the learning it feeds is read only when the agent runs.
 */
@Injectable()
export class PmAgentImpactScheduler {
  private readonly logger = LoggerService.getInstance(
    PmAgentImpactScheduler.name,
  );
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly impact: PmAgentImpactService,
  ) {}

  @Cron(PM_IMPACT.CRON, { timeZone: PM_IMPACT.CRON_TZ })
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    const runner = this.dataSource.createQueryRunner();
    try {
      await runner.connect();
      const rows = await runner.query(
        'SELECT pg_try_advisory_lock($1, $2) AS locked',
        [PM_IMPACT.LOCK_NAMESPACE, PM_IMPACT.LOCK_KEY],
      );
      if (!rows?.[0]?.locked) return 0;
      try {
        // ONE pass per day: a failed read stays pending and must not be retried (and its
        // attempts burned) again in the same tick. A backlog beyond BATCH waits a day.
        const total = await this.impact.runDue(new Date());
        if (total) {
          this.logger.info(`[PM_AGENT] Impact checks: ${total} read(s)`);
        }
        return total;
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1, $2)', [
          PM_IMPACT.LOCK_NAMESPACE,
          PM_IMPACT.LOCK_KEY,
        ]);
      }
    } catch (error) {
      this.logger.error(
        `[PM_AGENT] Impact checks failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    } finally {
      this.running = false;
      await runner.release().catch(() => undefined);
    }
  }
}
