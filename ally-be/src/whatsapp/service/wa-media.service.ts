import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiService } from '../../ai/service/ai.service';
import { S3Service } from '../../aws/service/s3.service';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { replyLanguageOf } from '../../chatbot/engine/reply-language';
import { WaHandledBy } from '../enum/whatsapp.enum';
import { WA_MEDIA_PREFIX, type WaAttachment } from '../media/wa-attachment';
import {
  InboundWhatsAppMessage,
  WHATSAPP_PROVIDER,
  WaNumberCredentials,
  WhatsAppProvider,
} from '../type/whatsapp-provider.interface';
import { FILE_NOT_READ, VOICE_NOTE_FAILED } from '../wa-a-copy';

/** What the inbound pipeline does with a message that carries a file. */
export type MediaOutcome =
  /** Answer it like a typed message, with these words (a transcript or a caption). */
  | { kind: 'text'; text: string }
  /** Reply with this fixed line and stop (a failed voice note; a file with no words). */
  | { kind: 'reply'; body: string; handledBy: WaHandledBy };

const EXTENSIONS: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const extensionOf = (mimeType: string): string =>
  EXTENSIONS[mimeType.split(';')[0].trim().toLowerCase()] ?? 'bin';

/**
 * WA-A §1–2: voice notes, images and documents on WhatsApp.
 *
 * Every file is downloaded from Meta and kept in the private audio bucket (`wa-media/`), and put
 * on the person's message so the team sees it in the Inbox; it goes with the conversation's
 * retention. A voice note is transcribed by a speech provider (ally-ai) and its transcript is
 * then answered exactly like a typed message: the crisis check first, then the agent. The audio
 * never reaches a language model. A note that can't be transcribed, or is over 2 minutes, gets
 * one fixed line in the person's language asking them to type it; the message is never dropped.
 * An image or document with a caption is answered from the caption; without one, a fixed line
 * says the assistant can't read files yet. No image is sent to a model.
 */
@Injectable()
export class WaMediaService {
  private readonly logger = LoggerService.getInstance(WaMediaService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    private readonly ai: AiService,
    @Optional() private readonly s3?: S3Service,
    @Optional() private readonly appConfig?: AppConfigService,
  ) {}

  async receive(input: {
    inbound: InboundWhatsAppMessage;
    inboundId: string;
    chatbotId: string;
    conversationId: string;
    creds: WaNumberCredentials | null;
    locale?: string | null;
    /** The shared store's copy of the message; the attachment is written once it lands. */
    copied?: Promise<boolean>;
  }): Promise<MediaOutcome | null> {
    const { inbound } = input;
    const media = inbound.media;
    if (!media) return null;
    const attachment: WaAttachment = {
      kind: media.kind,
      mimeType: media.mimeType,
      mediaId: media.id,
      ...(media.filename ? { filename: media.filename } : {}),
      ...(media.caption ? { caption: media.caption } : {}),
      ...(media.voice ? { voice: true } : {}),
    };

    let file: Buffer | null = null;
    try {
      if (!this.provider.downloadMedia) throw new Error('no media download');
      const downloaded = await this.provider.downloadMedia(
        media.id,
        input.creds ?? undefined,
      );
      file = downloaded.data;
      attachment.mimeType = downloaded.mimeType || media.mimeType;
      attachment.sizeBytes = downloaded.sizeBytes;
      attachment.key = await this.store(input, attachment, file);
    } catch (error) {
      this.logger.warn(
        `WhatsApp ${media.kind} not downloaded for message ${input.inboundId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }

    let outcome: MediaOutcome;
    if (media.kind === 'audio') {
      outcome = await this.transcribe(input, attachment, file);
    } else if (inbound.text.trim()) {
      outcome = { kind: 'text', text: inbound.text.trim() };
    } else {
      outcome = {
        kind: 'reply',
        body: FILE_NOT_READ[replyLanguageOf('', input.locale)],
        handledBy: WaHandledBy.FILE_NOT_READ,
      };
    }
    await this.attach(input, attachment);
    return outcome;
  }

  private async transcribe(
    input: { inboundId: string; locale?: string | null },
    attachment: WaAttachment,
    file: Buffer | null,
  ): Promise<MediaOutcome> {
    const failed = (reason: string): MediaOutcome => {
      attachment.transcriptError = reason;
      return {
        kind: 'reply',
        body: VOICE_NOTE_FAILED[replyLanguageOf('', input.locale)],
        handledBy: WaHandledBy.VOICE_FAILED,
      };
    };
    if (!file) return failed('download_failed');
    try {
      const result = await this.ai.transcribeVoiceNote(
        file,
        attachment.mimeType,
      );
      attachment.durationSec = result.duration_sec ?? null;
      if (result.status === 'too_long') return failed('too_long');
      const transcript = (result.transcript ?? '').trim();
      if (result.status !== 'ok' || !transcript) return failed('failed');
      attachment.transcript = transcript.slice(0, 4000);
      attachment.language = result.language ?? null;
      return { kind: 'text', text: attachment.transcript };
    } catch (error) {
      this.logger.warn(
        `Voice note not transcribed for message ${input.inboundId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return failed('failed');
    }
  }

  /** The file in the private bucket; null when there's no bucket (the message is still kept). */
  private async store(
    input: { inboundId: string; chatbotId: string; conversationId: string },
    attachment: WaAttachment,
    file: Buffer,
  ): Promise<string | null> {
    const bucket = this.appConfig?.s3.audioBucket;
    if (!bucket || !this.s3) return null;
    const key =
      `${WA_MEDIA_PREFIX}${input.chatbotId}/${input.conversationId}/` +
      `${input.inboundId}.${extensionOf(attachment.mimeType)}`;
    await this.s3.uploadStream({
      Bucket: bucket,
      Key: key,
      Body: file,
      ContentType: attachment.mimeType.split(';')[0].trim(),
    });
    return key;
  }

  /**
   * The file on the person's message in the shared store (the Inbox reads it), once the copy has
   * landed; `chatbot_messages` shares the WhatsApp row's id. Never throws.
   */
  private async attach(
    input: { inboundId: string; copied?: Promise<boolean> },
    attachment: WaAttachment,
  ): Promise<void> {
    try {
      const copied = input.copied ? await input.copied : false;
      if (!copied) return;
      await this.dataSource.query(
        `UPDATE chatbot_messages SET attachments = $2::jsonb WHERE id = $1`,
        [input.inboundId, JSON.stringify([attachment])],
      );
    } catch (error) {
      this.logger.warn(
        `Attachment not recorded for message ${input.inboundId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }
}
