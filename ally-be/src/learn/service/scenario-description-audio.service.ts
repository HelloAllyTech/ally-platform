import { createHash } from 'crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  In,
  IsNull,
  LessThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import { LlmUsageService } from '../../analytics/service/llm-usage.service';
import { S3Service } from '../../aws/service/s3.service';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { SarvamTTSProvider } from '../../voice-preview/providers/sarvam-tts.provider';
import { Scenarios } from '../entity/scenarios.entity';
import { LlmTask } from '../enum/llm-task.enum';
import { ScenarioStatus } from '../type/scenario.type';

/** The one narrator for every description: Sarvam bulbul v3, same voice in each language. */
export const SCENARIO_NARRATION_VOICE = {
  provider: 'sarvam',
  model: 'bulbul:v3',
  speaker: 'priya',
} as const;

/** Descriptions are authored in the scenario's base language. */
export const SCENARIO_DESCRIPTION_LANGUAGE = 'en-IN';

/** Failed attempts allowed after the first, each waiting this long: 5 + 15 + 40 min ≈ 1 hour. */
export const NARRATION_RETRY_DELAYS_MINUTES = [5, 15, 40];

const SWEEP_BATCH = 20;

export const narrationHash = (description: string): string =>
  createHash('sha256')
    .update(
      `${SCENARIO_NARRATION_VOICE.model}|${SCENARIO_NARRATION_VOICE.speaker}|${SCENARIO_DESCRIPTION_LANGUAGE}|${description}`,
    )
    .digest('hex')
    .slice(0, 32);

/**
 * Audio narration of a role-play description. Generation is never on the save path: saving marks
 * the scenario "pending" (a durable row state, so it survives a restart) and tries once in the
 * background; the 5-minute scheduler sweep retries what failed, with backoff, and gives up after
 * three retries. The stored hash makes every run idempotent.
 */
@Injectable()
export class ScenarioDescriptionAudioService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    ScenarioDescriptionAudioService.name,
  );

  constructor(
    @InjectRepository(Scenarios)
    private readonly scenarios: Repository<Scenarios>,
    private readonly s3: S3Service,
    private readonly config: AppConfigService,
    private readonly usage: LlmUsageService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      '5min',
      'scenario-description-audio-retry',
      () => this.runRetrySweep(),
    );
  }

  /**
   * Called after a scenario is created or updated. Does nothing unless the scenario is active and
   * the description differs from what the stored audio was made from. Never throws.
   */
  async onScenarioSaved(
    scenarioId: number,
    manager?: EntityManager,
  ): Promise<void> {
    try {
      // Inside a caller's open transaction the row is locked: read and mark through it, and leave
      // the synthesis to the 5-minute sweep, which sees the row once the transaction commits.
      const repo = manager ? manager.getRepository(Scenarios) : this.scenarios;
      const s = await repo.findOne({ where: { id: scenarioId } });
      if (!s) return;
      const text = s.description?.trim();
      if (s.status !== ScenarioStatus.ACTIVE || !text) {
        if (s.descriptionAudioUrl || s.descriptionAudioNextAttemptAt) {
          await this.clear(scenarioId, repo);
        }
        return;
      }
      if (
        s.descriptionAudioHash === narrationHash(text) &&
        s.descriptionAudioUrl
      ) {
        return;
      }
      // The old audio no longer matches the text: hide it now and queue a fresh one.
      await repo.update(scenarioId, {
        descriptionAudioUrl: null,
        descriptionAudioAttempts: 0,
        descriptionAudioNextAttemptAt: new Date(),
      });
      if (!manager) void this.generate(scenarioId);
    } catch (error) {
      this.logger.error(
        `Could not queue description narration for scenario ${scenarioId}: ${(error as Error).message}`,
      );
    }
  }

  private async missing(): Promise<Scenarios[]> {
    const rows = await this.scenarios.find({
      select: [
        'id',
        'description',
        'descriptionAudioHash',
        'descriptionAudioUrl',
      ],
      where: { status: ScenarioStatus.ACTIVE, description: Not(IsNull()) },
    });
    return rows.filter(
      (r) =>
        r.description?.trim() &&
        !(
          r.descriptionAudioUrl &&
          r.descriptionAudioHash === narrationHash(r.description.trim())
        ),
    );
  }

  async countMissing(): Promise<number> {
    return (await this.missing()).length;
  }

  /** Generates one sweep batch now; used by the backfill script. */
  async drainBatch(): Promise<{
    done: number;
    failed: number;
    remaining: number;
  }> {
    const due = await this.scenarios.find({
      select: ['id'],
      where: { descriptionAudioNextAttemptAt: LessThanOrEqual(new Date()) },
      order: { descriptionAudioNextAttemptAt: 'ASC' },
      take: SWEEP_BATCH,
    });
    let done = 0;
    for (const { id } of due) if (await this.generate(id)) done++;
    const remaining = await this.scenarios.count({
      where: { descriptionAudioNextAttemptAt: LessThanOrEqual(new Date()) },
    });
    return { done, failed: due.length - done, remaining };
  }

  /** Marks every active scenario without current audio as pending. */
  async queueBackfill(): Promise<number> {
    const due = await this.missing();
    for (let i = 0; i < due.length; i += 500) {
      await this.scenarios.update(
        { id: In(due.slice(i, i + 500).map((r) => r.id)) },
        {
          descriptionAudioAttempts: 0,
          descriptionAudioNextAttemptAt: new Date(),
        },
      );
    }
    return due.length;
  }

  async runRetrySweep(): Promise<void> {
    const due = await this.scenarios.find({
      select: ['id'],
      where: { descriptionAudioNextAttemptAt: LessThanOrEqual(new Date()) },
      order: { descriptionAudioNextAttemptAt: 'ASC' },
      take: SWEEP_BATCH,
    });
    for (const { id } of due) await this.generate(id);
  }

  /** One attempt. Records success, or schedules the next retry. Never throws. */
  async generate(scenarioId: number): Promise<boolean> {
    const s = await this.scenarios.findOne({ where: { id: scenarioId } });
    if (!s) return false;
    const text = s.description?.trim();
    if (s.status !== ScenarioStatus.ACTIVE || !text) {
      await this.clear(scenarioId);
      return false;
    }
    const hash = narrationHash(text);
    if (s.descriptionAudioUrl && s.descriptionAudioHash === hash) {
      await this.scenarios.update(scenarioId, {
        descriptionAudioNextAttemptAt: null,
      });
      return true;
    }
    try {
      const bucket = this.config.s3.assetsBucket;
      if (!bucket) throw new Error('S3_ASSETS_BUCKET is not defined');
      const audio = await new SarvamTTSProvider(
        this.config.voicePreview.sarvamApiKey as string,
        {
          model: SCENARIO_NARRATION_VOICE.model,
          speaker: SCENARIO_NARRATION_VOICE.speaker,
        },
      ).generatePreview(text, SCENARIO_DESCRIPTION_LANGUAGE);
      const key = `scenario-description-audio/${scenarioId}/${hash}.mp3`;
      await this.s3.uploadStream({
        Bucket: bucket,
        Key: key,
        Body: audio,
        ContentType: 'audio/mpeg',
      });
      const url = `https://${bucket}.s3.${this.config.aws.region}.amazonaws.com/${key}`;
      // Only keep the result if the description did not change while we were synthesising.
      const fresh = await this.scenarios.findOne({
        select: ['id', 'description'],
        where: { id: scenarioId },
      });
      if (fresh?.description?.trim() !== text) return false;
      await this.scenarios.update(scenarioId, {
        descriptionAudioUrl: url,
        descriptionAudioHash: hash,
        descriptionAudioAttempts: 0,
        descriptionAudioNextAttemptAt: null,
      });
      void this.usage.record({
        service: 'tts',
        provider: SCENARIO_NARRATION_VOICE.provider,
        model: SCENARIO_NARRATION_VOICE.model,
        task: LlmTask.SCENARIO_DESCRIPTION_NARRATION,
        characters: text.length,
        metadata: { scenarioId },
      });
      return true;
    } catch (error) {
      const attempts = (s.descriptionAudioAttempts ?? 0) + 1;
      const delay = NARRATION_RETRY_DELAYS_MINUTES[attempts - 1];
      this.logger.warn(
        `Description narration failed for scenario ${scenarioId} (attempt ${attempts}): ${(error as Error).message}`,
      );
      await this.scenarios.update(scenarioId, {
        descriptionAudioAttempts: attempts,
        descriptionAudioNextAttemptAt: delay
          ? new Date(Date.now() + delay * 60_000)
          : null,
      });
      return false;
    }
  }

  private async clear(
    scenarioId: number,
    repo: Repository<Scenarios> = this.scenarios,
  ): Promise<void> {
    await repo.update(scenarioId, {
      descriptionAudioUrl: null,
      descriptionAudioHash: null,
      descriptionAudioAttempts: 0,
      descriptionAudioNextAttemptAt: null,
    });
  }
}
