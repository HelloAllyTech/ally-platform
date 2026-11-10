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
  /**
   * In the website widget (chunk 13): the host page's origin the server accepted, and the page the
   * bubble was on. Re-checked against the allowed websites on every request.
   */
  embed?: { host: string; page: string | null } | null;
  /** How the request carried it: the cookie, or the widget's in-memory token (cookie blocked). */
  via?: 'cookie' | 'header';
}

/** A signed visitor, and the token, for the widget when its browser drops the cookie. */
export type IssuedVisitor = BotPageVisitor & { token: string };

interface VisitorClaims {
  sub?: string;
  typ?: string;
  bot?: string;
  vat?: number;
  iat?: number;
  /** The widget's host origin and page (chunk 13). */
  emb?: string;
  emp?: string;
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
/** Sent by the bot page when it runs inside the website widget (chunk 13). */
export const EMBED_HEADER = 'x-ally-embed';
/** The widget's in-memory visitor token, when its browser blocks even partitioned cookies. */
export const VISITOR_TOKEN_HEADER = 'x-ally-visitor';
/** A throwaway cookie the widget sets and reads back to learn whether cookies reach the API. */
export const EMBED_PROBE_COOKIE = 'ally_bpe_probe';

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
 *
 * Inside the website widget (chunk 13) the page is framed by another site, where a Lax cookie is
 * neither stored nor sent. There it gets its own cookie: still httpOnly, `SameSite=None; Secure;
 * Partitioned` (CHIPS), so it is kept per host site and can't follow a visitor between sites. The
 * Origin guard still refuses every browser origin but the page's own, so None doesn't open CSRF.
 * A browser that drops even that gets the token in the session answer, held in the frame's memory
 * and sent in a header (CHUNK-13-NOTES).
 */
@Injectable()
export class BotPageVisitorService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
  ) {}

  static cookieName(chatbotId: string, embed = false): string {
    return `ally_bp${embed ? 'e' : ''}_${chatbotId.replace(/-/g, '').slice(0, 12)}`;
  }

  /** Whether the request comes from the bot page inside the website widget. */
  static isEmbed(req: Request): boolean {
    return req.headers[EMBED_HEADER] === '1';
  }

  /**
   * The visitor behind the request's cookie for this bot, or null. Never throws. The widget's
   * requests read only the widget's cookie (or its token), and the page's only the page's, so a
   * visitor of one is a stranger to the other.
   */
  async read(req: Request, chatbotId: string): Promise<BotPageVisitor | null> {
    const embed = BotPageVisitorService.isEmbed(req);
    const cookie = readCookie(
      req.headers.cookie,
      BotPageVisitorService.cookieName(chatbotId, embed),
    );
    const header = embed ? req.headers[VISITOR_TOKEN_HEADER] : undefined;
    const token =
      cookie ?? (typeof header === 'string' && header ? header : null);
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
        !claims.iat ||
        embed !== Boolean(claims.emb)
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
        embed: claims.emb
          ? { host: claims.emb, page: claims.emp ?? null }
          : null,
        via: cookie ? 'cookie' : 'header',
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
  async issue(res: Response, visitor: BotPageVisitor): Promise<IssuedVisitor> {
    const embed = visitor.embed ?? null;
    const token = await this.jwtService.signAsync(
      {
        typ: TOKEN_TYPE,
        bot: visitor.chatbotId,
        ...(visitor.verifiedAt
          ? { vat: Math.floor(visitor.verifiedAt.getTime() / 1000) }
          : {}),
        ...(embed
          ? { emb: embed.host, ...(embed.page ? { emp: embed.page } : {}) }
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
    res.cookie(
      BotPageVisitorService.cookieName(visitor.chatbotId, Boolean(embed)),
      token,
      embed ? EMBED_COOKIE : { ...PAGE_COOKIE, secure: this.secureCookies() },
    );
    return { ...visitor, issuedAt: new Date(), token };
  }

  /**
   * Re-sign a token that is more than a day old, so a stolen cookie goes stale. Not the widget's
   * in-memory token: it lives only as long as the frame, and a new one couldn't reach it mid-stream.
   */
  async rotateIfDue(res: Response, visitor: BotPageVisitor): Promise<void> {
    if (visitor.via === 'header') return;
    if (Date.now() - visitor.issuedAt.getTime() > ROTATE_AFTER_SECONDS * 1000) {
      await this.issue(res, visitor);
    }
  }

  /** The widget's cookie check: set a throwaway cookie the same way as the real one. */
  static setProbe(res: Response): void {
    res.cookie(EMBED_PROBE_COOKIE, '1', { ...EMBED_COOKIE, maxAge: 60_000 });
  }

  static readProbe(req: Request): boolean {
    return readCookie(req.headers.cookie, EMBED_PROBE_COOKIE) === '1';
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

const PAGE_COOKIE = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: BOT_PAGE_COOKIE_PATH,
  maxAge: TOKEN_TTL_SECONDS * 1000,
};

/** The widget's cookie: framed by another site, so None, which needs Secure, and partitioned. */
const EMBED_COOKIE = {
  httpOnly: true,
  sameSite: 'none' as const,
  secure: true,
  partitioned: true,
  path: BOT_PAGE_COOKIE_PATH,
  maxAge: TOKEN_TTL_SECONDS * 1000,
};

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
