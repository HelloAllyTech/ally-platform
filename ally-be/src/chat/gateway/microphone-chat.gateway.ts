import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { LoggerService } from '../../logger/logger.service';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ChatService } from '../service/chat.service';
import {
  AudioChatPlatform,
  AudioChatProvider,
  ScribeSessionMode,
} from '../../common/constants/chat.constants';
import {
  PLACEHOLDER_CHAT_ID,
  UserRole,
} from '../../common/constants/user.constants';
import { MessagePayload, UserChatSessionData } from '../type/chat.type';
import { ChatEvents, StreamEndReason } from '../constants/chat.constants';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from '../../common/decorator/execution.context.decorator';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { StreamFileProcessorService } from '../../audio/service/stream-file-processor.service';
import { MessageBrokerService } from '../../message-broker/service/message-broker.service';
import { MessageBrokerChannel } from '../../message-broker/constants/message-broker.constants';
import { Message, MessageType } from '../entity/message.entity';
import { ChatStatus } from '../entity/chat.entity';
import { BroadcastMessageService } from '../../audio/service/broadcast-message.service';
import { WebSocketAuthMiddleware } from 'src/auth/middlewares/ws-auth.middleware';
import { AUDIT_EVENTS } from '../../audit/constants/audit-event.constants';
import { AuditLoggerService } from 'src/audit/service/audit-logger.service';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

/** A recording whose socket dropped, waiting out its reconnect grace period. */
interface PendingEnd {
  timer: NodeJS.Timeout;
  userId?: number;
  tenantId?: string;
  provider?: AudioChatProvider;
  reason: StreamEndReason;
  clientId: string;
  disconnectedAt: number;
  /** When the audio stopped: the last audio frame, or the drop if none came. */
  audioEndedAt: number;
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/microphone-chat',
})
@Injectable()
export class MicrophoneChatGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(
    MicrophoneChatGateway.name,
  );

  private sessions: { [key: string]: UserChatSessionData } = {};
  // Periodic janitor reconciles `sessions` against the live socket set so we
  // don't leak entries when handleDisconnect doesn't fire (network drops, etc.)
  private sessionJanitor?: NodeJS.Timeout;
  private static readonly SESSION_JANITOR_INTERVAL_MS = 60_000;
  // Upper bound on how long the shutdown drain may take, so finalizing
  // in-flight recordings can't hold the process past the termination grace
  // period (best-effort: any unflushed session still falls to the janitor/
  // reprocess path on the surviving replicas).
  private static readonly SHUTDOWN_DRAIN_TIMEOUT_MS = 20_000;

  // A dropped socket no longer ends the recording on the spot. A network blip
  // (Wi-Fi, a proxy or host network reset — seen on production 2026-11-18,
  // when every socket on the host dropped at once) used to end every live
  // recording, and the client's reconnect then had its audio rejected as
  // "chat is ended": the rest of each session was lost while its summary still
  // read SUCCESS. Now the chat stays ACTIVE for a grace period; audio for it
  // from the same counsellor's new socket resumes the recording, and only if
  // none arrives is it ended exactly as before (flagged incomplete).
  private pendingEnds = new Map<number, PendingEnd>();
  private static readonly DEFAULT_RECONNECT_GRACE_MS = 60_000;

  /** Read lazily (not at module load) so tests and env changes apply. */
  static reconnectGraceMs(): number {
    const raw = process.env.MICROPHONE_RECONNECT_GRACE_MS;
    const parsed = raw === undefined || raw === '' ? NaN : Number(raw);
    return Number.isFinite(parsed) && parsed >= 0
      ? parsed
      : MicrophoneChatGateway.DEFAULT_RECONNECT_GRACE_MS;
  }

  private readonly auditLogger = AuditLoggerService.getInstance();

  constructor(
    private chatService: ChatService,
    private streamFileProcessorService: StreamFileProcessorService,
    private publisher: MessageBrokerService,
    private broadcastMessageService: BroadcastMessageService,
    private webSocketAuthMiddleware: WebSocketAuthMiddleware,
    private permissionValidator: PermissionValidator,
  ) {}

  @WebSocketServer() server!: Server;

  afterInit(server: Server) {
    this.logger.info(
      'WebSocket server initialized, setting up authentication middleware',
    );

    server.use(
      this.webSocketAuthMiddleware.webSocketMiddleware([
        PERMISSIONS.START_MICROPHONE_CHAT,
      ]),
    );

    this.sessionJanitor = setInterval(() => {
      void this.reconcileSessions();
    }, MicrophoneChatGateway.SESSION_JANITOR_INTERVAL_MS);
    if (typeof this.sessionJanitor.unref === 'function') {
      this.sessionJanitor.unref();
    }
  }

  private async reconcileSessions(): Promise<void> {
    const liveSockets = this.server?.sockets?.sockets;
    if (!liveSockets) return;
    let evicted = 0;
    for (const sid of Object.keys(this.sessions)) {
      if (liveSockets.has(sid)) continue;

      const session = this.sessions[sid];
      // The socket is gone but handleDisconnect never fired (network drop,
      // missed close). If a recording was in progress, FINALIZE it via the
      // normal end path — otherwise its S3 multipart upload is never completed,
      // so it never transcribes and the session fails. endChat -> handleChatEnded
      // -> endCallStream completes the upload (flushing the in-memory tail) and
      // dispatches transcription. Runs on a timer, so set the auth context from
      // the session (as processAudioUpload does for its background work).
      delete this.sessions[sid];
      evicted++;
      if (session?.chatId != null && session.chatId !== PLACEHOLDER_CHAT_ID) {
        if (this.isHeldByLiveSession(session.chatId)) {
          // The client already reconnected and resumed this chat on a new
          // socket; ending it here would cut the resumed recording.
          continue;
        }
        this.logger.warn(
          `Janitor found orphaned recording for chat ${session.chatId} ` +
            `(socket ${sid} gone with no disconnect event)`,
        );
        await this.scheduleEnd(session, StreamEndReason.JANITOR_ORPHAN, sid);
      }
    }
    if (evicted > 0) {
      this.logger.warn(
        `Microphone chat session janitor evicted ${evicted} stale session(s)`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sessionJanitor) clearInterval(this.sessionJanitor);

    // On shutdown (deploy / scale-in via SIGTERM) finalize any in-flight
    // recordings so their audio is flushed to S3 and transcription is
    // dispatched — otherwise the process dies with the audio still only in the
    // pod's memory/temp files, and a short session (no completed multipart
    // part) is unrecoverable. Same finalize path as the janitor. Done
    // sequentially to match the janitor (endChat relies on the per-call auth
    // context) and bounded by a timeout so a slow flush can't hang shutdown
    // past the platform's termination grace period.
    const inFlight: Array<{
      chatId: number;
      userId?: number;
      tenantId?: string;
      reason: StreamEndReason;
      /** Set for a recording already cut off (in its grace period). */
      endedAt?: Date;
    }> = Object.values(this.sessions)
      .filter(
        (session) =>
          session?.chatId != null && session.chatId !== PLACEHOLDER_CHAT_ID,
      )
      .map((session) => ({
        chatId: session.chatId,
        userId: session.userId,
        tenantId: session.tenantId,
        reason: StreamEndReason.SHUTDOWN_DRAIN,
      }));
    // Recordings waiting out their reconnect grace period: their client is
    // gone, so finalize them now (as disconnects) rather than lose the audio.
    for (const [chatId, pending] of this.pendingEnds) {
      clearTimeout(pending.timer);
      if (!inFlight.some((s) => s.chatId === chatId)) {
        inFlight.push({
          chatId,
          userId: pending.userId,
          tenantId: pending.tenantId,
          reason: pending.reason,
          endedAt: new Date(pending.audioEndedAt),
        });
      }
    }
    this.pendingEnds.clear();
    this.sessions = {};

    if (inFlight.length === 0) return;

    this.logger.warn(
      `Draining ${inFlight.length} in-flight microphone recording(s) on shutdown`,
    );

    const drainAll = (async () => {
      for (const session of inFlight) {
        try {
          ExecutionManager.setAuthContext(
            session.userId ? String(session.userId) : '',
            session.tenantId as string,
          );
          await this.chatService.endChat(
            session.chatId,
            session.endedAt,
            session.reason,
          );
          this.logger.warn(
            `Flushed in-flight recording for chat ${session.chatId} on shutdown`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to flush recording for chat ${session.chatId} on shutdown: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    })();

    await Promise.race([
      drainAll,
      new Promise<void>((resolve) =>
        setTimeout(
          resolve,
          MicrophoneChatGateway.SHUTDOWN_DRAIN_TIMEOUT_MS,
        ).unref(),
      ),
    ]);
  }

  async handleConnection(client: Socket) {
    this.logger.info(`Client connected to microphone chat: ${client.id}`);
    const user = client.data.user;
    if (!user) {
      this.logger.error(
        `No user data found for authenticated client ${client.id}`,
      );
      client.disconnect();
      return;
    }
    const room = `user-${user.id}`;
    await client.join(room);
    this.sessions[client.id] = {
      id: client.id,
      userId: user.id,
      user: null,
      type: 'user',
      role: UserRole.COUNSELOR,
      room,
      provider: AudioChatProvider.MICROPHONE,
      chatId: PLACEHOLDER_CHAT_ID,
      tenantId: user.tenantId,
    };

    this.publisher.publish(MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE, {
      participants: [user.id],
      message: {
        userId: user.id,
        content: 'User session created',
        messageType: MessageType.SYSTEM,
      },
      broadCastOptions: {
        event: ChatEvents.SESSION_CREATED,
      },
    });

    // Also emit directly to the client to ensure they receive it immediately
    // and avoid race conditions with the message broker.
    client.emit(ChatEvents.SESSION_CREATED, {
      type: ChatEvents.SESSION_CREATED,
      payload: {
        userId: user.id,
        content: 'User session created',
        messageType: MessageType.SYSTEM,
      },
    });

    this.logger.info(
      `Client ${client.id} authenticated and joined room ${room}`,
    );

    client.on('connect_error', (err) => {
      this.logger.error(
        `Connection error for client co ${client.id} with error ${err.message}`,
      );
    });

    // NOTE: do not add a `client.on('disconnect')` here. Nest already calls
    // `handleDisconnect` for us via OnGatewayDisconnect; a manual listener made
    // it run twice, concurrently, and both invocations read the session before
    // either deleted it — which is why every disconnect logged its end attempt
    // and its audit event twice.
  }

  async handleDisconnect(client: Socket) {
    this.logger.info(`Client disconnected from microphone chat: ${client.id}`);
    const clientId = client.id;
    const session = this.sessions[clientId];
    if (!session) {
      this.logger.error(`Session not found for client ${clientId}`);
      return;
    }
    // Claim the session before any await. Two disconnect notifications for the
    // same socket must not both reach endChat: the second one loses the race and
    // fails with "Chat is not active", which reads in the audit trail as a
    // failure to end a call that was in fact ended cleanly.
    delete this.sessions[clientId];
    // A recording in progress is not ended on the spot: the client may be
    // reconnecting (see pendingEnds). It is ended after the grace period unless
    // audio for it arrives again, or right away when the grace period is 0.
    if (
      session.chatId !== undefined &&
      session.chatId !== null &&
      session.chatId !== PLACEHOLDER_CHAT_ID &&
      !this.isHeldByLiveSession(session.chatId)
    ) {
      await this.scheduleEnd(
        session,
        StreamEndReason.CLIENT_DISCONNECT,
        clientId,
      );
    }
    // Broadcast disconnection
    this.broadcastMessageService.broadcastUserDisconnectedMessage(
      MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE,
      {
        participants: [session.userId],
        userId: session.userId,
      },
    );
  }

  sendMessagesToRoom(room: string, payload: MessagePayload) {
    const event = payload.type || ChatEvents.MESSAGE_RECEIVED;
    this.logger.info(
      `Sending message to room: ${room} | event: ${JSON.stringify(event)}`,
    );
    this.server.to(room).emit(event, payload);
  }

  private async sendMessageToParticipant(
    participants: number[],
    message: Message,
    broadCastOptions?: {
      event?: ChatEvents;
    },
  ) {
    if (!participants.length || !message.content) {
      this.logger.error(
        `No participants or message content found for chatId: ${message.chatId} | message: ${message.content}`,
      );
      return;
    }
    participants.forEach((participant) => {
      const room = `user-${participant}`;
      this.sendMessagesToRoom(room, {
        type: broadCastOptions?.event || ChatEvents.MESSAGE_RECEIVED,
        payload: message,
      });
    });
  }

  private async logErrorAudioCallAuditEvent(
    session: UserChatSessionData,
    chatId: number | null,
    error: string,
  ) {
    this.auditLogger.log({
      eventType: AUDIT_EVENTS.CALL_START_FAILED,
      tenantId: session.tenantId,
      userId: session.userId,
      details: {
        reason: error,
        chatId: chatId?.toString(),
      },
    });
  }

  /**
   * Diagnostic sink. A recording screen reports which of its start conditions
   * are unmet when a session is not capturing; we log one line beside that
   * socket's own connect line and do nothing else — no persistence, no side
   * effects, no reply. It exists because production could show us counsellors
   * connecting and SESSION_CREATED going out, but never why nothing was
   * recorded.
   *
   * Mobile reports why START_AUDIO_CHAT never followed. Web reports the same
   * shape for the failure that survives on its side: a session that starts,
   * joins and ends without a single audio frame, which the counsellor only
   * discovers when the summary comes back "No audio detected". The three
   * candidates there are indistinguishable from the server — the microphone
   * never opened, no recorder was built, or the session was never unpaused —
   * so the client has to say which.
   *
   * Payload is booleans, short status strings and counters. If a client ever
   * sends more than that, it still only reaches a log line — so keep it that
   * way, and delete this once the cause is known.
   */
  @SubscribeMessage(ChatEvents.SCRIBE_START_DIAGNOSTIC)
  scribeStartDiagnostic(client: Socket, payload: Record<string, unknown>) {
    const session = this.sessions[client.id];
    this.logger.warn(
      `Scribe start diagnostic | client ${client.id} | user ${
        session?.userId ?? 'unknown'
      } | chatId ${session?.chatId ?? 'none'} | ${JSON.stringify(payload)}`,
    );
  }

  @SubscribeMessage(ChatEvents.START_AUDIO_CHAT)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async startAudioChat(
    client: Socket,
    {
      isLinear16Encoded,
      platform,
      mode,
      sampleRate,
    }: {
      isLinear16Encoded?: boolean;
      platform: AudioChatPlatform;
      mode?: ScribeSessionMode;
      sampleRate?: number;
    },
  ) {
    this.logger.info(
      `Client ${client.id} start audio chat with isLinear16Encoded: ${isLinear16Encoded} | platform: ${platform} | sampleRate: ${sampleRate} | mode: ${mode}`,
    );

    const session = this.sessions[client.id];
    if (!session) {
      this.logger.error(
        `Audio chat start event received but session not found for client ${client.id}`,
      );
      this.logErrorAudioCallAuditEvent(session, null, 'Session not found');
      return;
    }

    this.setAuthContext(session);

    // Live dictation sessions are retired. Clients no longer offer the entry
    // point (DICTATION_MODE is absent from GET /settings/chat-types), so this
    // only fires for a stale client holding a cached chat-types response. Fail
    // the start rather than silently downgrading to SCRIBE, which would record
    // the session under a mode the counselor did not choose.
    if (mode === ScribeSessionMode.DICTATION) {
      this.logger.error(
        `Client ${client.id} attempted to start a retired dictation session`,
      );
      this.logErrorAudioCallAuditEvent(
        session,
        null,
        'Dictation mode is no longer supported',
      );
      client.disconnect();
      return;
    }

    // A previous recording of theirs still waiting out its reconnect grace
    // period would otherwise block this start as "already has an active chat".
    await this.endPendingForUser(session.userId);

    const activeChat = await this.chatService.getChatsByCouncilorId(
      session.userId,
      { status: ChatStatus.ACTIVE },
    );

    if (activeChat) {
      this.logger.error(`User ${session.userId} already has an active chat`);
      this.logErrorAudioCallAuditEvent(
        session,
        activeChat.id,
        'User already has active chat',
      );
      client.disconnect();
      return;
    }
    // Start call stream with chat creation in transaction
    try {
      await this.streamFileProcessorService.startCallStream(
        session,
        {
          counselorId: session.userId,
          provider: AudioChatProvider.MICROPHONE,
          platform,
          mode,
          sampleRate,
          isLinear16Encoded,
        },
        (chatId: number) => {
          // Update session with chatId
          this.sessions[client.id] = {
            ...this.sessions[client.id],
            chatId,
          };

          this.logger.info(
            `Chat created for user ${session.userId} with chatId ${chatId}`,
          );

          this.auditLogger.log({
            eventType: AUDIT_EVENTS.CALL_STARTED,
            tenantId: session.tenantId,
            userId: session.userId,
            details: {
              chatId,
              platform,
              provider: AudioChatProvider.MICROPHONE,
            },
          });
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to start call stream for client ${client.id}:`,
        error,
      );
      client.disconnect();

      this.logErrorAudioCallAuditEvent(session, session.chatId, error.message);
      return;
    }
  }

  @SubscribeMessage(ChatEvents.AUDIO_MESSAGE)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleAudioMessage(
    client: Socket,
    { audioData, chatId }: { audioData: string; chatId: number },
  ) {
    if (!this.sessions[client.id]) {
      this.logger.error(
        `Audio message event received but session not found for client ${client.id} | chatId: ${chatId}`,
      );

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_PROCESSING_FAILED,
        details: {
          chatId: chatId?.toString(),
          reason: 'Session not found',
          clientId: client.id,
        },
      });
      return;
    }
    if (!chatId) {
      this.logger.error(
        `Audio message event received but chatId is not provided for client ${client.id}`,
      );

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_PROCESSING_FAILED,
        tenantId: this.sessions[client.id]?.tenantId,
        userId: this.sessions[client.id]?.userId,
        details: {
          reason: 'ChatId not provided',
          clientId: client.id,
        },
      });
      return;
    }
    const chat = await this.chatService.getChatById(chatId);
    if (!chat) {
      this.logger.error(
        `Audio message event received but chat not found for client ${client.id} | chatId: ${chatId}`,
      );

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_PROCESSING_FAILED,
        tenantId: this.sessions[client.id]?.tenantId,
        userId: this.sessions[client.id]?.userId,
        details: {
          chatId: chatId.toString(),
          reason: 'Chat not found',
          clientId: client.id,
        },
      });
      return;
    }
    const pending = this.pendingEnds.get(chatId);
    if (pending) {
      // Only the counsellor whose recording it is may resume it.
      if (chat.counselorId !== this.sessions[client.id].userId) {
        this.logger.error(
          `Audio for chat ${chatId} in its reconnect grace period came from user ` +
            `${this.sessions[client.id].userId}, not its counsellor; ignored`,
        );
        return;
      }
      clearTimeout(pending.timer);
      this.pendingEnds.delete(chatId);
      this.logger.info(
        `Recording resumed for chat ${chatId} on socket ${client.id}, ` +
          `${Math.round((Date.now() - pending.disconnectedAt) / 1000)}s after its socket dropped`,
      );
      this.auditLogger.log({
        eventType: AUDIT_EVENTS.CALL_RESUMED,
        tenantId: this.sessions[client.id].tenantId,
        userId: this.sessions[client.id].userId,
        details: {
          chatId,
          clientId: client.id,
          previousClientId: pending.clientId,
          gapMs: Date.now() - pending.disconnectedAt,
        },
      });
    }
    this.sessions[client.id] = {
      ...this.sessions[client.id],
      chatId,
      lastAudioAt: Date.now(),
    };
    const session = this.sessions[client.id];
    const isChatEnded = await this.chatService.isChatEnded(chatId);
    if (isChatEnded) {
      this.logger.error(
        `Audio message event received but chat is ended for client ${client.id} | chatId: ${chatId}`,
      );

      this.auditLogger.log({
        eventType: AUDIT_EVENTS.AUDIO_PROCESSING_FAILED,
        tenantId: session.tenantId,
        userId: session.userId,
        details: {
          chatId: chatId.toString(),
          reason: 'Chat already ended',
          clientId: client.id,
        },
      });
      return;
    }
    this.streamFileProcessorService.saveAudio(session, {
      chatId,
      audioBase64: audioData,
      shouldBroadcastAudioMessage: true,
    });
  }

  subscribeToMicrophoneChatMessage() {
    this.publisher.subscribe(
      MessageBrokerChannel.CHAT_MESSAGE_MICROPHONE,
      (data) => {
        this.sendMessageToParticipant(
          data.participants,
          data.message,
          data.broadCastOptions,
        );
      },
    );
  }

  /** Whether a live socket's session is currently recording this chat. */
  private isHeldByLiveSession(chatId: number): boolean {
    const live = this.server?.sockets?.sockets;
    return Object.entries(this.sessions).some(
      ([sid, s]) => s?.chatId === chatId && (!live || live.has(sid)),
    );
  }

  /**
   * End a recording whose socket is gone — after the reconnect grace period,
   * or now when the grace period is 0. Replaces any earlier timer for the chat.
   */
  private async scheduleEnd(
    session: UserChatSessionData,
    reason: StreamEndReason,
    clientId: string,
  ): Promise<void> {
    const chatId = session.chatId;
    const existing = this.pendingEnds.get(chatId);
    if (existing) clearTimeout(existing.timer);
    this.pendingEnds.delete(chatId);

    // The counsellor ended it (End, then the socket closes): a normal end,
    // nothing to hold or finalize.
    try {
      if (await this.chatService.isChatEnded(chatId)) return;
    } catch {
      // Unknown: fall through and treat it as a drop; finalizeEnd re-checks.
    }

    // The recording's end is when its audio stopped, not when the grace period
    // ran out: ending it at "now" counted the whole grace period as call time.
    const disconnectedAt = Date.now();
    const audioEndedAt = session.lastAudioAt ?? disconnectedAt;
    const graceMs = MicrophoneChatGateway.reconnectGraceMs();
    if (graceMs <= 0) {
      this.pendingEnds.delete(chatId);
      await this.finalizeEnd(
        chatId,
        session.userId,
        session.tenantId,
        reason,
        clientId,
        session.provider,
        new Date(audioEndedAt),
      );
      return;
    }
    const timer = setTimeout(() => {
      this.pendingEnds.delete(chatId);
      void this.finalizeEnd(
        chatId,
        session.userId,
        session.tenantId,
        reason,
        clientId,
        session.provider,
        new Date(audioEndedAt),
      );
    }, graceMs);
    if (typeof timer.unref === 'function') timer.unref();
    this.pendingEnds.set(chatId, {
      timer,
      userId: session.userId,
      tenantId: session.tenantId,
      provider: session.provider,
      reason,
      clientId,
      disconnectedAt,
      audioEndedAt,
    });
    this.logger.warn(
      `Socket ${clientId} for chat ${chatId} dropped (${reason}); holding the ` +
        `recording ${Math.round(graceMs / 1000)}s for the client to reconnect`,
    );
  }

  /** End now any of this counsellor's recordings still in their grace period. */
  private async endPendingForUser(userId: number): Promise<void> {
    for (const [chatId, pending] of [...this.pendingEnds]) {
      if (pending.userId !== userId) continue;
      clearTimeout(pending.timer);
      this.pendingEnds.delete(chatId);
      await this.finalizeEnd(
        chatId,
        pending.userId,
        pending.tenantId,
        pending.reason,
        pending.clientId,
        pending.provider,
        new Date(pending.audioEndedAt),
      );
    }
  }

  /** The end a disconnect used to trigger immediately; unchanged. */
  private async finalizeEnd(
    chatId: number,
    userId: number | undefined,
    tenantId: string | undefined,
    reason: StreamEndReason,
    clientId: string,
    provider?: AudioChatProvider,
    endedAt?: Date,
  ): Promise<void> {
    ExecutionManager.setAuthContext(
      userId ? String(userId) : '',
      tenantId as string,
    );
    try {
      // Ended some other way meanwhile (the counsellor pressed End after
      // reconnecting): nothing to do, and not a failure.
      if (await this.chatService.isChatEnded(chatId)) return;
      await this.chatService.endChat(chatId, endedAt, reason);
      this.auditLogger.log({
        eventType: AUDIT_EVENTS.CALL_ENDED,
        tenantId,
        userId,
        details: {
          chatId,
          provider,
          reason:
            reason === StreamEndReason.JANITOR_ORPHAN
              ? 'Socket gone without a disconnect event'
              : 'Client disconnected',
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to end chat ${chatId} after its socket ${clientId} dropped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.auditLogger.log({
        eventType: AUDIT_EVENTS.CALL_END_FAILED,
        tenantId,
        userId,
        details: {
          chatId,
          reason: error instanceof Error ? error.message : String(error),
          clientId,
          provider,
        },
      });
    }
  }

  setAuthContext(session: UserChatSessionData) {
    ExecutionManager.setAuthContext(
      session.userId.toString(),
      session.tenantId,
    );
  }
}
