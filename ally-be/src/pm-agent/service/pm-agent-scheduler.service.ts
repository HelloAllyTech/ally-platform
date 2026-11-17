import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import {
  builderRequesters,
  PM_AGENT_REQUESTER,
} from 'src/builder/util/builder-requesters.registry';
import {
  PM_AGENT_RECONCILE_INTERVAL,
  PM_AGENT_RECONCILE_TASK,
  PM_OUTBOX_LOCK_KEY,
  PM_OUTBOX_LOCK_NAMESPACE,
} from '../constants/pm-agent.constants';
import { PmAgentBuildService } from './pm-agent-build.service';

/**
 * Wires the PM Agent's background work.
 *
 *  - **Outbox drain, every 30 s.** An accepted card's row is due ten seconds after Accept
 *    (the undo window); the shared scheduler's shortest tick is five minutes, which would
 *    make "Accept & build" feel broken. Same multi-replica guard as
 *    ScheduledTaskRunnerService: a Postgres session advisory lock on a dedicated
 *    connection, so one replica drains per tick and a dead connection frees the lock.
 *    The rows' own leases (PmAgentOutboxRepository.claim) are the second line.
 *  - **Status reconcile, on the shared 5-minute tick** — Builder's own PR and release
 *    reconciles run on that tick too, so a faster one would only re-read the same rows.
 *  - **Builder requester `pm_agent`.** Builder tells a session's requester when an
 *    interview turn ends. PM Agent sessions do not interview (their PRD is compiled), so
 *    the handler deliberately does nothing: it never answers Builder's questions on a
 *    person's behalf. A question Builder asks shows up as needs_attention via reconcile.
 */
@Injectable()
export class PmAgentSchedulerService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    PmAgentSchedulerService.name,
  );
  private draining = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly buildService: PmAgentBuildService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      PM_AGENT_RECONCILE_INTERVAL,
      PM_AGENT_RECONCILE_TASK,
      () => this.buildService.reconcile().then(() => undefined),
    );
    builderRequesters.register(PM_AGENT_REQUESTER, {
      turnEnded: async () => undefined,
    });
  }

  @Cron('*/30 * * * * *')
  async drainOutbox(): Promise<void> {
    if (this.draining) return; // a slow tick on this instance is still running
    this.draining = true;
    const runner = this.dataSource.createQueryRunner();
    try {
      await runner.connect();
      const rows = await runner.query(
        'SELECT pg_try_advisory_lock($1, $2) AS locked',
        [PM_OUTBOX_LOCK_NAMESPACE, PM_OUTBOX_LOCK_KEY],
      );
      if (!rows?.[0]?.locked) return;
      try {
        await this.buildService.drain();
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1, $2)', [
          PM_OUTBOX_LOCK_NAMESPACE,
          PM_OUTBOX_LOCK_KEY,
        ]);
      }
    } catch (error) {
      this.logger.error(
        `[PM_AGENT] Outbox drain failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.draining = false;
      await runner.release().catch(() => undefined);
    }
  }
}
