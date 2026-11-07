import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppConfigService } from '../../config/config.service';

/** The largest body a bot page sends: one message, or eight pre-chat answers. */
export const BOT_PAGE_MAX_BODY_BYTES = 16 * 1024;

/**
 * Two checks in front of the public bot-page routes:
 *
 * - **Origin.** The app's CORS list (`ALLOWED_ORIGINS`) is global. These routes also refuse a
 *   browser request from any origin but the bot page's own, so another site can't drive a
 *   visitor's session. Requests with no `Origin` (curl, server-side) pass, as CORS lets them.
 * - **Size.** The app accepts 1 MB JSON bodies; a page never needs more than 16 KB.
 */
@Injectable()
export class BotPageGuardMiddleware implements NestMiddleware {
  constructor(private readonly config: AppConfigService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const origin = req.headers.origin;
    if (origin && origin !== this.config.botPage.origin) {
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
}
