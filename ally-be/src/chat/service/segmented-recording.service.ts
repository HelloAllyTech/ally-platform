import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LoggerService } from '../../logger/logger.service';
import { S3Service } from '../../aws/service/s3.service';
import { AppConfigService } from '../../config/config.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AiEventService } from '../../ai/service/ai-event.service';
import { ChatService } from './chat.service';
import { ChatAudioUploadsService } from '../../audio/service/chat-audio-uploads.service';
import { ChatStatus, ChatSummaryStatus } from '../entity/chat.entity';
import {
  AudioChatPlatform,
  AudioChatProvider,
  ScribeSessionMode,
} from '../../common/constants/chat.constants';
import { ChatAudioUploadStatus } from '../../audio/entity/chat-audio-uploads.entity';
import { StreamEndReason } from '../constants/chat.constants';

const execFileAsync = promisify(execFile);

/** Audio formats the clients record segments in, by what each records natively. */
export const SEGMENT_FORMATS = {
  // Browser MediaRecorder: restarted every segment, so each file stands alone.
  webm: { contentTypes: ['audio/webm'], ext: 'webm' },
  // Mobile (AAC in MP4).
  m4a: {
    contentTypes: ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac'],
    ext: 'm4a',
  },
  wav: { contentTypes: ['audio/wav', 'audio/x-wav'], ext: 'wav' },
} as const;
export type SegmentFormat = keyof typeof SEGMENT_FORMATS;

/** How long each segment is (seconds). Clients follow what start() returns. */
export const SEGMENT_SECONDS = 30;
/** 2,880 segments = 24 hours: anything past that is a client bug, not a session. */
export const MAX_SEGMENTS = 2880;
/** A recording with no new segment for this long, and no finalize, is finished by the janitor. */
const ABANDONED_AFTER_MS = 15 * 60 * 1000;
/** A join claimed this long ago without finishing is assumed dead and may be retried. */
const JOIN_STALE_MS = 15 * 60 * 1000;
const MAX_JOIN_ATTEMPTS = 3;
/** ffmpeg budget for joining one recording. */
const JOIN_TIMEOUT_MS = 10 * 60 * 1000;

type JoinState = 'pending' | 'joining' | 'joined' | 'failed' | 'empty';

/** What `chats.metadata.segmented` holds for a segmented recording. */
export interface SegmentedMeta {
  format: SegmentFormat;
  segmentSeconds: number;
  startedAt: string;
  lastSegmentAt?: string;
  segmentCount?: number;
  missing?: number[];
  joinState?: JoinState;
  joinClaimedAt?: string;
  joinAttempts?: number;
  joinedKey?: string;
  joinError?: string;
}

/**
 * Segmented recording (Scribe v2 phase 5, docs/scribe-v2/DESIGN.md §4).
 *
 * The client records in ~30 s segments and uploads each one straight to S3 with
 * a presigned URL; no server holds the audio. Stop calls finalize with the
 * segment count, and the server joins the segments into one file and hands it
 * to transcription exactly like an uploaded recording. A deploy, a crash or a
 * dropped connection loses nothing: segments already uploaded are in S3, and
 * the client retries the rest.
 *
 * Every state change is a conditional UPDATE, so the two app colours of a
 * blue/green deploy (or a retried request) can't both end or join one chat.
 */
@Injectable()
export class SegmentedRecordingService {
  private readonly logger = LoggerService.getInstance(
    SegmentedRecordingService.name,
  );

  constructor(
    private readonly chatService: ChatService,
    private readonly s3Service: S3Service,
    private readonly config: AppConfigService,
    private readonly aiEventService: AiEventService,
    private readonly chatAudioUploadsService: ChatAudioUploadsService,
    private readonly dataSource: DataSource,
  ) {}

  private get bucket(): string {
    return this.config.s3.audioBucket!;
  }

  static segmentPrefix(chatId: number): string {
    return `scribe-segments/${chatId}/`;
  }

  static segmentKey(
    chatId: number,
    index: number,
    format: SegmentFormat,
  ): string {
    return `${SegmentedRecordingService.segmentPrefix(chatId)}${String(index).padStart(5, '0')}.${SEGMENT_FORMATS[format].ext}`;
  }

  /** Segment index from a key written by segmentKey; null for anything else. */
  static indexOfKey(key: string): number | null {
    const m = /\/(\d{5})\.[a-z0-9]+$/.exec(key);
    return m ? Number(m[1]) : null;
  }

  // ------------------------------------------------------------------ start

  async start(
    userId: number,
    params: { platform: AudioChatPlatform; format: SegmentFormat },
  ): Promise<{ chatId: number; segmentSeconds: number; maxSegments: number }> {
    if (!SEGMENT_FORMATS[params.format]) {
      throw new BadRequestException(
        `Unsupported segment format ${params.format}`,
      );
    }
    // Same rule as the live socket: one recording at a time per counsellor.
    const active = await this.chatService.getChatsByCouncilorId(userId, {
      status: ChatStatus.ACTIVE,
    });
    if (active) {
      throw new ConflictException({
        message: 'You already have a recording in progress',
        chatId: (active as { id?: number }).id,
      });
    }
    const chat = await this.chatService.createChatForAnonymousClient({
      counselorId: userId,
      provider: AudioChatProvider.MICROPHONE,
      platform: params.platform,
      mode: ScribeSessionMode.SCRIBE,
      status: ChatStatus.ACTIVE,
      startedAt: new Date(),
    });
    if (!chat) throw new Error('Failed to create chat');

    const meta: SegmentedMeta = {
      format: params.format,
      segmentSeconds: SEGMENT_SECONDS,
      startedAt: new Date().toISOString(),
    };
    await this.patchMeta(chat.id, meta);
    this.logger.info(
      `Segmented recording started | chat ${chat.id} | user ${userId} | ${params.platform} ${params.format}`,
    );
    return {
      chatId: chat.id,
      segmentSeconds: SEGMENT_SECONDS,
      maxSegments: MAX_SEGMENTS,
    };
  }

  // ------------------------------------------------------------- segments

  async segmentUploadUrl(
    userId: number,
    chatId: number,
    index: number,
    contentType: string,
  ): Promise<{ url: string; key: string; expiresIn: number }> {
    if (!Number.isInteger(index) || index < 0 || index >= MAX_SEGMENTS) {
      throw new BadRequestException(
        `Segment index must be 0–${MAX_SEGMENTS - 1}`,
      );
    }
    const { chat, meta } = await this.ownRecording(userId, chatId);
    if (chat.status !== ChatStatus.ACTIVE) {
      throw new ConflictException('This recording has already been finished');
    }
    const allowed = SEGMENT_FORMATS[meta.format]
      .contentTypes as readonly string[];
    const type = (contentType || '').split(';')[0].trim().toLowerCase();
    if (!allowed.includes(type)) {
      throw new BadRequestException(
        `Segments of a ${meta.format} recording must be ${allowed.join(' or ')}`,
      );
    }
    const key = SegmentedRecordingService.segmentKey(
      chatId,
      index,
      meta.format,
    );
    const expiresIn = 15 * 60;
    const url = await this.s3Service.generatePresignedUrl({
      bucket: this.bucket,
      key,
      operation: 'put',
      contentType: type,
      expiresIn,
    });
    // The janitor finishes recordings that stop asking for segment URLs.
    await this.dataSource.query(
      `UPDATE chats SET metadata = jsonb_set(metadata, '{segmented,lastSegmentAt}', to_jsonb($2::text))
        WHERE id = $1 AND metadata ? 'segmented'`,
      [chatId, new Date().toISOString()],
    );
    return { url, key, expiresIn };
  }

  // -------------------------------------------------------------- finalize

  /**
   * End the recording and start its transcription. Idempotent: a repeat after
   * success returns the same state. Missing segments are reported (409 with
   * their indexes) so the client can upload them; with `allowPartial` the
   * recording is finished with what arrived and flagged incomplete.
   */
  async finalize(
    userId: number,
    chatId: number,
    body: {
      segmentCount: number;
      durationSeconds?: number;
      allowPartial?: boolean;
    },
  ): Promise<{ status: 'finalized' | 'already-finalized'; missing: number[] }> {
    const { chat, meta } = await this.ownRecording(userId, chatId);
    if (chat.status !== ChatStatus.ACTIVE) {
      return { status: 'already-finalized', missing: meta.missing ?? [] };
    }
    if (
      !Number.isInteger(body.segmentCount) ||
      body.segmentCount < 0 ||
      body.segmentCount > MAX_SEGMENTS
    ) {
      throw new BadRequestException(`segmentCount must be 0–${MAX_SEGMENTS}`);
    }
    const present = await this.presentIndexes(chatId);
    const missing = [];
    for (let i = 0; i < body.segmentCount; i++)
      if (!present.has(i)) missing.push(i);
    if (missing.length && !body.allowPartial) {
      throw new ConflictException({
        message: `${missing.length} segment(s) have not arrived yet`,
        missing,
      });
    }
    const ended = await this.end(chatId, {
      segmentCount: body.segmentCount,
      missing,
      durationSeconds: body.durationSeconds,
      reason: missing.length
        ? StreamEndReason.CLIENT_DISCONNECT
        : StreamEndReason.COMPLETED,
    });
    if (!ended) return { status: 'already-finalized', missing };
    void this.joinAndTranscribe(chatId).catch(() => undefined);
    return { status: 'finalized', missing };
  }

  /** ACTIVE → ENDED, once (conditional), plus the recording's end facts. */
  private async end(
    chatId: number,
    facts: {
      segmentCount: number;
      missing: number[];
      durationSeconds?: number;
      reason: StreamEndReason;
    },
  ): Promise<boolean> {
    const rows: Array<{ id: number }> = await this.dataSource.query(
      `UPDATE chats SET status = $2, "endedAt" = now()
        WHERE id = $1 AND status = $3 RETURNING id`,
      [chatId, ChatStatus.ENDED, ChatStatus.ACTIVE],
    );
    if (!rows.length) return false;

    const incomplete =
      facts.missing.length > 0 || facts.reason !== StreamEndReason.COMPLETED;
    await this.patchMeta(chatId, {
      segmentCount: facts.segmentCount,
      missing: facts.missing,
      joinState: 'pending',
      joinAttempts: 0,
    } as Partial<SegmentedMeta>);
    await this.dataSource.query(
      `UPDATE chats SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [
        chatId,
        JSON.stringify({
          streamEndReason: facts.reason,
          ...(incomplete
            ? { incompleteRecording: { reason: facts.reason } }
            : {}),
        }),
      ],
    );
    const duration =
      facts.durationSeconds && facts.durationSeconds > 0
        ? Math.round(facts.durationSeconds)
        : undefined;
    await this.chatService.updateCallMetadata(chatId, duration);
    this.logger.info(
      `Segmented recording ended | chat ${chatId} | ${facts.segmentCount} segment(s)` +
        `${facts.missing.length ? ` | missing ${facts.missing.length}` : ''} | ${facts.reason}`,
    );
    return true;
  }

  // ------------------------------------------------------------------ join

  /**
   * Join the segments into one mp3 and send it to transcription. Claims the
   * job with a conditional update, so concurrent callers (finalize, janitor,
   * both deploy colours) run it once. Never throws.
   */
  async joinAndTranscribe(chatId: number): Promise<void> {
    const claimed: Array<{ metadata: Record<string, any> }> =
      await this.dataSource.query(
        `UPDATE chats SET metadata = jsonb_set(
           jsonb_set(jsonb_set(metadata, '{segmented,joinState}', '"joining"'),
                     '{segmented,joinClaimedAt}', to_jsonb(now()::text)),
           '{segmented,joinAttempts}',
           to_jsonb(COALESCE((metadata->'segmented'->>'joinAttempts')::int, 0) + 1))
        WHERE id = $1 AND status = $2 AND metadata ? 'segmented'
          AND (metadata->'segmented'->>'joinState' IN ('pending', 'failed')
               OR (metadata->'segmented'->>'joinState' = 'joining'
                   AND (metadata->'segmented'->>'joinClaimedAt')::timestamptz < now() - ($3 || ' milliseconds')::interval))
        RETURNING metadata`,
        [chatId, ChatStatus.ENDED, String(JOIN_STALE_MS)],
      );
    if (!claimed.length) return;
    const meta = claimed[0].metadata.segmented as SegmentedMeta;
    const chat = await this.chatService.getChatByIdForServiceCall(chatId);
    ExecutionManager.setAuthContext(
      String(chat?.counselorId ?? chat?.createdBy ?? ''),
      chat?.tenantId as string,
    );

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `seg-${chatId}-`));
    try {
      const keys = await this.segmentKeys(chatId);
      if (keys.length === 0) {
        await this.patchMeta(chatId, { joinState: 'empty' });
        await this.chatService.updateChat(chatId, {
          summaryStatus: ChatSummaryStatus.NO_AUDIO,
        });
        this.logger.warn(
          `Segmented recording ${chatId} has no segments: NO_AUDIO`,
        );
        return;
      }
      const inputs: string[] = [];
      for (const key of keys) {
        const file = path.join(workDir, path.basename(key));
        fs.writeFileSync(
          file,
          await this.s3Service.getObjectBuffer({ bucket: this.bucket, key }),
        );
        inputs.push(file);
      }
      const out = path.join(workDir, 'joined.mp3');
      await SegmentedRecordingService.joinWithFfmpeg(inputs, out);

      const joinedKey = `audio-upload/segmented/${chatId}.mp3`;
      await this.s3Service.uploadStream({
        Bucket: this.bucket,
        Key: joinedKey,
        Body: fs.readFileSync(out),
        ContentType: 'audio/mpeg',
        Metadata: {
          chatid: String(chatId),
          provider: AudioChatProvider.MICROPHONE,
        },
      });
      await this.chatAudioUploadsService.createAudioUpload({
        chatId,
        storageKey: joinedKey,
        status: ChatAudioUploadStatus.SUCCESS,
        format: 'mp3',
      });
      const audioUrl = await this.s3Service.generatePresignedUrl({
        bucket: this.bucket,
        key: joinedKey,
        operation: 'get',
        expiresIn: 3600,
        audience: 'internal',
      });
      await this.aiEventService.publishTranscribeAudioEvent({
        message_type: 'transcribe_and_summarize_request',
        chat_id: chatId,
        timestamp: Date.now(),
        audio_url: audioUrl,
        mode: ScribeSessionMode.SCRIBE,
      });
      await this.patchMeta(chatId, {
        joinState: 'joined',
        joinedKey,
        joinError: undefined,
      });
      this.logger.info(
        `Segmented recording ${chatId}: joined ${keys.length} segment(s) and sent to transcription`,
      );
      // The joined file is the recording of record; the segments are spent.
      await Promise.allSettled(
        keys.map((key) =>
          this.s3Service.deleteObject({ bucket: this.bucket, key }),
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = meta.joinAttempts ?? 1;
      const finalFailure = attempts >= MAX_JOIN_ATTEMPTS;
      await this.patchMeta(chatId, {
        joinState: 'failed',
        joinError: message.slice(0, 500),
      });
      if (finalFailure) {
        await this.chatService.updateChat(chatId, {
          summaryStatus: ChatSummaryStatus.FAILED,
        });
      }
      this.logger.error(
        `Segmented recording ${chatId}: join attempt ${attempts} failed${finalFailure ? ' (giving up)' : ''}: ${message}`,
      );
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }

  /** Decode every segment and write one 16 kHz mono mp3 (any input format). */
  static async joinWithFfmpeg(inputs: string[], out: string): Promise<void> {
    const args = ['-y', '-loglevel', 'error'];
    for (const f of inputs) args.push('-i', f);
    const streams = inputs.map((_, i) => `[${i}:a]`).join('');
    args.push(
      '-filter_complex',
      `${streams}concat=n=${inputs.length}:v=0:a=1[a]`,
      '-map',
      '[a]',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '48k',
      out,
    );
    await execFileAsync('ffmpeg', args, {
      timeout: JOIN_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
  }

  // --------------------------------------------------------------- janitor

  /**
   * Every 5 minutes: finish recordings whose client went away without
   * finalizing (with the segments that arrived, flagged incomplete), and retry
   * joins that failed or never ran (a deploy mid-join).
   */
  @Cron('0 */5 * * * *')
  async janitor(): Promise<void> {
    try {
      const abandoned: Array<{
        id: number;
        tenant_id: string;
        counselorId: number;
        segmented: SegmentedMeta;
      }> = await this.dataSource.query(
        `SELECT id, tenant_id, "counselorId", metadata->'segmented' AS segmented FROM chats
            WHERE status = $1 AND metadata ? 'segmented'
              AND COALESCE((metadata->'segmented'->>'lastSegmentAt')::timestamptz,
                           (metadata->'segmented'->>'startedAt')::timestamptz)
                  < now() - ($2 || ' milliseconds')::interval
            LIMIT 50`,
        [ChatStatus.ACTIVE, String(ABANDONED_AFTER_MS)],
      );
      for (const row of abandoned) {
        ExecutionManager.setAuthContext(String(row.counselorId), row.tenant_id);
        const present = await this.presentIndexes(row.id);
        const count = present.size ? Math.max(...present) + 1 : 0;
        const missing = [];
        for (let i = 0; i < count; i++) if (!present.has(i)) missing.push(i);
        const ended = await this.end(row.id, {
          segmentCount: count,
          missing,
          durationSeconds:
            count * (row.segmented?.segmentSeconds ?? SEGMENT_SECONDS),
          reason: StreamEndReason.JANITOR_ORPHAN,
        });
        if (ended) {
          this.logger.warn(
            `Janitor finished abandoned segmented recording ${row.id} (${count} segment(s))`,
          );
          await this.joinAndTranscribe(row.id);
        }
      }

      const unjoined: Array<{ id: number }> = await this.dataSource.query(
        `SELECT id FROM chats
          WHERE status = $1 AND metadata ? 'segmented'
            AND "endedAt" < now() - interval '2 minutes'
            AND (metadata->'segmented'->>'joinState' = 'pending'
                 OR (metadata->'segmented'->>'joinState' = 'failed'
                     AND COALESCE((metadata->'segmented'->>'joinAttempts')::int, 0) < $2)
                 OR (metadata->'segmented'->>'joinState' = 'joining'
                     AND (metadata->'segmented'->>'joinClaimedAt')::timestamptz < now() - ($3 || ' milliseconds')::interval))
          LIMIT 20`,
        [ChatStatus.ENDED, MAX_JOIN_ATTEMPTS, String(JOIN_STALE_MS)],
      );
      for (const row of unjoined) await this.joinAndTranscribe(row.id);
    } catch (error) {
      this.logger.error(
        `Segmented recording janitor failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // --------------------------------------------------------------- helpers

  private async ownRecording(
    userId: number,
    chatId: number,
  ): Promise<{ chat: any; meta: SegmentedMeta }> {
    const chat = await this.chatService.getChatByIdForServiceCall(chatId);
    if (!chat || chat.tenantId !== ExecutionManager.getTenantId()) {
      throw new NotFoundException('Recording not found');
    }
    if (chat.counselorId !== userId) {
      throw new ForbiddenException('This is not your recording');
    }
    const meta = (chat.metadata as Record<string, any> | undefined)
      ?.segmented as SegmentedMeta | undefined;
    if (!meta)
      throw new BadRequestException('This chat is not a segmented recording');
    return { chat, meta };
  }

  private async segmentKeys(chatId: number): Promise<string[]> {
    const { keys } = await this.s3Service.listObjects({
      bucket: this.bucket,
      prefix: SegmentedRecordingService.segmentPrefix(chatId),
    });
    return keys
      .filter((k) => SegmentedRecordingService.indexOfKey(k) !== null)
      .sort(
        (a, b) =>
          (SegmentedRecordingService.indexOfKey(a) as number) -
          (SegmentedRecordingService.indexOfKey(b) as number),
      );
  }

  private async presentIndexes(chatId: number): Promise<Set<number>> {
    const keys = await this.segmentKeys(chatId);
    return new Set(
      keys.map((k) => SegmentedRecordingService.indexOfKey(k) as number),
    );
  }

  /** Merge fields into metadata.segmented (undefined removes a field). */
  private async patchMeta(
    chatId: number,
    patch: Partial<SegmentedMeta>,
  ): Promise<void> {
    const set: Record<string, unknown> = {};
    const remove: string[] = [];
    for (const [k, v] of Object.entries(patch))
      if (v === undefined) remove.push(k);
      else set[k] = v;
    await this.dataSource.query(
      `UPDATE chats SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{segmented}',
           (COALESCE(metadata->'segmented', '{}'::jsonb) || $2::jsonb) - $3::text[])
        WHERE id = $1`,
      [chatId, JSON.stringify(set), remove],
    );
  }
}
