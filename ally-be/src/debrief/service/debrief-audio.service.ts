import { createHash } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

/**
 * Read-aloud (v9 FR-29): one card's audio, generated on the first tap and
 * cached in the private audio bucket under the session, keyed by the exact
 * text and voice — so a second play makes no TTS call, and a corrected card
 * gets new audio. A card the Ally team removed is never read.
 */
@Injectable()
export class DebriefAudioService {
  constructor(
    @InjectRepository(DebriefFeedback)
    private readonly feedbackRows: Repository<DebriefFeedback>,
    private readonly feedback: DebriefFeedbackService,
    private readonly s3: S3Service,
    private readonly config: AppConfigService,
    private readonly usage: LlmUsageService,
  ) {}

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
    const key = `debrief-audio/${sessionId}/${hash}.mp3`;

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
