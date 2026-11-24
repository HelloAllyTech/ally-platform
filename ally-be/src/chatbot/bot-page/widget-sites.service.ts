import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import { WidgetSite } from '../entity/widget-site.entity';

/** Sites recorded per chatbot at most; a forged `Origin` can't grow the table without bound. */
export const MAX_WIDGET_SITES = 500;
/** One database write per site per hour; loads in between are counted in Redis. */
const WRITE_EVERY_SECONDS = 3600;

/** "https://www.Example.org:8443" → "www.example.org". Null for anything but http(s). */
export function widgetSiteHost(
  origin: string | null | undefined,
): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return host && host.length <= 253 ? host : null;
  } catch {
    return null;
  }
}

/**
 * "Sites it has loaded on" (stage 7). The widget may load on any site, so every config read is
 * noted: a Redis counter per site, and a database upsert at most once an hour per site that adds
 * the counted loads. Never blocks or fails the widget: errors are logged and dropped.
 */
@Injectable()
export class WidgetSitesService {
  private readonly logger = LoggerService.getInstance(WidgetSitesService.name);

  constructor(
    @InjectRepository(WidgetSite)
    private readonly sites: Repository<WidgetSite>,
    private readonly redis: RedisService,
  ) {}

  async record(
    chatbotId: string,
    origin: string | null | undefined,
  ): Promise<void> {
    const host = widgetSiteHost(origin);
    if (!host) return;
    try {
      const counter = `bp:wsite:n:${chatbotId}:${host}`;
      const { count } = await this.redis.incrWithExpiry(
        counter,
        WRITE_EVERY_SECONDS * 2,
      );
      const due = await this.redis.acquireLock(
        `bp:wsite:w:${chatbotId}:${host}`,
        WRITE_EVERY_SECONDS,
      );
      if (!due) return;
      await this.redis.del(counter);
      await this.upsert(chatbotId, host, Math.max(1, count));
    } catch (error) {
      this.logger.warn(
        `Widget site not recorded for chatbot ${chatbotId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /** Adds `loads` to the site's row, creating it unless the chatbot already has the most sites. */
  async upsert(chatbotId: string, host: string, loads: number): Promise<void> {
    const updated = await this.sites
      .createQueryBuilder()
      .update(WidgetSite)
      .set({
        lastSeen: () => 'now()',
        loadCount: () => `load_count + ${Math.floor(loads)}`,
      })
      .where('chatbot_id = :chatbotId AND host = :host', { chatbotId, host })
      .execute();
    if (updated.affected) return;
    if (
      (await this.sites.count({ where: { chatbotId } })) >= MAX_WIDGET_SITES
    ) {
      return;
    }
    await this.sites
      .createQueryBuilder()
      .insert()
      .into(WidgetSite)
      .values({
        chatbotId,
        host,
        firstSeen: () => 'now()',
        lastSeen: () => 'now()',
        loadCount: Math.floor(loads),
      } as never)
      .orIgnore()
      .execute();
  }

  /** The owner's list, most recent first. */
  async list(
    chatbotId: string,
  ): Promise<
    { host: string; firstSeen: string; lastSeen: string; loadCount: number }[]
  > {
    const rows = await this.sites.find({
      where: { chatbotId },
      order: { lastSeen: 'DESC' },
      take: 200,
    });
    return rows.map((r) => ({
      host: r.host,
      firstSeen: new Date(r.firstSeen).toISOString(),
      lastSeen: new Date(r.lastSeen).toISOString(),
      loadCount: r.loadCount,
    }));
  }
}
