import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'events';
import type Redis from 'ioredis';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';

/**
 * One live inbox update (chunk 11a). Ids and counts only: never a message's text, so nothing a
 * visitor wrote passes through Redis. Listeners re-read what they need through the API.
 */
export interface InboxEvent {
  type: 'message' | 'state' | 'safety' | 'read';
  chatbotId: string;
  conversationId: string;
  [key: string]: unknown;
}

/** What a visitor's open page is told (chunk 11a): a team member's reply, or a change of hands. */
export interface VisitorEvent {
  type: 'message' | 'state';
  [key: string]: unknown;
}

/**
 * Live events for the inbox and for visitors' open pages, across instances (chunk 11a). As
 * `BotDraftEventsService`: Redis pub/sub, one pattern subscription per process fanning out to
 * in-process listeners, which each SSE connection adds and removes.
 *
 * Two kinds of channel: `inbox:<chatbotId>` for the dashboard (ids and counts), and
 * `visitor:<conversationId>` for the visitor's own page (the team member's reply itself, which
 * that visitor is meant to see).
 */
@Injectable()
export class InboxEventsService implements OnModuleDestroy {
  private readonly logger = LoggerService.getInstance(InboxEventsService.name);
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

  private get prefix(): string {
    return `${this.config.redis.prefix}:inbox:`;
  }

  publishInbox(event: InboxEvent): Promise<void> {
    return this.publish(`inbox:${event.chatbotId}`, event);
  }

  publishVisitor(conversationId: string, event: VisitorEvent): Promise<void> {
    return this.publish(`visitor:${conversationId}`, event);
  }

  private async publish(key: string, event: object): Promise<void> {
    try {
      this.pub ??= this.redis.createClient('inbox-events-pub');
      await this.pub.publish(`${this.prefix}${key}`, JSON.stringify(event));
    } catch (error) {
      // Live updates are a nicety: everything is stored, and a reconnect's snapshot redraws.
      this.logger.warn(
        `Inbox event not published (${key.split(':')[0]}): ${error instanceof Error ? error.message : 'unknown'}`,
      );
      this.local.emit(key, event);
    }
  }

  /** Listen to several assistants' inbox events; returns the function that stops listening. */
  async listenInbox(
    chatbotIds: string[],
    onEvent: (event: InboxEvent) => void,
  ): Promise<() => void> {
    await this.ensureSubscribed();
    const keys = chatbotIds.map((id) => `inbox:${id}`);
    for (const key of keys) this.local.on(key, onEvent);
    return () => keys.forEach((key) => this.local.off(key, onEvent));
  }

  async listenVisitor(
    conversationId: string,
    onEvent: (event: VisitorEvent) => void,
  ): Promise<() => void> {
    await this.ensureSubscribed();
    const key = `visitor:${conversationId}`;
    this.local.on(key, onEvent);
    return () => this.local.off(key, onEvent);
  }

  private ensureSubscribed(): Promise<void> {
    this.subscribing ??= (async () => {
      this.sub = this.redis.createClient('inbox-events-sub');
      const prefix = this.prefix;
      this.sub.on('pmessage', (_pattern, channel, message) => {
        try {
          this.local.emit(channel.slice(prefix.length), JSON.parse(message));
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
