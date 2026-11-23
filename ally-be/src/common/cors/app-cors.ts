import { Logger } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * The website widget's two public routes (chunk 13), and nothing else: its settings,
 * `/api/v1/public/widget/<slug>`, and `/api/v1/public/widget/<slug>/frame-policy`, each with an
 * optional query. Matched against the raw request URL, whole, so a longer path (`/widgetX`, a
 * deeper path, `..` segments) never matches. Owners' sites call these, so they can't be on the
 * app's list; the controller answers CORS itself, only to that bot's allowed websites.
 */
const WIDGET_ROUTE =
  /^\/api\/v1\/public\/widget\/[^/?#]+(?:\/frame-policy)?(?:\?[^#]*)?$/;

export function isWidgetRoute(url: string | undefined): boolean {
  return WIDGET_ROUTE.test(url ?? '');
}

/**
 * The directory's public landing-page reads (`/api/v1/public/directory/collections/<slug>` and
 * `/domains/<host>`). A collection's page can be served from the owner's own domain, so any origin
 * may read these two GETs. They carry no cookies or tokens and expose only what the owner
 * published, so they are answered with `*` and no credentials, never the app's allow-list.
 */
const DIRECTORY_PUBLIC_ROUTE =
  /^\/api\/v1\/public\/directory\/(?:collections|domains)\/[^/?#]+(?:\?[^#]*)?$/;

export function isDirectoryPublicRoute(url: string | undefined): boolean {
  return DIRECTORY_PUBLIC_ROUTE.test(url ?? '');
}

/**
 * Stage 7: the bot page's public routes (`/api/v1/public/bots/<key>/...`) also answer the page's
 * own verified custom domain. The check lives in BotPageDomainService, which registers it here on
 * start, so this file needs no database and main.ts no wiring. Unregistered: nothing extra passes.
 */
type PublicBotOriginCheck = (
  origin: string,
  key: string | null,
) => Promise<boolean>;
let publicBotOriginCheck: PublicBotOriginCheck | null = null;

export function registerPublicBotOriginCheck(
  check: PublicBotOriginCheck | null,
): void {
  publicBotOriginCheck = check;
}

const PUBLIC_BOT_ROUTE = /^\/api\/v1\/public\/bots\/([^/?#]+)/;

/** The page key in a public bot-page URL, or null when the URL is not one. */
export function publicBotKey(url: string | undefined): string | null {
  const match = PUBLIC_BOT_ROUTE.exec(url ?? '');
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/**
 * The app's CORS: the `ALLOWED_ORIGINS` list, with credentials, for every route but the widget's.
 * Leaving the widget's routes out only removes this layer's headers (`origin: false`); it never
 * allows anything, so a path that matched by mistake would fail closed.
 */
export function appCorsDelegate(allowedOrigins: () => string[]) {
  const options: CorsOptions = {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins().includes(origin)) {
        callback(null, true);
      } else {
        Logger.warn(`Blocked CORS request from origin: ${origin}`, 'CORS');
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  };
  return (
    req: { url?: string; headers?: { origin?: string } },
    callback: (error: Error | null, options: CorsOptions) => void,
  ): void => {
    if (isWidgetRoute(req.url)) return callback(null, { origin: false });
    const origin = req.headers?.origin;
    const key = publicBotKey(req.url);
    if (
      key &&
      origin &&
      publicBotOriginCheck &&
      !allowedOrigins().includes(origin)
    ) {
      publicBotOriginCheck(origin, key)
        .then((ok) =>
          callback(null, ok ? { ...options, origin: [origin] } : options),
        )
        .catch(() => callback(null, options));
      return;
    }
    if (isDirectoryPublicRoute(req.url)) {
      return callback(null, {
        origin: '*',
        credentials: false,
        methods: ['GET'],
      });
    }
    callback(null, options);
  };
}
