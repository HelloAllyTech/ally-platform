import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import {
  JUDGE_HTTP_TIMEOUT_MS,
  resolveJudgeConcurrency,
  runWithConcurrency,
  withJudgeSlot,
} from '../util/judge-concurrency.util';
import { DebriefQualityBackfillJobDto } from '../dto/platform-analytics.dto';
import {
  JudgeAttemptFamily,
  JudgeAttemptOutcome,
} from '../constants/judge-scheduling.constants';
import { DEBRIEF_QUALITY_DIMENSIONS } from '../constants/debrief-quality.constants';
import { JudgeAttemptRepository } from '../repository/judge-attempt.repository';
import { ScheduledSelection } from '../util/judge-attempts.util';
import {
  DebriefDimensionScore,
  DebriefHardFail,
  DebriefQualityRepository,
  DebriefTranscriptTurn,
} from '../repository/debrief-quality.repository';

interface JudgeResult {
  judgeModel: string;
  judgePromptVersion: string;
  dimensions: DebriefDimensionScore[];
  hardFails: DebriefHardFail[];
}

/** Today's debriefs are all written by the single scenario-evaluation call. */
const LEGACY_GENERATOR = 'scenario_evaluation';

/**
 * Owns debrief-quality judging end to end: selects sessions with a debrief,
 * renders the debrief the learner read and the numbered transcript, calls
 * ally-ai's stateless judge, and persists the scores. ally-ai never touches
 * this database.
 *
 * Same shape as the groundedness judge, including job state in Redis (ally-be
 * is load-balanced, so the POST that starts a job and the GET that polls it can
 * land on different instances) and the attempt ledger for failures.
 */
@Injectable()
export class DebriefQualityJudgeService {
  private readonly logger = LoggerService.getInstance(
    DebriefQualityJudgeService.name,
  );

  private static readonly JOB_TTL_SECONDS = 3600;

  constructor(
    private readonly repo: DebriefQualityRepository,
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
    private readonly attempts: JudgeAttemptRepository,
  ) {}

  private jobKey(jobId: string): string {
    return `debrief-quality:backfill:job:${jobId}`;
  }

  private async saveJob(job: DebriefQualityBackfillJobDto): Promise<void> {
    await this.redis.set(
      this.jobKey(job.jobId),
      JSON.stringify(job),
      DebriefQualityJudgeService.JOB_TTL_SECONDS,
    );
  }

  async getJob(
    jobId: string,
  ): Promise<DebriefQualityBackfillJobDto | undefined> {
    const raw = await this.redis.get(this.jobKey(jobId));
    return raw ? (JSON.parse(raw) as DebriefQualityBackfillJobDto) : undefined;
  }

  /** Start an async backfill over a window; returns a job id to poll. */
  async startBackfill(
    sinceDays = 90,
    unjudgedForVersion?: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null,
    requestedConcurrency?: number | null,
    /** Cap on sessions per run; the drainer passes a chunk that fits a tick. */
    limit?: number | null,
    scheduled?: Pick<ScheduledSelection, 'honourAttemptLedger'> | null,
  ): Promise<DebriefQualityBackfillJobDto> {
    const concurrency = resolveJudgeConcurrency(requestedConcurrency);
    const job: DebriefQualityBackfillJobDto = {
      jobId: randomUUID(),
      status: 'queued',
      total: 0,
      processed: 0,
      judged: 0,
      skipped: 0,
      failed: 0,
      hardFailed: 0,
      error: null,
    };
    await this.saveJob(job);
    void this.runJob(
      job,
      sinceDays,
      unjudgedForVersion ?? null,
      concurrency,
      limit ?? null,
      scheduled?.honourAttemptLedger ?? false,
    );
    return { ...job };
  }

  private async runJob(
    job: DebriefQualityBackfillJobDto,
    sinceDays: number,
    unjudgedForVersion: {
      judgeModel: string;
      judgePromptVersion: string;
    } | null,
    concurrency: number,
    limit: number | null,
    honourAttemptLedger: boolean,
  ): Promise<void> {
    try {
      const rubric = await this.repo.fetchRubric();
      const sessions = await this.repo.selectSessions({
        sinceDays,
        unjudgedForVersion,
        limit,
        honourAttemptLedger,
      });
      job.status = 'running';
      job.total = sessions.length;
      await this.saveJob(job);

      await runWithConcurrency(sessions, concurrency, async (s) => {
        try {
          const { turns, turnByMessageId } = await this.repo.buildTranscript(
            s.id,
          );
          const debrief = await this.repo.buildDebrief(s.id, turnByMessageId);

          // Nothing to score, or nothing to score it against. Skipped, not
          // scored: a missing debrief must not read as a poor one.
          if (!debrief || turns.length === 0) {
            job.skipped += 1;
            job.processed += 1;
            await this.saveJob(job);
            return;
          }

          const judged = await this.judgeViaAi(
            turns,
            debrief.text,
            s.language,
            s.worker_type,
            rubric,
            s.id,
          );

          // ally-ai answers 200 with no dimensions when the model's answer was
          // unusable. Counting that as judged would leave the session
          // unjudged under NOT EXISTS and at the head of the queue every tick.
          if (judged.dimensions.length !== DEBRIEF_QUALITY_DIMENSIONS.length) {
            await this.attempts.recordFailure(
              JudgeAttemptFamily.DEBRIEF_QUALITY,
              s.id,
              s.tenant_id,
              JudgeAttemptOutcome.EMPTY,
              'judge returned no complete score',
            );
            job.failed += 1;
            job.processed += 1;
            await this.saveJob(job);
            return;
          }

          await this.repo.upsertJudgment(
            s,
            { ...debrief, generator: LEGACY_GENERATOR },
            judged.dimensions,
            judged.hardFails,
            judged.judgeModel,
            judged.judgePromptVersion,
          );
          await this.attempts.clear(JudgeAttemptFamily.DEBRIEF_QUALITY, s.id);

          job.judged += 1;
          if (judged.hardFails.length > 0) job.hardFailed += 1;
          job.processed += 1;
          await this.saveJob(job);
        } catch (e) {
          // One bad session must not abort a run.
          this.logger.error(
            `debrief quality: session ${s.id} failed: ${(e as Error).message}`,
          );
          await this.attempts.recordFailure(
            JudgeAttemptFamily.DEBRIEF_QUALITY,
            s.id,
            s.tenant_id,
            JudgeAttemptOutcome.FAILED,
            e,
          );
          job.failed += 1;
          job.processed += 1;
          await this.saveJob(job);
        }
      });

      job.status = 'done';
      await this.saveJob(job);
    } catch (e) {
      this.logger.error(
        `debrief quality job ${job.jobId} failed: ${(e as Error).message}`,
      );
      job.status = 'error';
      job.error = (e as Error).message;
      await this.saveJob(job);
    }
  }

  /** Call ally-ai's stateless debrief-quality judge over HTTP. */
  private async judgeViaAi(
    transcript: DebriefTranscriptTurn[],
    debrief: string,
    language: string,
    learnerLevel: string,
    rubric: string | null,
    scenarioSessionId: string,
  ): Promise<JudgeResult> {
    const { apiUrl, outboundApiKey } = this.config.ai;
    // Held inside the GLOBAL judge slot, shared with every other judge.
    const res = await withJudgeSlot(() =>
      axios.post(
        `${apiUrl}/api/v1/debrief-quality/judge`,
        {
          transcript,
          debrief,
          language,
          learner_level: learnerLevel,
          rubric,
          scenario_session_id: scenarioSessionId,
        },
        {
          headers: { 'x-api-key': outboundApiKey },
          timeout: JUDGE_HTTP_TIMEOUT_MS,
        },
      ),
    );
    const d = res.data as {
      judge_model: string;
      judge_prompt_version: string;
      dimensions: DebriefDimensionScore[];
      hard_fails: DebriefHardFail[];
    };
    return {
      judgeModel: d.judge_model,
      judgePromptVersion: d.judge_prompt_version,
      dimensions: d.dimensions ?? [],
      hardFails: d.hard_fails ?? [],
    };
  }
}
