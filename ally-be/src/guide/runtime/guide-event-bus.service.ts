import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { GuideThreadEvent } from '../entity/guide-thread-event.entity';
import {
  GUIDE_CONTRACT_VERSION,
  GuideEvent,
} from '../contract/generated/guide-contract';

export type GuideEventType = GuideEvent['type'];
export type GuideEventData<T extends GuideEventType> = Extract<
  GuideEvent,
  { type: T }
>['data'];
export type GuideEventListener = (event: GuideEvent) => void;

/** Events the outbox keeps (and replays). Everything else is ephemeral. */
export const DURABLE_EVENT_TYPES: ReadonlySet<GuideEventType> = new Set([
  'assistant.message',
  'learner.message',
  'card.presented',
  'card.updated',
  'spine.updated',
  'scene.opened',
  'scene.closed',
  'mode.changed',
  'crisis.response',
  'notebook.added',
  'milestone',
]);

/** On Postgres an `UPDATE … RETURNING` through `query()` is a `[rows, count]` tuple. */
function returningRows<T>(result: unknown): T[] {
  const value = result as unknown[];
  return (Array.isArray(value?.[0]) ? value[0] : value) as T[];
}

/**
 * The thread event stream (plans/ally-guide/plan.md §9.2, §7.10).
 *
 * Durable events get the next per-thread `seq` and a row in
 * `guide_thread_events` in ONE transaction, then fan out over Redis so any
 * API instance holding the learner's SSE connection can deliver them. A
 * reconnecting client replays the outbox after its `Last-Event-ID`.
 * Ephemeral events (deltas, presence, pings) are never stored; they carry the
 * last durable seq so ordering on the client stays monotonic.
 *
 * One pattern subscription per process; listeners are kept in memory and
 * removed by the function `subscribe` returns (the shared broker has no
 * unsubscribe, which is why this service owns its own clients).
 */
@Injectable()
export class GuideEventBusService implements OnModuleDestroy {
  private readonly logger = LoggerService.getInstance(
    GuideEventBusService.name,
  );
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private subscribing: Promise<void> | null = null;
  private readonly listeners = new Map<string, Set<GuideEventListener>>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
    private readonly config: AppConfigService,
  ) {}

  private get prefix(): string {
    return `${this.config.redis.prefix}:guide:thread:`;
  }

  channel(threadId: string): string {
    return `${this.prefix}${threadId}`;
  }

  private envelope<T extends GuideEventType>(
    threadId: string,
    seq: number,
    type: T,
    data: GuideEventData<T>,
  ): GuideEvent {
    return {
      v: GUIDE_CONTRACT_VERSION,
      seq,
      threadId,
      at: new Date().toISOString(),
      durable: DURABLE_EVENT_TYPES.has(type),
      type,
      data,
    } as GuideEvent;
  }

  /** Allocate the next seq, store the event and publish it. Returns the event. */
  async appendDurable<T extends GuideEventType>(
    threadId: string,
    type: T,
    data: GuideEventData<T>,
    turnId?: string | null,
  ): Promise<GuideEvent> {
    if (!DURABLE_EVENT_TYPES.has(type)) {
      throw new Error(`${type} is an ephemeral event; use emitEphemeral`);
    }
    const event = await this.dataSource.transaction(async (manager) => {
      const rows = returningRows<{ lastEventSeq: number }>(
        await manager.query(
          `UPDATE "guide_threads" SET "lastEventSeq" = "lastEventSeq" + 1, "updatedAt" = now()
            WHERE "id" = $1 RETURNING "lastEventSeq"`,
          [threadId],
        ),
      );
      if (!rows.length) throw new Error(`Thread ${threadId} not found`);
      const built = this.envelope(threadId, rows[0].lastEventSeq, type, data);
      await manager.getRepository(GuideThreadEvent).insert({
        threadId,
        seq: built.seq,
        type,
        payload: built as unknown as Record<string, any>,
        turnId: turnId ?? null,
      });
      return built;
    });
    await this.publish(event);
    return event;
  }

  /** Publish without storing. `seq` should be the last durable seq the caller knows. */
  async emitEphemeral<T extends GuideEventType>(
    threadId: string,
    type: T,
    data: GuideEventData<T>,
    seq: number,
  ): Promise<GuideEvent> {
    const event = this.envelope(threadId, seq, type, data);
    await this.publish(event);
    return event;
  }

  /** Durable events after `afterSeq`, oldest first. */
  async replay(
    threadId: string,
    afterSeq: number,
    limit = 1000,
  ): Promise<GuideEvent[]> {
    const rows = await this.dataSource
      .getRepository(GuideThreadEvent)
      .createQueryBuilder('e')
      .where('e.threadId = :threadId', { threadId })
      .andWhere('e.seq > :afterSeq', { afterSeq })
      .orderBy('e.seq', 'ASC')
      .limit(limit)
      .getMany();
    return rows.map((row) => row.payload as unknown as GuideEvent);
  }

  /** Listen to one thread's events on this instance. Returns the unsubscribe. */
  subscribe(threadId: string, listener: GuideEventListener): () => void {
    let set = this.listeners.get(threadId);
    if (!set) {
      set = new Set();
      this.listeners.set(threadId, set);
    }
    set.add(listener);
    void this.ensureSubscribed();
    return () => {
      const current = this.listeners.get(threadId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(threadId);
    };
  }

  /** Resolves once the pattern subscription is live (await before replaying). */
  ensureSubscribed(): Promise<void> {
    if (!this.subscribing) {
      this.subscribing = (async () => {
        this.subscriber = this.redisService.createClient('guide-events-sub');
        this.subscriber.on('pmessage', (_pattern, channel, message) =>
          this.dispatch(channel, message),
        );
        await this.subscriber.psubscribe(`${this.prefix}*`);
      })().catch((error) => {
        this.subscribing = null;
        this.logger.error('Guide event subscription failed', error);
        throw error;
      });
    }
    return this.subscribing;
  }

  private dispatch(channel: string, message: string): void {
    if (!channel.startsWith(this.prefix)) return;
    const listeners = this.listeners.get(channel.slice(this.prefix.length));
    if (!listeners?.size) return;
    let event: GuideEvent;
    try {
      event = JSON.parse(message) as GuideEvent;
    } catch {
      return;
    }
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.logger.warn(
          `Guide event listener threw: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private async publish(event: GuideEvent): Promise<void> {
    if (!this.publisher) {
      this.publisher = this.redisService.createClient('guide-events-pub');
    }
    try {
      await this.publisher.publish(
        this.channel(event.threadId),
        JSON.stringify(event),
      );
    } catch (error) {
      // A durable event is already in the outbox and is replayed on
      // reconnect; an ephemeral one is lost, which is acceptable.
      this.logger.warn(
        `Guide event publish failed (${event.type}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.subscriber?.quit(), this.publisher?.quit()]);
  }
}

/**
 * Merges a replay with a live subscription without gaps or duplicates
 * (plan §9.2). Durable events pass only if newer than the last one sent;
 * ephemeral events always pass (they are transient and carry no new seq).
 */
export class GuideReplayGate {
  constructor(private lastDurableSeq: number) {}

  get lastSeq(): number {
    return this.lastDurableSeq;
  }

  accept(event: GuideEvent): boolean {
    if (!event.durable) return true;
    if (event.seq <= this.lastDurableSeq) return false;
    this.lastDurableSeq = event.seq;
    return true;
  }
}
