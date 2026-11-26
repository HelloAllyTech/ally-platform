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
import { DataSource } from 'typeorm';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { WebSocketAuthMiddleware } from 'src/auth/middlewares/ws-auth.middleware';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { LoggerService } from 'src/logger/logger.service';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from 'src/common/decorator/execution.context.decorator';

import { RoadmapEvents } from '../enum/roadmap-events.enum';
import { RoadmapEvent } from '../type/roadmap-event.type';
import { RoadmapNotificationService } from '../service/roadmap-notification.service';

const BOARD_ROOM = 'roadmap:board';
/** Roadmap v2's per-idea room, keyed by code: the idea page and the reading pane. */
const itemRoom = (code: string) => `roadmap:item:${code}`;
const ITEM_CODE = /^[A-Z]{1,8}-?\d{1,9}$/;
const PRESENCE_KINDS = ['viewing', 'typing'] as const;
/** How long the gateway trusts its last read of the roadmap_v2 flag. */
const FLAG_TTL_MS = 30_000;

/** A code as the client sent it, or null when it is not one. */
const itemCode = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return code.length <= 20 && ITEM_CODE.test(code) ? code : null;
};

/**
 * Live updates for the roadmap board, replacing the standalone app's Supabase Realtime
 * subscription.
 *
 * The middleware gates on VIEW only, on purpose: this socket is READ-ONLY. Every mutation still
 * goes through an HTTP handler with its own @AuthPermissions, so a client holding view: can
 * watch the board update but cannot change anything through here.
 *
 * TWO ROOMS. Board-wide traffic (an idea's fields changed) goes to everyone who joined the
 * board; presence and the same change go to the clients that have that idea open (its item
 * room, keyed by code). The old board's per-opportunity room and its vote/comment deltas went
 * with the old Product Roadmap page.
 */
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/product-roadmap',
})
@Injectable()
export class RoadmapGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(RoadmapGateway.name);

  private v2Flag: { at: number; on: boolean } | null = null;

  constructor(
    private readonly webSocketAuthMiddleware: WebSocketAuthMiddleware,
    private readonly notifications: RoadmapNotificationService,
    private readonly planSettings: PlanSettingsService,
    private readonly dataSource: DataSource,
  ) {}

  @WebSocketServer()
  server!: Server;

  afterInit(server: any) {
    server.use(
      this.webSocketAuthMiddleware.webSocketMiddleware([
        PERMISSIONS.VIEW_PRODUCT_ROADMAP,
      ]),
    );

    // Services emit through the notification registry and never import this gateway — that is
    // what keeps them testable and free of a circular dependency.
    this.notifications.addListener((event) => this.dispatch(event));
  }

  onModuleDestroy() {
    this.notifications.removeListener();
  }

  handleConnection(client: any) {
    const user = client.data?.user;
    if (!user) {
      client.disconnect();
      return;
    }
    client.emit(RoadmapEvents.CONNECTED, { userId: user.id });
  }

  handleDisconnect(client: any) {
    this.logger.debug(`[ROADMAP] Socket disconnected: ${client.id}`);
  }

  @SubscribeMessage(RoadmapEvents.JOIN_BOARD)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleJoinBoard(client: any): Promise<void> {
    if (!client.data?.user) {
      client.disconnect();
      return;
    }
    await client.join(BOARD_ROOM);
  }

  // ── Roadmap v2: idea rooms and presence (§4.12, §5.7b) ─────────────────────

  @SubscribeMessage(RoadmapEvents.JOIN_ITEM)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleJoinItem(client: any, payload: { code?: string }): Promise<void> {
    const code = itemCode(payload?.code);
    if (!client.data?.user || !code || !(await this.roadmapV2On())) return;
    await client.join(itemRoom(code));
  }

  @SubscribeMessage(RoadmapEvents.LEAVE_ITEM)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleLeaveItem(
    client: any,
    payload: { code?: string },
  ): Promise<void> {
    const code = itemCode(payload?.code);
    if (!code) return;
    await client.leave(itemRoom(code));
  }

  /**
   * "Ana is answering…" and who else has the idea open. Relayed to the idea's
   * room, never to the sender, and never stored: a presence is only as fresh
   * as its last message, and the client lets one lapse after 30 s.
   */
  @SubscribeMessage(RoadmapEvents.PRESENCE)
  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handlePresence(
    client: any,
    payload: { code?: string; kind?: string; questionId?: string },
  ): Promise<void> {
    const user = client.data?.user;
    const code = itemCode(payload?.code);
    const kind = PRESENCE_KINDS.find((k) => k === payload?.kind);
    if (!user || !code || !kind || !(await this.roadmapV2On())) return;
    const questionId =
      typeof payload?.questionId === 'string' && payload.questionId.length <= 64
        ? payload.questionId
        : undefined;
    const room = itemRoom(code);
    await client.join(room);
    client.to(room).emit(RoadmapEvents.PRESENCE, {
      code,
      userId: user.id,
      name: await this.displayName(client),
      kind,
      ...(questionId ? { questionId } : {}),
      at: new Date().toISOString(),
    });
  }

  private async roadmapV2On(): Promise<boolean> {
    const now = Date.now();
    if (this.v2Flag && now - this.v2Flag.at < FLAG_TTL_MS)
      return this.v2Flag.on;
    let on = false;
    try {
      on = (await this.planSettings.getRoadmapV2()).enabled;
    } catch (error) {
      this.logger.warn(
        `[ROADMAP] Could not read the roadmap_v2 flag: ${(error as Error)?.message}`,
      );
    }
    this.v2Flag = { at: now, on };
    return on;
  }

  /** The person's name, read once per socket. Never the username, which can be an email. */
  private async displayName(client: any): Promise<string> {
    if (typeof client.data?.roadmapName === 'string') {
      return client.data.roadmapName;
    }
    let name = '';
    try {
      const rows: { name: string | null }[] = await this.dataSource.query(
        `SELECT name FROM "users" WHERE id = $1`,
        [client.data.user.id],
      );
      name = rows[0]?.name?.trim() ?? '';
    } catch {
      // A presence without a name is still a presence.
    }
    client.data.roadmapName = name || 'Someone';
    return client.data.roadmapName;
  }

  /**
   * Fan out one service event.
   *
   * Every payload carries `actorId`. That is a HARD CONTRACT with the client, which uses it to
   * suppress its own echo.
   */
  private dispatch(event: RoadmapEvent): void {
    if (!this.server) return;

    switch (event.kind) {
      case 'ITEM_CHANGED':
        this.server
          .to(BOARD_ROOM)
          .to(itemRoom(event.code))
          .emit(RoadmapEvents.ITEM_CHANGED, {
            code: event.code,
            fields: event.fields,
            actorId: event.actorId,
          });
        break;
    }
  }
}
