import { Injectable, NestMiddleware, Optional } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { publicBotKey } from '../../common/cors/app-cors';
import { AppConfigService } from '../../config/config.service';
import { BotPageDomainService } from './bot-page-domain.service';

/** The largest body a bot page sends: one message, or eight pre-chat answers. */
const BOT_PAGE_MAX_BODY_BYTES = 16 * 1024;

/**
 * Two checks in front of the public bot-page routes:
 *
 * - **Origin.** These routes refuse a browser request from any origin but Ally's own — the bot
 *   page's, or one on the app's CORS list (`ALLOWED_ORIGINS`) — so another site can't drive a
 *   visitor's session. Ally's own origins all pass because the page is served from more than one
 *   (admin.helloally.ai redirects to app.helloally.ai/admin). Requests with no `Origin` (curl,
 *   server-side) pass, as CORS lets them. Since stage 7 a page's own verified custom domain passes
 *   too, for that page only (BotPageDomainService.originAllowedFor).
 * - **Size.** The app accepts 1 MB JSON bodies; a page never needs more than 16 KB.
 */
@Injectable()
export class BotPageGuardMiddleware implements NestMiddleware {
  constructor(
    private readonly config: AppConfigService,
    @Optional() private readonly domains?: BotPageDomainService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const origin = req.headers.origin;
    if (
      origin &&
      origin !== this.config.botPage.origin &&
      !this.config.cors.allowedOrigins.includes(origin) &&
      !(await this.customDomain(origin, req))
    ) {
      res.status(403).json({ statusCode: 403, code: 'origin_not_allowed' });
      return;
    }
    const length = Number(req.headers['content-length'] ?? 0);
    const parsed = req.body ? Buffer.byteLength(JSON.stringify(req.body)) : 0;
    if (length > BOT_PAGE_MAX_BODY_BYTES || parsed > BOT_PAGE_MAX_BODY_BYTES) {
      res.status(413).json({ statusCode: 413, code: 'too_large' });
      return;
    }
    next();
  }

  /** The page's own verified custom domain (stage 7). Fails closed. */
  private async customDomain(origin: string, req: Request): Promise<boolean> {
    if (!this.domains) return false;
    const key = publicBotKey(req.originalUrl ?? req.url);
    if (!key) return false;
    try {
      return await this.domains.originAllowedFor(origin, key);
    } catch {
      return false;
    }
  }
}
