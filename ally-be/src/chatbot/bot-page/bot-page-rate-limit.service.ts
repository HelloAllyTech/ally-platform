import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';

export type BotPageLimitHit = 'visitor' | 'ip' | 'daily_cap';

/** Per-IP ceilings on the public routes, whatever the page's own limits say. */
export const BOT_PAGE_IP_LIMITS = {
  /** Session starts and code requests. */
  session: { perHour: 20 },
  /** Code checks. */
  verify: { perHour: 30 },
  messages: { perHour: 120 },
  /** Thumbs up or down (chunk Q2a): generous, since a rating can be changed. */
  feedback: { perHour: 120 },
} as const;

/**
 * The bot page's limits: messages per visitor per hour, a per-IP ceiling, and a daily cap per bot.
 *
 * Fixed windows in Redis keyed by the window itself, as `WhatsAppRateLimitService` does. Not the
 * `@RateLimit` decorator: its guard is off when running locally and knows only ip and user, while
 * these need the visitor and the bot too, and should behave the same on a laptop as in production.
 *
 * Every check **fails open**: Redis being down must not silence the page, the same trade-off
 * WhatsApp makes. The daily cap alerts the team once per bot per day.
 */
@Injectable()
export class BotPageRateLimitService {
  private readonly logger = LoggerService.getInstance(
    BotPageRateLimitService.name,
  );

  constructor(
    private readonly redis: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /** Counts one hit against an hourly window; false once it is over `limit`. */
  async hourly(
    scope: string,
    limit: number,
    now = Date.now(),
  ): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
    const bucket = Math.floor(now / 3_600_000);
    try {
      const { count, ttlSeconds } = await this.redis.incrWithExpiry(
        `bp:rl:${scope}:h:${bucket}`,
        3660,
      );
      if (count > limit) {
        const untilNextHour = Math.ceil(
          ((bucket + 1) * 3_600_000 - now) / 1000,
        );
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.min(ttlSeconds, untilNextHour)),
        };
      }
      return { allowed: true };
    } catch (error) {
      this.failedOpen('hourly', error);
      return { allowed: true };
    }
  }

  /**
   * Counts one message against the bot's daily cap (UTC days). Over the cap, the team is alerted
   * once for that bot and day.
   */
  async dailyCap(
    chatbotId: string,
    cap: number,
    now = new Date(),
  ): Promise<{ allowed: boolean }> {
    const day = now.toISOString().slice(0, 10);
    try {
      const { count } = await this.redis.incrWithExpiry(
        `bp:cap:${chatbotId}:${day}`,
        90_000,
      );
      if (count <= cap) return { allowed: true };
      if (
        await this.redis.acquireLock(`bp:cap-alert:${chatbotId}:${day}`, 90_000)
      ) {
        this.eventEmitter.emit('exception', {
          statusCode: 429,
          timestamp: now.toISOString(),
          path: `/api/v1/public/bots (chatbot ${chatbotId})`,
          message: `Bot page daily cap reached: chatbot ${chatbotId} hit its cap of ${cap} messages for ${day} (UTC). Visitors see "busy, try later" until tomorrow, or until the cap is raised in the Bot page tab.`,
          type: 'BOT PAGE DAILY CAP',
        });
      }
      return { allowed: false };
    } catch (error) {
      this.failedOpen('daily cap', error);
      return { allowed: true };
    }
  }

  /** Whether today's cap is used up, for the Bot page tab's banner. */
  async dailyCapReached(
    chatbotId: string,
    cap: number,
    now = new Date(),
  ): Promise<boolean> {
    try {
      const raw = await this.redis.get(
        `bp:cap:${chatbotId}:${now.toISOString().slice(0, 10)}`,
      );
      return Number(raw ?? 0) >= cap;
    } catch {
      return false;
    }
  }

  private failedOpen(what: string, error: unknown): void {
    this.logger.error(
      `Bot page ${what} check failed (allowing the request): ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
}
