# Chunk 13 — Website widget (chat bubble)

> Brief for Claude Code. Read `docs/agents-v2/CONTEXT.md`, `v2-chunks.md`, `DESIGN.md`, `ONBOARDING-COPY.md`, `CHUNK-12B-NOTES.md` (bot page app, access, cookies, CORS), `CHUNK-20D-NOTES.md` (bot page restyle, brand object), then this file.
> Branch: the Slice 1 branch. Tag commits `[13]`. Repos: ally-web, ally-be.
> **Part of the POC:** 20d → 20a-2 → Q2a → **13** → 11a.

## Why

Owners want the assistant on their own website as a chat bubble in the corner, like Zoho SalesIQ or Intercom, without building anything. The bot page already does the chat, branding, access, pre-chat questions, streaming and safety. The widget is a small loader that opens that same experience in a panel.

## Scope

### 1. The snippet

- In the assistant home → **Share → On your website**: a one-line snippet to copy, for example:
  `<script src="https://<BOT_PAGE_BASE_URL>/widget.js" data-assistant="sunrise-mind" async></script>`
- Options (set in the dashboard, not in the snippet): bubble position (right or left), bubble label ("Ask us"), open on its own after N seconds (default off), show on phones (default on).
- **Allowed websites:** the owner lists the domains where the widget may load (for example `sunrisemind.in`). Anywhere else, it doesn't open. Stored with the bot page settings.
- Instructions for WordPress, Wix, Shopify and plain HTML in a collapsible help.

### 2. The loader (`widget.js`)

- Tiny (target under 10 KB gzipped), no framework, loaded async so it never slows the host site.
- Draws the bubble in the brand colour with the logo or the orb; on click, opens a panel (380 × 640 on desktop, full screen on phones) containing an **iframe of the bot page** in an embedded mode (`/b/<slug>?embed=1`): no cover screen, compact header with a close button.
- Talks to the iframe only through `postMessage` with a fixed origin check (open, close, unread count). No access to the host page's data.
- Shows an unread dot when a reply arrives while closed.
- Remembers open or closed per visitor; the conversation resumes like the bot page.

### 3. The embedded bot page

- Same app, same access rules, same pre-chat questions, same streaming and crisis handling, same feedback (Q2a).
- **Cookies inside an iframe:** third-party cookie rules may block the 12b visitor cookie. Choose and justify one approach (for example a partitioned cookie, or a short-lived token in the iframe URL exchanged for a session, stored in iframe storage). It must not weaken 12b's security.
- **Access:** invite-only and organisation modes work inside the panel (email and code). "Anyone with the link" stays gated by `botPagePublicAllowed`, exactly as on the bot page; while it's off, the widget only works for organisation or invited visitors and the dashboard says so with copy §22.
- Conversations are recorded with channel `web` and a `source: widget` marker plus the host page URL (no query string), shown as a **Website** badge in Conversations and the inbox.

### 4. Security

- `frame-ancestors` on the embed route limited to the owner's allowed domains (plus Ally's own).
- CORS and rate limits as on the bot page; the bot check (Turnstile) works inside the panel for public bots later.
- The loader never reads the host page's cookies or DOM beyond appending its own elements.

## Out of scope

Proactive messages from the widget ("Need help choosing?"). Continuing on WhatsApp with memory carried over (after memory, Stage 2). Custom CSS from owners.

## Tests

- **ally-web:** the loader builds the bubble, opens and closes the panel, unread dot, phone layout; the embedded mode hides the cover; postMessage origin checks; size check for `widget.js` in CI.
- **ally-be:** allowed-domain enforcement (`frame-ancestors`, and refusal from an unlisted domain); the session approach works with third-party cookies blocked (test in Chromium with them blocked); channel marker stored; crisis handling identical inside the widget.
- An e2e page that embeds the snippet on a test origin.

## Done when

- [ ] An owner copies one line into a website and a branded chat bubble appears
- [ ] Visitors chat with the same assistant, access rules and safety as the bot page, on desktop and phone
- [ ] It works with third-party cookies blocked, and only on allowed domains
- [ ] Widget chats appear in Conversations with a Website badge
- [ ] `CHUNK-13-NOTES.md`: the loader design, the cookie approach and why, the security choices, screenshots
