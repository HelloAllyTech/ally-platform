import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { WebSocketAuthMiddleware } from 'src/auth/middlewares/ws-auth.middleware';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { FeatureToggleService } from 'src/authorization/service/feature-toggle.service';
import { LoggerService } from 'src/logger/logger.service';
import { PmAgentEventsService } from '../service/pm-agent-events.service';

export const PmAgentSocketEvents = {
  CONNECTED: 'connected',
  /** `{ cardId }` — refetch that card (and the queue). */
  CARD_UPDATED: 'card.updated',
  /** No payload beyond a timestamp — refetch GET /state. */
  STATE_UPDATED: 'state.updated',
} as const;

/**
 * Live push for the PM Agent tab (namespace `/pm-agent`). Everyone holding the toggle
 * sees the same feed, so events go to the namespace rather than rooms. Payloads carry
 * ids only — the client refetches over REST, which is where authorisation and shaping
 * live. The UI polls GET /state every 30 s as the fallback.
 */
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/pm-agent' })
@Injectable()
export class PmAgentGateway
  implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy
{
  private readonly logger = LoggerService.getInstance(PmAgentGateway.name);

  constructor(
    private readonly webSocketAuthMiddleware: WebSocketAuthMiddleware,
    private readonly featureToggles: FeatureToggleService,
    private readonly events: PmAgentEventsService,
  ) {}

  @WebSocketServer()
  server!: Server;

  afterInit(server: Server) {
    server.use(
      this.webSocketAuthMiddleware.webSocketMiddleware([
        PERMISSIONS.SYSTEM_ACCESS,
      ]),
    );
    this.events.setListener((event) => {
      if (event.type === 'card.updated') {
        this.server?.emit(PmAgentSocketEvents.CARD_UPDATED, {
          cardId: event.cardId,
        });
      } else {
        this.server?.emit(PmAgentSocketEvents.STATE_UPDATED, {
          at: Date.now(),
        });
      }
    });
  }

  onModuleDestroy() {
    this.events.setListener(null);
  }

  async handleConnection(client: any) {
    const user = client.data?.user;
    if (!user) {
      client.disconnect();
      return;
    }
    // Same gate as the REST surface: the toggle, not only a valid session.
    const allowed = await this.featureToggles
      .hasToggle(user.id, FeatureToggleKey.PM_AGENT)
      .catch(() => false);
    if (!allowed) {
      this.logger.info(`PM Agent socket refused for user ${user.id}`);
      client.disconnect();
      return;
    }
    client.emit(PmAgentSocketEvents.CONNECTED, { userId: user.id });
  }
}
