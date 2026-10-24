import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { TokenUser } from 'src/auth/type/auth.types';
import { AppConfigService } from 'src/config/config.service';
import { ErrorCode } from 'src/exception/error-code.enum';
import { LiveKitService } from 'src/livekit/service/livekit.service';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { GuideThread } from '../entity/guide-thread.entity';
import { GuideSettingsService } from '../settings/guide-settings.service';

/**
 * LiveKit room prefix for Ally's voice sessions. The roleplay webhook
 * handlers skip rooms with this prefix (fix/livekit-webhook-guide-rooms), so
 * the roleplay agent is never dispatched into a guide room.
 */
export const GUIDE_VOICE_ROOM_PREFIX = 'guide-';
/** A voice session's token lives this long (plan §7.9: two hours). */
export const GUIDE_VOICE_SESSION_TTL_SECONDS = 2 * 60 * 60;

export interface GuideVoiceSession {
  threadId: string;
  userId: number;
  tenantId: string;
  roomName: string;
  language: string;
  turnMode: 'hands_free' | 'push_to_talk';
  createdAt: string;
}

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const sessionKey = (tokenHash: string) => `guide:voice:session:${tokenHash}`;
const threadKey = (threadId: string) => `guide:voice:thread:${threadId}`;

/**
 * Voice as a transport (plans/ally-guide/plan.md §7.9). The browser joins a
 * LiveKit room; ally-be dispatches the guide's own voice worker into it with
 * a voice-session token. The worker turns speech into text and calls back
 * into ally-be with that token, so a spoken turn runs through exactly the
 * same pipeline — Sentinel, Conductor, orchestrator — as a typed one.
 *
 * The token is bound to one thread, learner and organisation, lasts two
 * hours, and only the newest session per thread is valid: opening voice in
 * a second tab ends the first.
 */
@Injectable()
export class GuideVoiceService {
  private readonly logger = LoggerService.getInstance(GuideVoiceService.name);

  constructor(
    private readonly livekit: LiveKitService,
    private readonly redis: RedisService,
    private readonly settings: GuideSettingsService,
    private readonly config: AppConfigService,
  ) {}

  async startSession(
    thread: GuideThread,
    user: TokenUser,
    input: { turnMode?: 'hands_free' | 'push_to_talk'; language?: string },
  ): Promise<{ token: string; roomName: string; serverUrl: string }> {
    const switches = await this.settings.switches();
    if (
      !switches.voice ||
      !(await this.settings.isGuidedAvailable(thread.trackId, user.tenantId))
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Voice is not available for Ally right now',
        error: 'Forbidden',
        errorCode: ErrorCode.GUIDE_DISABLED,
      });
    }

    const voiceToken = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(voiceToken);
    const roomName = `${GUIDE_VOICE_ROOM_PREFIX}${thread.id.slice(0, 8)}-${randomBytes(4).toString('hex')}`;
    const session: GuideVoiceSession = {
      threadId: thread.id,
      userId: user.id,
      tenantId: user.tenantId,
      roomName,
      language: input.language || thread.languageCode || 'en',
      turnMode: input.turnMode ?? 'hands_free',
      createdAt: new Date().toISOString(),
    };

    // One live session per thread: the previous one's token stops working.
    const previous = await this.redis.get(threadKey(thread.id));
    if (previous) await this.redis.del(sessionKey(previous));
    await this.redis.set(
      sessionKey(tokenHash),
      JSON.stringify(session),
      GUIDE_VOICE_SESSION_TTL_SECONDS,
    );
    await this.redis.set(
      threadKey(thread.id),
      tokenHash,
      GUIDE_VOICE_SESSION_TTL_SECONDS,
    );

    await this.livekit.createRoom({
      name: roomName,
      ttl: 600,
      maxParticipants: 2,
      metadata: { kind: 'ally_guide', threadId: thread.id },
    } as never);
    const access = await this.livekit.generateAccessToken({
      roomName,
      participantIdentity: `learner-${user.id}`,
      participantName: 'learner',
    } as never);
    await this.livekit.agentDispatch(
      roomName,
      this.config.livekit.guideAgentName,
      JSON.stringify({
        kind: 'ally_guide',
        voiceSessionToken: voiceToken,
        language: session.language,
        turnMode: session.turnMode,
      }),
    );
    this.logger.info(
      `Ally voice session opened for thread ${thread.id} in ${roomName}`,
    );
    return {
      token: access.token,
      roomName: access.roomName,
      serverUrl: access.serverUrl ?? '',
    };
  }

  /** The session a worker's token belongs to, or 401. */
  async resolve(token: string): Promise<GuideVoiceSession> {
    if (!token) throw new UnauthorizedException('Voice session token missing');
    const raw = await this.redis.get(sessionKey(hashToken(token)));
    if (!raw) {
      throw new UnauthorizedException('Voice session expired or replaced');
    }
    return JSON.parse(raw) as GuideVoiceSession;
  }

  async end(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    const raw = await this.redis.get(sessionKey(tokenHash));
    if (!raw) return;
    const session = JSON.parse(raw) as GuideVoiceSession;
    await this.redis.del(sessionKey(tokenHash));
    const current = await this.redis.get(threadKey(session.threadId));
    if (current === tokenHash)
      await this.redis.del(threadKey(session.threadId));
  }
}
