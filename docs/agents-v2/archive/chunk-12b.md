# Chunk 12b — Bot page: a shareable chat link

> Brief for Claude Code. Read `docs/agents-v2/CONTEXT.md`, `BUILDING-BLOCKS.md`, `SLICE-1.md`, `v2-chunks.md`, `CHUNK-12-NOTES.md` (especially its open items), the 3c notes (streaming), then this file.
> Branch: `feat/agents-v2-chunk-12b-bot-page` from master (after chunk 12 is merged). Repos: **ally-be**, **ally-web**, and **ally-ai** only if something in the stream contract needs it (it shouldn't).

## Why

This is the first time someone outside the dashboard can talk to a v2 bot without WhatsApp. An owner turns on a **bot page**, makes it look like their brand, decides who may use it, and shares a link. People chat in their phone's browser, with the same agent, safety rules and live streaming as Preview. Every conversation is saved in the shared store (chunk 12) and appears in the dashboard next to WhatsApp chats.

## Scope

### 1. Bot page settings (per bot)

- **On/off** and a **slug** (unique, URL-safe, editable; for example `mehta-clinic`). The link is `<BOT_PAGE_BASE_URL>/b/<slug>`. `BOT_PAGE_BASE_URL` is config, because Shehbaz is deciding the domain.
- **Branding:** logo (upload, or a URL), accent colour, cover title and subtitle, the assistant's display name and avatar (default: initials), up to **4 suggested questions**, a disclaimer line (prefilled from the bot's safety settings, for example "Not a crisis service"), and a footer link (privacy or website).
- **Access** (reuse the bot's existing access list where possible; record how in NOTES):
  - **Anyone with the link** (public)
  - **People in my organisation:** signed-in users of the owner's organisation, through the existing auth
  - **Specific people:** a list of emails (and phones if an OTP channel exists). A visitor enters their email, gets a **one-time code**, and is then verified
- **Pre-chat questions:** up to **8 fields**, each with a label, a type (short text, email, phone, single choice, date, consent checkbox) and a required flag, asked **one at a time** before the first message. A consent checkbox's wording is stored with its answer and a timestamp.
- **Limits:** messages per visitor per hour, message length, a daily message cap per bot. When the cap is hit, a friendly "busy, try later" appears and the owner is alerted once.
- **A public-health guard:** a platform setting `botPagePublicAllowed` (default **off**). While it's off, *public* access can't be chosen; organisation and invite-only can. It's switched on only after chunk 15a (gate G1b). Record this in NOTES.

Store this as a bot page record (settings jsonb plus slug and status) and an invites list, following repo conventions. Note the choice.

### 2. Public API (ally-be, no dashboard auth)

| Endpoint | Does |
|---|---|
| `GET /public/bots/:slug` | Branding, access mode, pre-chat questions and suggested questions. Nothing internal (no prompts, document ids or settings) |
| `POST /public/bots/:slug/session` | Starts or resumes a visitor session: a **signed, httpOnly visitor token** (random id). Runs the access check; for invite-only, starts the OTP flow |
| `POST /public/bots/:slug/otp/verify` | Verifies the code (hashed, expires in 10 minutes, at most 5 attempts) and marks the web identity verified |
| `POST /public/bots/:slug/intake` | Validates and saves the pre-chat answers to the conversation's `metadata.intake` (via `ConversationService.setMetadata`) |
| `POST /public/bots/:slug/messages/stream` | Sends one message and streams the reply: the same event contract as Preview's `/test/stream` (`run_started`, `status`, `step`, `token`, `final`, `error`) |
| `GET /public/bots/:slug/conversation` | Recent messages of the visitor's open conversation, so a reload resumes it |
| `POST /public/bots/:slug/conversation/new` | Starts a fresh conversation |

**How a message is handled:**
- `ConversationService.resolveContact(bot, 'web', visitorId, {verified})`, then `openConversation` (same idle-window rule), then `appendMessage` for the inbound message.
- The engine runs with channel `{type: 'web', capabilities: {streaming: true, maxReplyChars}}`: kill switch, bot status, the safety pre-steps (crisis keywords and the classifier, exactly as on WhatsApp), the agent, then the crisis hold on streamed text (3c).
- The reply is appended to the conversation, with run id, engine, citations and retrieval meta. Unanswered questions are filed as on WhatsApp.
- **Steps are never streamed to public visitors.** Status codes are fine ("Looking up…"). Run details and trace stay dashboard-only.

**Security:**
- A bot check (Cloudflare Turnstile or similar, keys from config; off locally) on session start for public bots.
- Rate limits per visitor and per IP.
- CORS limited to the bot page origin.
- Request size limits.
- No phone numbers, emails or message text in logs.
- Visitor tokens are signed and rotate.

### 3. The page (ally-web)

- A **new public app or route**, outside the admin dashboard's auth. Check how ally-web builds and deploys apps, pick the lightest option, and justify it in NOTES. It must be **mobile first**, fast to load (no admin bundle), and use the bot's branding.
- **Screens:**
  - **cover:** logo, title, subtitle, disclaimer, Start
  - **access:** an email and code entry if needed
  - **pre-chat questions,** one per screen, with progress
  - **chat:** suggested questions as chips; streaming status and text from 3c's hook, reused; sources shown under answers; a "New chat" button
  - **errors and limits**
- Accessible (labels, focus, contrast), and works in English and Hindi copy from `en.ts`-style constants.

### 4. Dashboard (ally-web admin), decided in chunk 12

- A **Bot page** tab on the bot:
  - on/off
  - slug, with a copy-link button and **QR code**
  - branding, with a **live phone-frame preview**
  - access, and the invite list
  - pre-chat questions (add, edit, reorder, delete)
  - suggested questions
  - limits
  - "Open page"
- **Conversations, unanswered questions and bot stats switch to the shared store:**
  - a **channel badge** (WhatsApp, Bot page) and a **channel filter**
  - **pre-chat answers** shown at the top of a bot page conversation
  - for the same WhatsApp data, the WhatsApp views must show exactly what they show today (snapshot or comparison test)
- Analytics and the number's last-message time stay on `wa_*` (chunk 12's notes).

## Out of scope

- Thumbs up or down and the scorecard (Q2).
- The website widget (13).
- Memory across conversations (8).
- File uploads and voice (9).
- Buttons and lists (10).
- The team inbox (11).
- Onboarding (20a).

## Tests

**ally-be:**
- Each access mode: public allowed only with `botPagePublicAllowed`; organisation; invite with OTP (correct, wrong, expired, too many tries).
- Rate limits and the daily cap.
- A turned-off or draft bot gives 404.
- Intake validation and storage.
- Messages land in the shared store.
- Crisis on the web channel: a crisis phrase gives only the crisis reply and the held tokens are dropped.
- The stream's `final` equals the non-stream result.
- No steps in public events.
- Unanswered filing.
- Visitor resume, and new conversation.
- The dashboard Conversations and Unanswered views on the shared store match today's for WhatsApp data.

**ally-web:**
- The public page flows: cover → access → pre-chat → chat; streaming; resume; limits.
- The Bot page tab (preview updates, QR, admin rules).
- The channel badge and filter.

The full suites, lint, typecheck and build for each app. No `--no-verify`.

## Done when

- [ ] A bot page can be turned on, branded, given access rules and pre-chat questions, and shared by link and QR
- [ ] On a phone browser: open the link, answer the pre-chat questions, chat with streaming, reload and resume, start a new chat
- [ ] Invite-only asks for an email and code; organisation-only needs sign-in; public is blocked until `botPagePublicAllowed`
- [ ] The dashboard shows WhatsApp and bot page conversations in one list, with badges, a filter and pre-chat answers; WhatsApp views unchanged
- [ ] Crisis handling identical to WhatsApp; no steps or internal data on the public page
- [ ] `CHUNK-12B-NOTES.md`: code map, hosting choice, data model, security choices, how to test, open items (Q2 thumbs, 13 widget reuse, domain, `botPagePublicAllowed` before 15a)

## How Shehbaz tests it

1. Suites; run migrations; start the public app locally.
2. Dashboard → Sunrise Mind → **Bot page**: turn it on, set the slug `sunrise-mind`, upload a logo, pick a colour, add 3 suggested questions and 2 pre-chat questions (name; reason, as a choice). Access: **Specific people**, with your email.
3. Open the link on your phone (or a narrow browser window). Enter your email and the code, answer the pre-chat questions, and ask the Sunrise test sheet's B and C questions. Watch them stream. Reload: the chat resumes. Tap New chat.
4. Send a crisis phrase: only the crisis reply appears.
5. Dashboard → Conversations: your bot page chat appears with a **Bot page** badge and your pre-chat answers; WhatsApp chats look as before.
6. Switch access to **Anyone**: it's blocked until `botPagePublicAllowed` is on. Turn it on locally, open the link in a private window, and chat without signing in.
7. Send messages quickly until the rate limit appears.
