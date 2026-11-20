import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource, QueryRunner } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { PmAgentSettings } from '../entity/pm-agent-settings.entity';
import {
  PmLessonStatus,
  PmMemoryKind,
  PmMemorySource,
} from '../enum/pm-agent.enum';
import {
  IST_OFFSET_MS,
  PM_OUTBOX_LOCK_NAMESPACE,
} from '../constants/pm-agent.constants';
import { PM_RUN_SCHEDULE_CRON } from '../constants/pm-agent-pipeline.constants';
import { PmLessonHealth, PmLessonResponse } from '../dto/pm-agent.dto';
import { PmAgentContextService } from '../pipeline/pm-agent-context.service';
import { PmAgentLlmService, PmLlmPort } from '../pipeline/pm-agent-llm.service';
import {
  PmAgentMemoryRepository,
  PmAgentSettingsRepository,
} from '../repository/pm-agent.repositories';
import { PmAgentEventsService } from '../service/pm-agent-events.service';
import { istDate } from '../util/ist.util';
import { appendLessonEvent, toLessonResponse } from './pm-lesson-admin';
import { PmLessonsJob, PmLessonsRunSummary } from './pm-lessons-job';
import {
  PM_LESSONS,
  PM_LESSONS_LOCK_KEY,
  PmLessonsSkipReason,
} from './pm-lessons.constants';
import { PmLessonsSqlStore } from './pm-lessons.store';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pure: is the weekly lessons job due at `now` (IST weekday + run hour, once per date)? */
export function isLessonsDue(
  settings: Pick<
    PmAgentSettings,
    | 'enabled'
    | 'lessonsEnabled'
    | 'lessonsWeekday'
    | 'runHourIst'
    | 'lessonsLastRunDate'
  >,
  now: Date,
): boolean {
  if (!settings.enabled || settings.lessonsEnabled === false) return false;
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  if (ist.getUTCDay() !== (settings.lessonsWeekday ?? 1)) return false;
  if (ist.getUTCHours() < settings.runHourIst) return false;
  const last = settings.lessonsLastRunDate
    ? String(settings.lessonsLastRunDate).slice(0, 10)
    : null;
  return last !== istDate(now);
}

/**
 * The weekly lessons job wired to Nest: Run now (`POST /lessons/run`), Confirm
 * (`POST /lessons/:id/confirm`) and the health figures. One job at a time across replicas: a
 * Postgres session advisory lock `(1982000, 6)` on a dedicated connection, held for the run.
 * Model calls go through PmAgentLlmService (reserve-before-spend, `llm_usage` rows labelled
 * `pm_agent`, so they count toward the monthly budget) with no `pm_agent_run_steps` trace:
 * the job has no `pm_agent_runs` row, and must not occupy the card run's one-running slot.
 */
@Injectable()
export class PmAgentLessonsService {
  private readonly logger = LoggerService.getInstance(
    PmAgentLessonsService.name,
  );
  readonly job: PmLessonsJob;
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: PmAgentSettingsRepository,
    private readonly memory: PmAgentMemoryRepository,
    private readonly events: PmAgentEventsService,
    store: PmLessonsSqlStore,
    llm: PmAgentLlmService,
    context: PmAgentContextService,
  ) {
    const port: PmLlmPort = {
      resolveTarget: (taskId, promptCode, cheap) =>
        llm.resolveTarget(taskId, promptCode, cheap),
      loadPrompt: (promptCode) => llm.loadPrompt(promptCode),
      step: (request) => llm.step({ ...request, noTrace: true }),
    };
    this.job = new PmLessonsJob({
      store,
      llm: port,
      context,
      log: (level, message) => this.logger[level](message),
    });
  }

  /** POST /lessons/run: answers at once; the job continues in the background. */
  async runNow(): Promise<{ started: boolean; reason?: string }> {
    const settings = await this.settings.getSingleton();
    const pre = await this.job.preflight(settings);
    if (pre.reason) return { started: false, reason: pre.reason };
    const runner = await this.tryLock();
    if (!runner) {
      return { started: false, reason: PmLessonsSkipReason.ALREADY_RUNNING };
    }
    void this.runLocked(runner, 'manual');
    return { started: true };
  }

  /** Take the job lock on a dedicated connection; null when another run holds it. */
  async tryLock(): Promise<QueryRunner | null> {
    if (this.running) return null;
    const runner = this.dataSource.createQueryRunner();
    try {
      await runner.connect();
      const rows = await runner.query(
        'SELECT pg_try_advisory_lock($1, $2) AS locked',
        [PM_OUTBOX_LOCK_NAMESPACE, PM_LESSONS_LOCK_KEY],
      );
      if (rows?.[0]?.locked) {
        this.running = true;
        return runner;
      }
    } catch (error) {
      this.logger.error(
        `[PM_AGENT] Lessons lock failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await runner.release().catch(() => undefined);
    return null;
  }

  /** Run the job while holding `runner`'s lock, then release both. Never throws. */
  async runLocked(
    runner: QueryRunner,
    trigger: 'manual' | 'scheduled',
  ): Promise<PmLessonsRunSummary | null> {
    try {
      const summary = await this.job.run(`lessons:${istDate()}:${trigger}`);
      this.logger.info(
        `[PM_AGENT] Lessons job (${trigger}): ${summary.status}${summary.reason ? ` (${summary.reason})` : ''}; ` +
          `${summary.activated} active, ${summary.proposed} proposed, ${summary.resupported} re-supported, ` +
          `${summary.expired} expired, $${summary.spentUsd}`,
      );
      this.events.stateUpdated();
      return summary;
    } catch (error) {
      this.logger.error(
        `[PM_AGENT] Lessons job crashed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      await this.releaseLock(runner);
    }
  }

  async releaseLock(runner: QueryRunner): Promise<void> {
    this.running = false;
    await runner
      .query('SELECT pg_advisory_unlock($1, $2)', [
        PM_OUTBOX_LOCK_NAMESPACE,
        PM_LESSONS_LOCK_KEY,
      ])
      .catch(() => undefined);
    await runner.release().catch(() => undefined);
  }

  /** proposed → active, conditionally (409 when it is not proposed any more). */
  async confirm(userId: number, id: string): Promise<PmLessonResponse> {
    const row = await this.memory.findOne({
      where: { id, kind: PmMemoryKind.LESSON },
    });
    if (!row) throw new NotFoundException('Lesson not found');
    const now = new Date();
    const result = await this.memory.update(
      { id, kind: PmMemoryKind.LESSON, lessonStatus: PmLessonStatus.PROPOSED },
      {
        lessonStatus: PmLessonStatus.ACTIVE,
        active: true,
        updatedBy: userId,
        expiresAt:
          row.source === PmMemorySource.MANUAL
            ? (row.expiresAt ?? null)
            : new Date(now.getTime() + PM_LESSONS.EXPIRY_DAYS * DAY_MS),
        lessonEvents: appendLessonEvent(
          row,
          { type: 'lesson_confirmed', actorUserId: userId },
          now,
        ),
      } as never,
    );
    if (!result.affected) {
      throw new ConflictException(
        `Only a proposed lesson can be confirmed (this one is ${row.lessonStatus ?? 'unknown'})`,
      );
    }
    this.events.stateUpdated();
    const fresh = await this.memory.findOne({ where: { id } });
    return toLessonResponse(fresh ?? row);
  }

  async healthFields(): Promise<PmLessonHealth> {
    const lessons = await this.memory.listAll(PmMemoryKind.LESSON);
    const active = lessons.filter(
      (l) => l.lessonStatus === PmLessonStatus.ACTIVE,
    );
    const deltas = active
      .map((l) => l.evalResult)
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => r.agreementAfter - r.agreementBefore);
    return {
      activeLessons: active.length,
      proposedLessons: lessons.filter(
        (l) => l.lessonStatus === PmLessonStatus.PROPOSED,
      ).length,
      lessonAgreementDelta: deltas.length
        ? Math.round(
            (deltas.reduce((a, b) => a + b, 0) / deltas.length) * 1000,
          ) / 1000
        : null,
    };
  }
}

/**
 * The weekly schedule: on the PM Agent's 10-minute tick cadence, once per IST date on
 * `lessonsWeekday` from `runHourIst`, while `enabled && lessonsEnabled`. The date is claimed
 * with a conditional update before the job runs, so a budget-skipped or failed week is not
 * retried every ten minutes (Run now still works).
 */
@Injectable()
export class PmAgentLessonsScheduler {
  private readonly logger = LoggerService.getInstance(
    PmAgentLessonsScheduler.name,
  );

  constructor(
    private readonly settings: PmAgentSettingsRepository,
    private readonly lessons: PmAgentLessonsService,
  ) {}

  @Cron(PM_RUN_SCHEDULE_CRON)
  async tick(now: Date = new Date()): Promise<void> {
    try {
      const settings = await this.settings.getSingleton();
      if (!isLessonsDue(settings, now)) return;
      const runner = await this.lessons.tryLock();
      if (!runner) return;
      const today = istDate(now);
      const claimed = await this.settings
        .createQueryBuilder()
        .update(PmAgentSettings)
        .set({ lessonsLastRunDate: today })
        .where('id = 1')
        .andWhere(
          '("lessonsLastRunDate" IS NULL OR "lessonsLastRunDate" <> :today)',
          { today },
        )
        .execute();
      if (!claimed.affected) {
        await this.lessons.releaseLock(runner);
        return;
      }
      await this.lessons.runLocked(runner, 'scheduled');
    } catch (error) {
      this.logger.error(
        `[PM_AGENT] Lessons tick failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
