import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { PmRunTrigger } from '../enum/pm-agent.enum';
import {
  PM_OUTBOX_LOCK_NAMESPACE,
  IST_OFFSET_MS,
} from '../constants/pm-agent.constants';
import {
  PM_PIPELINE,
  PM_RUN_LOCK_KEY,
  PM_RUN_SCHEDULE_CRON,
} from '../constants/pm-agent-pipeline.constants';
import { PmLaneToolsService } from '../lane/pm-lane-tools.service';
import { PmAgentContextService } from '../pipeline/pm-agent-context.service';
import { PmAgentLlmService } from '../pipeline/pm-agent-llm.service';
import { PmAgentPipelineStore } from '../pipeline/pm-agent-pipeline.store';
import { PmRunPipeline } from '../pipeline/pm-run-pipeline';
import { istDate } from '../util/ist.util';
import { PmAgentEventsService } from './pm-agent-events.service';
import { PmAgentRunTrigger } from './pm-agent-run-trigger';

/**
 * The generation pipeline's entry points: PM_AGENT_RUN_TRIGGER (POST /run, Revise now) and
 * the daily schedule. The run itself is PmRunPipeline; this class only wires it to Nest.
 *
 * Run now answers at once ({runId, started}) and works in the background; the UI follows it
 * through `state.updated` and GET /state. Revise now runs only the revisions lane for that
 * feedback row (budget permitting); if a run is already going, the row waits for the next run.
 */
@Injectable()
export class PmAgentRunService implements PmAgentRunTrigger {
  private readonly logger = LoggerService.getInstance(PmAgentRunService.name);
  private readonly pipeline: PmRunPipeline;

  constructor(
    store: PmAgentPipelineStore,
    llm: PmAgentLlmService,
    tools: PmLaneToolsService,
    context: PmAgentContextService,
    events: PmAgentEventsService,
  ) {
    this.pipeline = new PmRunPipeline({
      store,
      llm,
      toolbox: tools,
      context,
      events,
      log: (level, message) => this.logger[level](message),
    });
  }

  runNow(
    userId: number,
  ): Promise<{ runId: string | null; started: boolean; reason?: string }> {
    return this.pipeline.start({
      trigger: PmRunTrigger.MANUAL,
      userId,
      background: true,
    });
  }

  async reviseNow(feedbackId: string, userId: number): Promise<void> {
    const result = await this.pipeline.start({
      trigger: PmRunTrigger.REVISION,
      userId,
      onlyFeedbackId: feedbackId,
      background: true,
    });
    if (!result.started) {
      this.logger.info(
        `[PM_AGENT] Revise-now for ${feedbackId} deferred to the next run: ${result.reason}`,
      );
    }
  }

  /** The scheduled run, awaited (the scheduler holds its lock for the duration). */
  runScheduled() {
    return this.pipeline.start({
      trigger: PmRunTrigger.SCHEDULED,
      userId: null,
      background: false,
    });
  }
}

/**
 * The daily run at `settings.runHourIst` (IST). A 10-minute tick checks: enabled, the IST hour
 * has come, and no scheduled run (or skipped attempt) is recorded for today's IST date. One
 * replica acts per tick (a Postgres session advisory lock, as the outbox drain); the
 * one-running partial unique index is the second line. The tick also fails `running` rows that
 * stopped reporting (a crashed task), so a dead run never blocks the queue forever.
 */
@Injectable()
export class PmAgentRunSchedulerService {
  private readonly logger = LoggerService.getInstance(
    PmAgentRunSchedulerService.name,
  );
  private ticking = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly store: PmAgentPipelineStore,
    private readonly runs: PmAgentRunService,
  ) {}

  /** Pure: is it time for today's scheduled run? */
  static isDue(
    runHourIst: number,
    now: Date,
    alreadyRanToday: boolean,
  ): boolean {
    const istHour = new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();
    return !alreadyRanToday && istHour >= runHourIst;
  }

  @Cron(PM_RUN_SCHEDULE_CRON)
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    const runner = this.dataSource.createQueryRunner();
    try {
      await runner.connect();
      const rows = await runner.query(
        'SELECT pg_try_advisory_lock($1, $2) AS locked',
        [PM_OUTBOX_LOCK_NAMESPACE, PM_RUN_LOCK_KEY],
      );
      if (!rows?.[0]?.locked) return;
      try {
        const failed = await this.store.failStaleRuns(PM_PIPELINE.STALE_RUN_MS);
        if (failed) {
          this.logger.warn(`[PM_AGENT] Marked ${failed} stale run(s) failed.`);
        }
        const settings = await this.store.getSettings();
        if (!settings.enabled) return;
        const now = new Date();
        const ranToday = await this.store.hasRunFor(
          istDate(now),
          PmRunTrigger.SCHEDULED,
        );
        if (
          !PmAgentRunSchedulerService.isDue(settings.runHourIst, now, ranToday)
        ) {
          return;
        }
        const result = await this.runs.runScheduled();
        this.logger.info(
          `[PM_AGENT] Scheduled run: ${result.started ? `ran ${result.runId}` : `skipped (${result.reason})`}`,
        );
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1, $2)', [
          PM_OUTBOX_LOCK_NAMESPACE,
          PM_RUN_LOCK_KEY,
        ]);
      }
    } catch (error) {
      this.logger.error(
        `[PM_AGENT] Scheduled run tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.ticking = false;
      await runner.release().catch(() => undefined);
    }
  }
}
