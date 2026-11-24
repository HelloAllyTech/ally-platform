# Bot page addresses and custom domains (Assistants stage 7)

## The default address

Every bot page has an address assigned by Ally: `<BOT_PAGE_CHAT_URL>/<public_id>`, where
`public_id` is 8 random lower-case letters and digits (`chatbot_pages.public_id`, migration
`1987600000000`). Owners cannot choose or change it. `BOT_PAGE_CHAT_URL` defaults to
`<BOT_PAGE_BASE_URL>/chat`. The admin app serves `/chat/<id>` through the same `b.html` handover
as `/b/<slug>`. To show `https://app.helloally.ai/chat/<id>` without the `/admin` prefix, the CDN
or proxy must route `/chat/*` to the admin app's `index.html` (or `b.html`), and then
`BOT_PAGE_CHAT_URL` is set to that origin plus `/chat`.

Old links keep working:

- `/b/<slug>`: the page app loads the page by its slug, then replaces the URL with
  `/chat/<public_id>`. This is a client-side redirect. For a real HTTP 301, add a rule at the
  proxy or CDN: `/b/*` → the page app, which redirects. A server-side 301 would need a lookup the
  proxy can't do on its own.
- Widget embeds: `GET /api/v1/public/widget/<key>` accepts the slug or the `public_id`, and returns
  `pageUrl` on the new address.
- Every public route (`/api/v1/public/bots/<key>/...`, `/api/v1/public/bot-images/<key>/...`)
  accepts the `public_id`, the legacy slug, or a verified custom domain's host as `<key>`.

## Custom domains

An owner adds a host (one per assistant) in Channels → Your own web address. Ally shows two DNS
records:

| Type  | Name                            | Value                                                       |
| ----- | ------------------------------- | ----------------------------------------------------------- |
| CNAME | `chat.example.org`              | `BOT_PAGE_DOMAIN_TARGET` (default: the bot page's own host) |
| TXT   | `_ally-verify.chat.example.org` | `ally-verify=<token>`                                       |

`POST /api/v1/chatbots/:id/page/domains/:domainId/check` reads both with `node:dns` and sets
`chatbot_domains.status` to `verified` (both right) or `failed` (with what DNS returned for each).
A root domain cannot have a CNAME, so an ALIAS/ANAME that resolves to the target's addresses also
passes. The check is run by the owner; nothing re-checks a verified domain later.

The default `/chat/<id>` address always keeps working, whatever happens to the custom domain.

### What has to be configured outside this repository

Certificates and routing are infrastructure. Verification alone does not make the domain serve
anything. The dashboard tells the owner "we'll confirm when your domain is ready" and does not
claim it is live.

1. **Certificates.** Either Caddy with on-demand TLS, using
   `GET /api/v1/public/bot-domains/check?domain=<host>` as the `ask` endpoint (200 only for a
   verified domain, 404 otherwise), or CloudFront with a certificate added per domain by hand or
   by a provisioning job that reads verified domains.
2. **Routing.** For a verified host, serve the admin app's `b.html` for every path. The page app
   uses the hostname as the page key when the path is not `/chat/<id>` or `/b/<slug>`.
3. **The API on the same origin.** Proxy `https://<custom host>/api/*` to ally-be, keeping the
   `Host` header. The page app calls the API on its own origin when it runs on a custom domain, so
   the visitor cookie (`SameSite=Lax`) stays first-party. A cross-site call to `api.helloally.ai`
   would not carry that cookie.

The public routes accept a verified custom domain's origin for that page only: in the bot page's
origin guard (`BotPageGuardMiddleware`) and in the app's CORS (`registerPublicBotOriginCheck` in
`common/cors/app-cors.ts`, registered by `BotPageDomainService`).

## The website widget

Since stage 7 the widget may load on any site. `allowedDomains` is kept in storage but no longer
consulted; `frame-policy` answers `frame-ancestors *`. Chatting still needs sign-in. Each config
read is noted in `widget_sites` (one database write per site per hour, at most 500 sites per
assistant). `GET /api/v1/chatbots/:id/widget-sites` (editors) lists them.
