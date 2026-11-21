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
    req: { url?: string },
    callback: (error: Error | null, options: CorsOptions) => void,
  ): void => {
    if (isWidgetRoute(req.url)) return callback(null, { origin: false });
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
