import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'events';
import type Redis from 'ioredis';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';

/** One live update for a draft's canvas or chat (the `canvas` SSE event). */
export interface BotDraftEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Live events for onboarding sessions, across instances (chunk 20a).
 *
 * The crawl may run on one ally-be instance while the owner's browser is connected to another, so
 * events go through Redis pub/sub. One pattern subscription per process fans out to in-process
 * listeners, which each SSE connection adds and removes; the shared `BrokerModule` can't
 * unsubscribe, so a subscription per connection would leak.
 */
@Injectable()
export class BotDraftEventsService implements OnModuleDestroy {
  private readonly logger = LoggerService.getInstance(
    BotDraftEventsService.name,
  );
  private readonly local = new EventEmitter();
  private pub?: Redis;
  private sub?: Redis;
  private subscribing?: Promise<void>;

  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {
    this.local.setMaxListeners(0);
  }

  private channel(draftId: string): string {
    return `${this.config.redis.prefix}:bd:events:${draftId}`;
  }

  async publish(draftId: string, event: BotDraftEvent): Promise<void> {
    try {
      this.pub ??= this.redis.createClient('bot-draft-events-pub');
      await this.pub.publish(this.channel(draftId), JSON.stringify(event));
    } catch (error) {
      // Live updates are a nicety: the state is saved, and a reconnect replays it.
      this.logger.warn(
        `Bot draft event not published (${event.type}): ${error instanceof Error ? error.message : 'unknown'}`,
      );
      this.local.emit(draftId, event);
    }
  }

  /** Listen to one draft's events; returns the function that stops listening. */
  async listen(
    draftId: string,
    onEvent: (event: BotDraftEvent) => void,
  ): Promise<() => void> {
    await this.ensureSubscribed();
    this.local.on(draftId, onEvent);
    return () => this.local.off(draftId, onEvent);
  }

  private ensureSubscribed(): Promise<void> {
    this.subscribing ??= (async () => {
      this.sub = this.redis.createClient('bot-draft-events-sub');
      const prefix = `${this.config.redis.prefix}:bd:events:`;
      this.sub.on('pmessage', (_pattern, channel, message) => {
        const draftId = channel.slice(prefix.length);
        try {
          this.local.emit(draftId, JSON.parse(message));
        } catch {
          /* a malformed message is dropped */
        }
      });
      await this.sub.psubscribe(`${prefix}*`);
    })();
    return this.subscribing;
  }

  async onModuleDestroy(): Promise<void> {
    this.local.removeAllListeners();
    await Promise.allSettled([this.sub?.quit(), this.pub?.quit()]);
  }
}
