import { createHash } from 'crypto';
import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { LlmUsageService } from '../../analytics/service/llm-usage.service';
import { S3Service } from '../../aws/service/s3.service';
import { AppConfigService } from '../../config/config.service';
import { LlmTask } from '../../learn/enum/llm-task.enum';
import { SarvamTTSProvider } from '../../voice-preview/providers/sarvam-tts.provider';
import { DebriefFeedback } from '../entity/debrief-feedback.entity';
import { DebriefFeedbackStatus } from '../enum/debrief-run.enum';
import { DebriefCards } from '../util/debrief-cards.util';
import {
  DebriefFeedbackService,
  sectionText,
} from './debrief-feedback.service';

/** The read-aloud voice: Sarvam bulbul v3, one voice in all five languages. */
export const DEBRIEF_READ_ALOUD_VOICE = {
  provider: 'sarvam',
  model: 'bulbul:v3',
  speaker: 'priya',
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A signed link lives long enough to play a whole debrief. */
const LINK_SECONDS = 60 * 60;

/** BCP-47 tags Sarvam reads; anything else is read as Indian English. */
const SARVAM_LANGUAGE: Record<string, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  kn: 'kn-IN',
  mr: 'mr-IN',
  ta: 'ta-IN',
};

/** Where a session's read-aloud audio lives in the private audio bucket. */
export const DEBRIEF_AUDIO_PREFIX = 'debrief-audio/';
export const debriefAudioPrefix = (sessionId: string): string =>
  `${DEBRIEF_AUDIO_PREFIX}${sessionId}/`;

/**
 * Read-aloud (v9 FR-29): one card's audio, generated on the first tap and
 * cached in the private audio bucket under the session, keyed by the exact
 * text and voice — so a second play makes no TTS call, and a corrected card
 * gets new audio. A card the Ally team removed is never read.
 */
@Injectable()
export class DebriefAudioService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(DebriefAudioService.name);

  constructor(
    @InjectRepository(DebriefFeedback)
    private readonly feedbackRows: Repository<DebriefFeedback>,
    private readonly feedback: DebriefFeedbackService,
    private readonly s3: S3Service,
    private readonly config: AppConfigService,
    private readonly usage: LlmUsageService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    // Debrief › Settings › Schedules: when this runs is data (debrief_schedules).
    scheduledTaskRegistry.registerConfigurable(
      'debrief-audio-retention',
      async () => {
        const n = await this.sweepDeletedSessions();
        return `${n} deleted session(s)' audio removed`;
      },
    );
  }

  /** Delete every cached read-aloud file of one session. */
  async deleteSessionAudio(sessionId: string): Promise<number> {
    const bucket = this.config.s3.audioBucket as string;
    const { keys } = await this.s3.listObjects({
      bucket,
      prefix: debriefAudioPrefix(sessionId),
    });
    for (const key of keys) await this.s3.deleteObject({ bucket, key });
    return keys.length;
  }

  /**
   * Plan §13: deleting a session deletes its debrief, versions, audio and
   * flags. The rows go with the session (foreign keys cascade); its audio
   * is in S3, so this removes the audio of every session that no longer
   * exists, however it was deleted. Returns how many sessions it cleared.
   */
  async sweepDeletedSessions(): Promise<number> {
    const bucket = this.config.s3.audioBucket as string;
    if (!bucket) return 0;
    const { prefixes } = await this.s3.listObjects({
      bucket,
      prefix: DEBRIEF_AUDIO_PREFIX,
      delimiter: '/',
    });
    const ids = prefixes
      .map((p) => p.slice(DEBRIEF_AUDIO_PREFIX.length).replace(/\/$/, ''))
      .filter((id) => UUID.test(id));
    if (!ids.length) return 0;
    const alive: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id::text AS id FROM scenario_sessions WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    const kept = new Set(alive.map((r) => r.id));
    let cleared = 0;
    for (const id of ids.filter((x) => !kept.has(x))) {
      try {
        const n = await this.deleteSessionAudio(id);
        cleared++;
        this.logger.info(
          `[debrief] removed ${n} audio file(s) of deleted session ${id}`,
        );
      } catch (e) {
        this.logger.warn(
          `[debrief] could not remove audio of deleted session ${id}: ${(e as Error).message}`,
        );
      }
    }
    return cleared;
  }

  async audioUrl(
    sessionId: string,
    userId: number,
    section: string,
  ): Promise<{ url: string; cached: boolean }> {
    const run = await this.feedback.ownLiveRun(sessionId, userId);
    const removed = await this.feedbackRows.findOne({
      where: {
        runId: run.id,
        section,
        status: DebriefFeedbackStatus.REMOVED,
      },
    });
    const text = removed
      ? null
      : sectionText(run.cards as unknown as DebriefCards, section);
    if (!text) throw new NotFoundException('There is no such card to read');

    const bucket = this.config.s3.audioBucket as string;
    const language =
      SARVAM_LANGUAGE[(run.language ?? 'en').slice(0, 2).toLowerCase()] ??
      'en-IN';
    const hash = createHash('sha256')
      .update(
        `${DEBRIEF_READ_ALOUD_VOICE.model}|${DEBRIEF_READ_ALOUD_VOICE.speaker}|${language}|${text}`,
      )
      .digest('hex')
      .slice(0, 24);
    const key = `${debriefAudioPrefix(sessionId)}${hash}.mp3`;

    let cached = true;
    try {
      await this.s3.getHeadObject({ bucket, key });
    } catch {
      cached = false;
      const audio = await new SarvamTTSProvider(
        this.config.voicePreview.sarvamApiKey as string,
        {
          model: DEBRIEF_READ_ALOUD_VOICE.model,
          speaker: DEBRIEF_READ_ALOUD_VOICE.speaker,
        },
      ).generatePreview(text, language);
      await this.s3.uploadStream({
        Bucket: bucket,
        Key: key,
        Body: audio,
        ContentType: 'audio/mpeg',
      });
      void this.usage.record({
        service: 'tts',
        provider: DEBRIEF_READ_ALOUD_VOICE.provider,
        model: DEBRIEF_READ_ALOUD_VOICE.model,
        task: LlmTask.DEBRIEF_READ_ALOUD,
        characters: text.length,
        tenantId: run.tenantId ?? undefined,
        scenarioSessionId: sessionId,
        metadata: { runId: run.id, section },
      });
    }
    const url = await this.s3.generatePresignedUrl({
      bucket,
      key,
      operation: 'get',
      expiresIn: LINK_SECONDS,
    });
    return { url, cached };
  }
}
