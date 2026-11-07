import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, createHmac, randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import { AppConfigService } from '../../config/config.service';

/** A bot page visitor, as their cookie proves them. */
export interface BotPageVisitor {
  /** Random, minted by the server; the `web` identity's external id. */
  id: string;
  chatbotId: string;
  /** When they last proved their email with a code; null for a public page's visitor. */
  verifiedAt: Date | null;
  /** When this token was signed, for rotation. */
  issuedAt: Date;
}

interface VisitorClaims {
  sub?: string;
  typ?: string;
  bot?: string;
  vat?: number;
  iat?: number;
}

const AUDIENCE = 'bot-page';
const TOKEN_TYPE = 'bot_page_visitor';
const SECRET_LABEL = 'bot-page-visitor-v1';
/** The cookie lives a week, and is re-signed on every session call and daily on messages. */
const TOKEN_TTL_SECONDS = 7 * 24 * 3600;
const ROTATE_AFTER_SECONDS = 24 * 3600;
/** A verified email has to be proved again after this long. */
export const VERIFICATION_TTL_SECONDS = 30 * 24 * 3600;
export const BOT_PAGE_COOKIE_PATH = '/api/v1/public/bots';

/**
 * Visitor tokens for the bot page (chunk 12b).
 *
 * HS256 with a secret that is never the user access secret: `BOT_PAGE_VISITOR_SECRET` when set,
 * otherwise HMAC-SHA256(JWT_ACCESS_SECRET, label), the same scheme as the helpline's guest tokens. So
 * `JwtStrategy` can't accept a visitor token, and this service can't accept a user token.
 *
 * Carried in an httpOnly, SameSite=Lax cookie scoped to the public bot-page routes and named per
 * bot, so page JavaScript never sees it and one bot's visitor is a stranger to another bot. Lax
 * works because the page and the API are on the same site (see CHUNK-12B-NOTES).
 */
@Injectable()
export class BotPageVisitorService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
  ) {}

  static cookieName(chatbotId: string): string {
    return `ally_bp_${chatbotId.replace(/-/g, '').slice(0, 12)}`;
  }

  /** The visitor behind the request's cookie for this bot, or null. Never throws. */
  async read(req: Request, chatbotId: string): Promise<BotPageVisitor | null> {
    const token = readCookie(
      req.headers.cookie,
      BotPageVisitorService.cookieName(chatbotId),
    );
    if (!token) return null;
    try {
      const claims = await this.jwtService.verifyAsync<VisitorClaims & object>(
        token,
        { secret: this.secret(), algorithms: ['HS256'], audience: AUDIENCE },
      );
      if (
        claims.typ !== TOKEN_TYPE ||
        !claims.sub ||
        claims.bot !== chatbotId ||
        !claims.iat
      ) {
        return null;
      }
      const verifiedAt = claims.vat ? new Date(claims.vat * 1000) : null;
      return {
        id: claims.sub,
        chatbotId,
        verifiedAt:
          verifiedAt &&
          Date.now() - verifiedAt.getTime() < VERIFICATION_TTL_SECONDS * 1000
            ? verifiedAt
            : null,
        issuedAt: new Date(claims.iat * 1000),
      };
    } catch {
      return null;
    }
  }

  /** A new visitor id; the caller signs it with `issue`. */
  newVisitor(chatbotId: string): BotPageVisitor {
    return {
      id: randomUUID(),
      chatbotId,
      verifiedAt: null,
      issuedAt: new Date(),
    };
  }

  /** Sign the visitor and set the cookie. Called for a new visitor, after a code, and to rotate. */
  async issue(res: Response, visitor: BotPageVisitor): Promise<BotPageVisitor> {
    const token = await this.jwtService.signAsync(
      {
        typ: TOKEN_TYPE,
        bot: visitor.chatbotId,
        ...(visitor.verifiedAt
          ? { vat: Math.floor(visitor.verifiedAt.getTime() / 1000) }
          : {}),
      },
      {
        secret: this.secret(),
        algorithm: 'HS256',
        audience: AUDIENCE,
        subject: visitor.id,
        expiresIn: TOKEN_TTL_SECONDS,
        jwtid: randomUUID(),
      },
    );
    res.cookie(BotPageVisitorService.cookieName(visitor.chatbotId), token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.secureCookies(),
      path: BOT_PAGE_COOKIE_PATH,
      maxAge: TOKEN_TTL_SECONDS * 1000,
    });
    return { ...visitor, issuedAt: new Date() };
  }

  /** Re-sign a token that is more than a day old, so a stolen cookie goes stale. */
  async rotateIfDue(res: Response, visitor: BotPageVisitor): Promise<void> {
    if (Date.now() - visitor.issuedAt.getTime() > ROTATE_AFTER_SECONDS * 1000) {
      await this.issue(res, visitor);
    }
  }

  /** A short, stable, non-reversible tag for logs ("visitor 3fa9c2e1"). */
  static logTag(visitorId: string): string {
    return createHash('sha256').update(visitorId).digest('hex').slice(0, 8);
  }

  private secureCookies(): boolean {
    return this.config.botPage.baseUrl.startsWith('https://');
  }

  private secret(): string {
    const dedicated = this.config.botPage.visitorSecret;
    if (dedicated) return dedicated;
    const base = this.config.jwt.accessToken.secret;
    if (!base) throw new Error('Bot page visitor tokens are not configured');
    return createHmac('sha256', base).update(SECRET_LABEL).digest('hex');
  }
}

/** One cookie's value from a `Cookie` header. No cookie-parser in this app, and one is enough. */
export function readCookie(
  header: string | undefined,
  name: string,
): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}
