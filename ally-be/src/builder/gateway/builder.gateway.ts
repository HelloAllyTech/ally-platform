import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { WebSocketAuthMiddleware } from 'src/auth/middlewares/ws-auth.middleware';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { LoggerService } from 'src/logger/logger.service';
import { BuilderBuildEvent } from '../entity/builder-build-event.entity';
import { BuilderEventService } from '../service/builder-event.service';
import { BuilderLiveService } from '../service/builder-live.service';

const sessionRoom = (sessionId: string) => `session:${sessionId}`;

export const BuilderSocketEvents = {
  CONNECTED: 'connected',
  JOIN_SESSION: 'joinSession',
  LEAVE_SESSION: 'leaveSession',
  JOINED: 'joined',
  /** A batch of new build events for the joined session. */
  EVENTS: 'buildEvents',
  /** The Builder tab's decisions changed: refetch. No payload. */
  DECISIONS_CHANGED: 'decisionsChanged',
  /** A session in progress moved: refetch. No payload. */
  SESSIONS_CHANGED: 'sessionsChanged',
} as const;

/**
 * Live push for the build feed.
 *
 * Polling would work — every other long-running surface in this app polls —
 * but a build transcript is read the way you read a terminal, and a five
 * second lag between the agent editing a file and the feed saying so makes it
 * feel like a log rather than a thing happening. The client keeps its polling
 * path as a fallback, so a socket that never connects degrades the experience
 * without breaking it.
 */
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/builder' })
@Injectable()
export class BuilderGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(BuilderGateway.name);

  constructor(
    private readonly webSocketAuthMiddleware: WebSocketAuthMiddleware,
    private readonly eventService: BuilderEventService,
    private readonly liveService: BuilderLiveService,
  ) {}

  @WebSocketServer()
  server!: Server;

  afterInit(server: Server) {
    server.use(
      this.webSocketAuthMiddleware.webSocketMiddleware([
        PERMISSIONS.VIEW_BUILDER,
      ]),
    );

    this.eventService.addListener((sessionId, events) => {
      this.broadcast(sessionId, events);
      // A run moving is the Now page's row moving.
      this.liveService.changed('sessionsChanged');
    });

    // The Builder tab listens on the namespace, not a room: every admin with
    // VIEW_BUILDER sees the same feed.
    this.liveService.setListener((events) => {
      for (const event of events) {
        this.server?.emit(event, { at: Date.now() });
      }
    });
  }

  onModuleDestroy() {
    this.eventService.removeListener();
    this.liveService.setListener(null);
  }

  handleConnection(client: any) {
    const user = client.data?.user;
    if (!user) {
      this.logger.error(`No user on authenticated Builder client ${client.id}`);
      client.disconnect();
      return;
    }
    client.emit(BuilderSocketEvents.CONNECTED, { userId: user.id });
  }

  handleDisconnect(client: any) {
    this.logger.info(`Client left the Builder socket: ${client.id}`);
  }

  @SubscribeMessage(BuilderSocketEvents.JOIN_SESSION)
  async handleJoinSession(client: any, { sessionId }: { sessionId: string }) {
    const user = client.data?.user;
    if (!user || !sessionId) {
      return;
    }
    await client.join(sessionRoom(sessionId));
    // Echoed back so the client knows the join landed and can stop polling —
    // without it there is no way to tell a joined room from a dropped message.
    client.emit(BuilderSocketEvents.JOINED, { sessionId });
  }

  @SubscribeMessage(BuilderSocketEvents.LEAVE_SESSION)
  async handleLeaveSession(client: any, { sessionId }: { sessionId: string }) {
    if (!sessionId) return;
    await client.leave(sessionRoom(sessionId));
  }

  /**
   * Push a batch to everyone watching this session.
   *
   * Events carry their `seq`, and the client reconciles against what it
   * already has — so a dropped socket frame or a duplicate delivery costs
   * nothing: the next poll or the next batch closes the gap.
   */
  private broadcast(sessionId: string, events: BuilderBuildEvent[]): void {
    if (!this.server) return;
    this.server.to(sessionRoom(sessionId)).emit(BuilderSocketEvents.EVENTS, {
      sessionId,
      events: events.map((event) => ({
        id: event.id,
        runId: event.runId,
        seq: event.seq,
        stage: event.stage,
        type: event.type,
        payload: event.payload,
        createdAt: event.createdAt,
      })),
    });
  }
}
