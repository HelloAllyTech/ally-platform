# Chunk 13 notes: the website widget

## Report: 13 is done (10 Nov 2026)

An owner copies one line into their website, and a chat bubble in their brand colour appears. Clicking it opens their assistant's bot page in a panel: the same access rules, pre-chat questions, streaming, crisis handling, thumbs, "Talk to a person" and live team replies. It opens only on the websites the owner lists, and it works with third-party cookies blocked.

| Commit | What |
|---|---|
| `3c8f8777d` | `[11a]` "Pick a chat to read it." in the inbox |
| `0d7f22ed9` | ally-be: allowed websites, the embed session, the loader's settings route, the Website source |
| `b7929ee28` | ally-web: `widget.js`, the bot page framed, Share → On your website, the inbox's Website label, e2e |
| this one | Notes, LAUNCH-CHECKLIST, the current chunk |

**Checks:**
- ally-be: full suite (14,761 passed), lint, typecheck and build.
- ally-web: full admin suite (9,175 passed), lint, format and typecheck.
- `widget.js` is 2.4 KB gzipped (budget 10 KB, now a CI step).
- Playwright widget runs on desktop and phone, plus the cookie run; baselines and axe.
- Postgres inbox spec on a real database.
- Checked live on the local stack (below).

### How the 11a open items landed

The widget **is** the bot page in a frame, so it sends through the bot page's service:
- the single `handled_by` switch, hand-over and crisis apply unchanged (tested: a widget message reaches the engine with exactly the same call as the page);
- "Talk to a person" is there;
- the visitor stream brings team replies live, and tells the bubble to show a dot when the panel is shut.

### Your approval items

1. **Cookie (D1): a partitioned cookie.** Its attributes are httpOnly, `SameSite=None; Secure; Partitioned`. It is the widget's own; the bot page's cookie is unchanged.
   - **Chrome with third-party cookies blocked:** verified against the real ally-be. Chromium was launched with third-party cookies blocked, framed on another site, and called the real probe route: `{"cookies":true}`. The e2e test also shows an ordinary third-party cookie *is* dropped in the same browser while ours gets through.
   - **Safari:** I have no Safari here, so I couldn't see what it does. The pre-approved fallback is built and switches itself on.
     - When the widget opens, it sets a throwaway cookie the same way and reads it back.
     - If it doesn't come back (Safari dropping it, or any other browser), the frame asks ally-be for its token in the session answer and keeps it in memory only. The chat then restarts on reload in that browser.
     - **Please try it in Safari** (step 7 below), and I'll record what it did here.
2. **Allowed websites (D2):** enforced by the page and ally-be now; `frame-ancestors` is on LAUNCH-CHECKLIST, with the endpoint infra needs (`/frame-policy`).
3. **Shared hosts:** the Public Suffix List (`psl` 1.15.0, the version already in the monorepo's lockfile; a new ally-be dependency).
   - Bare `blogspot.com`, `github.io`, `vercel.app`, `netlify.app`, `wixsite.com`, `myshopify.com` and `co.in` are refused with a plain reason.
   - `myclinic.wixsite.com` is accepted and never matches `other.wixsite.com`.
4. **localhost and 127.0.0.1:** accepted outside production; refused in production ("localhost only works while testing…"). Both are tested, and a stored localhost entry is ignored in production too.
5. **`referrerpolicy="strict-origin-when-cross-origin"`** on the iframe. With no host found, the page refuses (tested).
6. **CSP help:** in "Add it to any website" and below.
   - Allow the bot page origin in `script-src` and `frame-src`, as you asked.
   - **One addition:** the API origin in `connect-src` (the loader reads its settings from there) and `img-src` (the logo). Without those, a strict CSP would still block the bubble.
7. **The iframe** has `title="Chat with {business}"` and `allow=""`.
8. **The Overview** doesn't split numbers by channel, so it's unchanged.

### How Shehbaz tests it

1. **Pull, and make sure the stack is running.**
   - ally-be needs `psl`. In the container: `docker exec ally-be-app-1 sh -c "cd /app && npm install"`. I've already installed it there.
   - Open `http://localhost:8081/widget.js`: you should see the script.
2. **Choose the websites.** AI Chatbots → open an assistant whose page is **on** (for example *Sunrise Mind Clinic 9*, invite-only) → **Share → On your website**.
   - Type `wixsite.com` and press Add: refused, with the reason.
   - Add `localhost`: it's listed.
   - Copy the code.
3. **Make a "website".** Save this as `~/Desktop/site/index.html`, pasting your copied line where shown:
   ```html
   <!doctype html><html><body><h1>My clinic</h1>
   <!-- paste the line here -->
   </body></html>
   ```
   Then run `cd ~/Desktop/site && python3 -m http.server 5500`.
4. **Open `http://localhost:5500`.** The bubble ("Ask us") sits bottom right in the assistant's colour.
   - Click it: the panel opens straight to "Confirm your email" (no cover).
   - Use an invited email, enter the code, and chat. The reply streams, with sources and thumbs.
5. **Talk to a person.**
   - In the panel, press **Talk to a person**.
   - In the dashboard, AI Chatbots → **Inbox**: the chat is under Needs a person, labelled **Website**. The channel filter has **Website**.
   - Take over and reply: the reply appears live in the panel.
   - Close the panel and reply again: the bubble shows a red dot.
6. **Crisis:** write "I don't want to be here any more" in the panel. The crisis reply comes at once, as on the page.
7. **Reload** the site: the panel's open or closed state and the chat come back.
   - **In Safari**, do steps 4–7 and tell me whether the chat survives a reload. If it doesn't, the in-memory fallback is working as designed; I'll note it.
8. **Remove `localhost`** in Share: the next message in the panel is refused ("This chat isn't available on this website."), and after a reload no bubble appears.
9. **Settings:** set the bubble to Left and change its label; tick "Open on its own" (in a private window, it opens after the delay); untick "Show on phones" and check a phone-width window has no bubble.

## 1. Code map

### ally-be

- **`chatbot/bot-page/widget-host.ts`** (pure):
  - `normaliseDomain` (scheme, `www`, path and port dropped; refusals `invalid`, `shared`, `local`);
  - `hostAllowed` (the domain or its subdomains);
  - `cleanPageUrl` (no query or fragment, and only on the verified host);
  - `frameAncestors`.
- **`chatbot/type/bot-page.type.ts`:** `BotPageSettings.widget` (`BotPageWidget`), with defaults, merge and bounds. `BotPageService.save` keeps the stored widget, as it does the brand, so the classic tab and publish can't drop or forge it.
- **`bot-draft/home/home-fields.ts`:** the `widget` field. `parseWidget` normalises and refuses with deck §22's words.
- **`chatbot/bot-page/bot-page-visitor.service.ts`:**
  - the widget's own cookie (`ally_bpe_<12 hex>`, `EMBED_COOKIE`) with `emb`/`emp` claims;
  - `read()` reads only the widget's cookie, or its `X-Ally-Visitor` token, on requests marked `X-Ally-Embed: 1`, and only the page's cookie otherwise. A widget token is a stranger to the page, and the reverse.
  - the probe cookie;
  - no rotation for the in-memory token.
- **`chatbot/bot-page/bot-page-public.service.ts`:**
  - `embedOf` (the host check at session and verify, 403 `host_not_allowed`);
  - `requireReady` re-checks the bound host on every request;
  - `withToken` (the token only when the frame asks with `X-Ally-Embed-Token`);
  - `sourceOf` (`metadata.source`);
  - `widgetConfig` and `framePolicy`.
- **`chatbot/bot-page/bot-page-public.controller.ts`:** `POST`/`GET :slug/embed/probe`.
- **`chatbot/bot-page/widget-public.controller.ts`:** `GET v1/public/widget/:slug` (sets its own CORS for allowed origins only, without credentials) and `…/frame-policy`.
- **`common/cors/app-cors.ts`** (used by `main.ts`): the app's CORS list applies to every route except the widget's two, matched whole against the raw URL: `/api/v1/public/widget/<slug>` and `…/<slug>/frame-policy`, each with an optional query.
  - `/widgetX`, deeper paths, `..` segments and encoded slashes don't match, so they keep the normal list.
  - Leaving a route out only drops this layer's headers (`origin: false`). It never allows anything, so a mistaken match would fail closed.
  - `common/cors/test/app-cors.spec.ts` covers the matcher, and the real `cors` middleware over HTTP; also checked live.
- **`chatbot/inbox/`:** `InboxItem.source`, and the `widget` channel filter (`web` now means the bot page without the widget).
- **Rate limit:** `BOT_PAGE_IP_LIMITS.widget` (600/h per IP; the settings are read on every page of the owner's site).
- **`DATA_SCHEMA.md`:** `settings.widget` and `metadata.source`.

### ally-web

- **`src/widget/loader.ts`** (`/widget.js`):
  - the bubble in a shadow root;
  - the frame on first open;
  - postMessage with origin and window checks;
  - the dot, Esc, `localStorage` `ally-widget:<slug>`, auto-open, the phone layout.
  - Built by `vite.widget.config.ts`. The dashboard's build runs it too (the `widgetBundle` plugin, so every deploy ships it), and the dev server compiles it on request.
- **`src/botPage/embed.ts`:** `embedContext` (host from `ancestorOrigins`, else the referrer; null when unnamed) and `bridge`.
- **`src/botPage/api.ts`:** `startEmbed` (probe, then token mode only if needed), embed headers, and the `embed` body on session and verify.
- **`src/botPage/BotPageApp.tsx`:** no cover in the widget (unless a public page needs Turnstile), Close, unread, and the refused-host screen. `Chat.tsx` has the Close in the header.
- **`pages/AssistantHome/sections/Website.tsx`** (in Share): the snippet, websites, options and help. `types/assistantHome.ts` has `WidgetSettings`.
- **`pages/Inbox/copy.ts`:** `channelLabel` (Website). `Inbox.tsx` has the filter option, and `ChatView.tsx` the label.
- **`scripts/check-widget-size.mjs`** and the CI step "Widget size".
- **e2e:**
  - `widget.e2e.ts`: customer.test on another origin; desktop and phone; an unlisted site.
  - `widget-cookies.e2e.ts`: third-party cookies blocked, against a real in-test server, since a mocked response's cookies skip the browser's rules.
  - `widget.fixture.ts`.
  - New baselines `widget-closed.png`, `widget-open.png`, and `home-share.png` refreshed.

## 2. Security choices

- **The host comes from the browser:** `location.ancestorOrigins[0]` (Chrome and Safari), else the referrer's origin (Firefox; the loader asks for one). Never from the loader or the URL, and a page framed without `?embed=1` runs the same check. No host means refused.
- **ally-be decides:**
  - at session and verify, the host must be an allowed website (or the page's own origin);
  - it is signed into the token and re-checked on every request, so removing a website ends chats at once;
  - the loader's settings route answers only allowed origins, so nothing is drawn elsewhere.
- **Why this holds before `frame-ancestors`:**
  - `b.html` is a JavaScript-only app, so a frame without scripts shows nothing;
  - with scripts, our code runs the check;
  - the header (LAUNCH-CHECKLIST) is still the proper belt.
- **CSRF:** `SameSite=None` adds no CSRF risk. The 12b Origin guard still refuses every browser origin but the page's. The probe and token routes sit behind it too.
- **The token fallback:** only when the probe fails and the frame asks. It is held in memory (never stored) and sent in a header only on widget requests.
- **The loader:**
  - appends one element (a shadow root) and keeps one `localStorage` key;
  - reads no cookies or DOM of the host page;
  - its settings request is sent without credentials;
  - the iframe has `allow=""`.
- **Rate limits** as on the bot page, plus 600/h per IP for the settings.

## 3. Notes and open items

- **Not built (as briefed):** proactive messages; Continue on WhatsApp; custom CSS. `v2-chunks.md`'s row 13 still lists WhatsApp memory; the brief moved it to after memory (the brief wins).
- **The classic Conversations tab** (`?view=classic`) has no Website badge, since the home uses the inbox now.
- **The inbox's Bot page filter** now excludes widget chats (they have their own filter).
- **A page chat continued in the widget** by the same verified email (same contact, same open thread) becomes marked Website from then on.
- **A fix on the bot page itself:** a focused message box drew a second focus ring inside the first (the page-wide focus style outranked the box's). The box's own ring stays.
- **Tests turn off Chromium's local-network checks:** a test site counts as public, and `widget.js` comes from localhost, which Chromium otherwise blocks. Real owners' sites and our script are both public.
- **Public pages** (when `botPagePublicAllowed` comes on in Stage 6) keep the cover inside the panel when Turnstile is configured, because the bot check lives there.
