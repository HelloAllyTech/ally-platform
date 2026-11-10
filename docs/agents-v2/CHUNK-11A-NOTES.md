# Chunk 11a notes: Inbox (light), with a person stepping in

**Brief:** [chunk-11a.md](./chunk-11a.md). **Copy:** [ONBOARDING-COPY.md](./ONBOARDING-COPY.md) §23. **Branch:** `feat/agents-v2-chunk-12-shared-store`; commits tagged `[11a]`. **Stage 1, the POC:** 20a-2 ✅ → Q2a ✅ → **11a** (13, the widget, is being built in another session; 20d-2 and CL1 next week).

> **⏸ Waiting for Shehbaz's approval of this plan (§2), and answers to the questions in §3.** Nothing is built yet.

## 1. Code map: what exists today

- **The engine** (`ally-be/src/chatbot/engine/chatbot-engine.service.ts`) has exactly three callers, and it never sends or stores anything. It returns a `ChatbotDecision`; each channel sends and stores the reply itself.
  - **WhatsApp:** webhook → SQS → `WhatsAppInboundService.handle` (`whatsapp/service/whatsapp-inbound.service.ts:160`). The order is: resolve the bot, dedupe, kill switch, `resolveConversation` (:213), shared-store mirror (:229), blocked, media, rate limit, consent (:264), typing indicator (:279), **`engine.respond` (:305)**, `reply()` → `provider.sendText` (:356/:792).
  - **Bot page:** `POST v1/public/bots/:slug/messages/stream` → `BotPagePublicService.respond` (`chatbot/bot-page/bot-page-public.service.ts:540`). It stores the inbound message (:553), then calls **`engine.respond` (:565)**, then stores the reply.
  - **Website widget (13):** not on this branch. Its brief has it reuse the bot page's public API, so it reaches the engine through `BotPagePublicService.respond`.
  - **Try it / Preview:** `ChatbotService.test` → `engine.respond` with a made-up `preview-…` conversation id. **Preview stores no conversation**, so no person can ever hold it.
- **Crisis** is checked inside `respond`, in three ways:
  - the keyword templates, step 1, before any model call (:137–183);
  - the LLM classifier, run in parallel with the answer in `answer()` (:252), where crisis wins (:269);
  - the classifier before `refuse()` for a bot the asker can't use.

  A crisis decision carries `alert`, which each channel emits as the `'exception'` event, which goes to Slack.
- **Shared store:**
  - `chatbot_conversations` (`metadata` jsonb, `status`, `channel`, `last_message_at`; a WhatsApp chat reuses its `wa_conversations.id`).
  - `chatbot_messages` (`role` is only `user` / `assistant`; `handled_by` varchar 24).
  - `ConversationService.setMetadata` merges jsonb with **no lock**.
  - WhatsApp is dual-written: `wa_*` stays the source of truth, and it's mirrored into the shared store only when the platform flag `sharedStoreWrites` is on.
  - Dashboard reads switch on `dashboardReadsFrom`.
- **Sending on WhatsApp:**
  - Only `sendText` exists, with no Meta template messages and no 24-hour window tracking.
  - Meta's out-of-window error (131047) is treated as a terminal 4xx.
  - The outbound `wa_messages` row is saved before the send, inside the private `reply()`.
  - One business number per connector, and a connector per bot.
- **Bot page delivery:** the visitor gets messages only in the SSE response to their own message, plus `GET …/conversation` on load. Nothing can reach an open page from outside today.
- **Realtime:**
  - Socket.IO gateways exist (e.g. `/helpline-chat`) but have **no Redis adapter**, so a socket on instance A misses events from instance B; the helpline works around this with a broker fan-out.
  - SSE plus Redis pub/sub is proven in onboarding: `SseWriter` (10 s ping), `BotDraftEventsService` (one `psubscribe` per process), `GET bot-drafts/:id/events` (sends `state` first so a reconnect redraws).
  - The web side has `readSse`, `fetchWithReauth` (refresh on 401) and the reconnect loop in `useBotDraftSession`.
- **Not there yet:** detection of a request for a person (in any language); a "declined twice" counter; opening hours; a human message role; first names (`users.name` only); browser notifications in the admin app.
- **Who sees what:** `ChatbotAccessService.accessibleChatbotIds` / `assert(id, role)`; roles VIEWER < EDITOR < OWNER per assistant.
- **First-one-wins pattern to reuse:** the helpline's claim, `UPDATE … WHERE claimed_by IS NULL RETURNING` (zero rows means someone else has it).
- **Scheduler:** 5/15/30 min, hourly, daily and weekly jobs (no 1-minute job), each under a Postgres advisory lock.

## 2. Plan

### 2.1 The single switch: `handled_by` on the conversation

**Data (one migration, all additive):**
- `chatbot_conversations` gains:
  - **`handled_by_user_id`** (int, null = the assistant) and `handled_since` (timestamp);
  - `needs_person_since` (timestamp) and `needs_person_reason` (`asked` | `declined_twice`);
  - `safety_at` (timestamp of the last crisis reply);
  - `last_human_reply_at` (timestamp).
- **Columns, not metadata:** taking over must be atomic, and the inbox filters on these fields. `setMetadata` merges without a lock, and the inbox would need jsonb indexes.

**The switch is `handled_by_user_id IS NOT NULL`, and the engine is the one place it's checked.**

- **The check sits inside `ChatbotEngineService.respond`, not in each channel.** WhatsApp, the bot page and the future widget all reach the engine through `respond`, so no channel can forget it. Adding a channel can't skip it either: the switch is read from the conversation id every turn already carries.
- **The order inside `respond` becomes:**
  1. **Crisis first, always**: the keyword templates (no model), then **the crisis classifier on its own** (a new `crisisOnly(turn)` that both `respond` and today's `answer()` use).
  2. **If a crisis:** the crisis reply goes out immediately, as today, whoever holds the chat. The conversation is stamped `safety_at`, so the inbox shows it as **Safety** at the top. The usual Slack alert still fires, and the person holding the chat sees it live.
  3. **If not a crisis and a person holds the chat:** return `{ held: true }`. No reply, no model call, no unanswered filing. The visitor's message is already stored; the inbox shows it, and the team is notified.
  4. **Otherwise:** today's path, unchanged (the answer, with the classifier still in parallel).
- **What each channel does with `held`:**

  | Channel | While a person holds the chat |
  |---|---|
  | **WhatsApp** (`whatsapp-inbound.service.ts`) | Sends nothing and shows no typing indicator. The inbound is still stored and mirrored, and consent and rate limits still apply first. |
  | **Bot page** (`bot-page-public.service.ts` `respond` and the stream) | The visitor's message is stored, and the stream ends with `final: { held: true }`. The page shows the message as sent, with no reply. |
  | **Widget (13)** | Through the bot page's API, so the same. Recorded in `CHUNK-13-NOTES.md` as a rule for the other session: always go through `BotPagePublicService.respond`. |
  | **Try it** | Never held: Preview has no stored conversation, and its `preview-…` ids are never looked up. |

- **A test fails if any path answers while a chat is held.** One engine-level spec checks the switch. Then one spec per channel holds a chat and asserts no send:
  - WhatsApp: no `sendText`;
  - bot page: no assistant message stored;
  - the widget's route, once 13 lands.
- **A crisis while held:** a spec holds a chat, sends a crisis message on each channel, and asserts the crisis reply is sent at once and the chat stays with the person.
- **Not in the switch:** the WhatsApp kill switch, consent and rate limits still come first, exactly as now.

### 2.2 Handing over to a person

- **When a chat becomes "Needs a person":**
  - **The visitor asks for one.** Detected in ally-be before the engine runs, from a small phrase list: "talk to a person / human / someone / an agent", "real person", plus Hindi and Hinglish ("insaan se baat", "kisi se baat karni hai", "इंसान से बात करनी है", "किसी से बात"). It's tested, and it can't match inside a crisis message: crisis is checked first. *(Question 1: the brief says "the existing turn-type step", but no such detection exists, and adding a turn type changes the agent prompt.)*
  - **It couldn't help twice in a row:** its previous reply in this chat was `declined`, and this one is `declined` too.
  - **Never for a crisis:** those keep the crisis-only reply and alert, and get the Safety flag.
  - **Owner rules** wait for abilities (Stage 2+).
- **When it's flagged:** `needs_person_since` and the reason are set. The visitor gets **one** message:
  - in hours: "I've asked the team to join. They usually reply within {hours}."
  - out of hours: "The team is away now. They'll reply when they're back at {time}."

  On a second decline, this message goes out in place of the second "I don't know". The assistant keeps answering until someone takes over.

### 2.3 Taking over, replying, handing back

- **Take over:** `POST v1/inbox/conversations/:id/take-over` runs `UPDATE chatbot_conversations SET handled_by_user_id = $me, handled_since = now() WHERE id = $1 AND handled_by_user_id IS NULL RETURNING`.
  - **First one wins.** The other person gets 409 with the name of whoever has it ("{name} is replying in this chat").
  - Access: EDITOR or above on that assistant.
- **Reply:** `POST v1/inbox/conversations/:id/messages {text}`. Only the person holding the chat can reply; that's checked in the same statement.
  - Stored in the shared store with role **`agent_human`** and a new `chatbot_messages.sent_by_user_id`.
  - `recentHistory` passes it to the model as an assistant turn, so after a hand-back the assistant knows what was said.
  - The visitor sees "{first name} from {business}". The first name is the first word of `users.name`.
- **How a human reply is delivered on each channel:**

  | Channel | Delivery |
  |---|---|
  | **WhatsApp** | A new public `WhatsAppOutboundService.sendHumanReply(conversation, text, user)`. It writes the `wa_messages` row (still the source of truth) and mirrors it, then sends through the bot's own number (`provider.sendText`, with the existing retry). The text starts with "*{first name} from {business}*". |
  | **WhatsApp after 24 hours** | **Meta refuses a free-form message more than 24 hours after the visitor's last message.** The inbox shows when the window closes and refuses the reply up front with a plain message, rather than letting Meta reject it. There are no template messages until chunk 17 (out of scope). |
  | **Bot page and widget** | A new long-lived **visitor stream**, `GET v1/public/bots/:slug/conversation/events` (SSE, the visitor's existing cookie, the same access checks as the chat). It carries the person's replies and "the team has joined / handed back". |
  | **Bot page, page closed** | The reply is stored, and the visitor sees it next time they open the link (`GET …/conversation` already returns the thread). |
  | **Try it** | Not applicable: Preview has no stored chat. |

- **Hand back:** `POST …/hand-back` clears the switch. Only the holder or an OWNER can do it. The assistant answers the next visitor message, with the human replies in its history.
- **Auto hand-back:** a 15-minute job hands back any chat held for N hours (owner setting, default 12) with no reply from the team in that time. It sends "The team couldn't reply this time, so I'm back to help…" on the chat's channel; on WhatsApp, only if the 24-hour window is still open.

### 2.4 Realtime and reconnecting

**Server-sent events over Redis pub/sub for both the dashboard and the visitor**, not Socket.IO:
- The SSE pattern (`SseWriter`, a Redis publish fan-out with one `psubscribe` per process) is already proven in onboarding and works across instances.
- The Socket.IO gateways have no Redis adapter, so they'd miss events from other instances.

- **Dashboard:** `GET v1/inbox/events` (admin JWT, read through `fetch` and `readSse`, as onboarding does, since `EventSource` can't send the token).
  - Events: `message`, `state` (needs a person, taken over, handed back), `safety` and `read`. Each carries a conversation id and the counts, never message text.
  - The server sends only events for assistants the user can access (`accessibleChatbotIds`, re-checked every 5 minutes on the stream).
  - New `InboxEventsService`, modelled on `BotDraftEventsService`, on channel `inbox:<chatbotId>`.
- **Visitor:** `GET v1/public/bots/:slug/conversation/events`, on `inbox:<conversationId>`. It carries the person's replies and hand-over state.
- **Reconnecting:**
  - Every stream sends a **`hello` snapshot first**: unread counts and the Needs a person and Safety lists for the dashboard, and the latest message id for the visitor. A reconnect therefore redraws, and nothing missed is lost.
  - The server pings every 10 s.
  - The client reconnects with backoff (1 s, 2 s, 5 s, up to 30 s, with jitter) and refreshes the token once on 401 (`fetchWithReauth`).
  - After a reconnect, the visitor page re-reads `GET …/conversation` from its last message id.
  - The dashboard invalidates its RTK Query caches on each event, so the lists stay right even if one event is missed.
- **Unread counts:** a new table, `chatbot_conversation_reads (conversation_id, user_id, read_at)`. A chat's unread count is its visitor messages after your `read_at`; opening a chat updates it.

### 2.5 Notifications

- **In the dashboard:** a browser notification and a short sound for **Needs a person** and **Safety**, from the inbox stream, while the dashboard is open in any tab. Mute is per person (stored in the browser), and permission is asked the first time the inbox opens.
- **Email:** a 5-minute job emails the assistant's owners about a chat that has needed a person for 15 minutes (owner setting) with no one opening it. It's sent once (`metadata.handoverEmailedAt`).
  - Subject: "A conversation needs you".
  - The body carries only the assistant's name and a link, no message text.
  - It reuses `EmailService`, following the lead alert's pattern.
  - "Alerts go to" (noted in 20a-2) stays default-all-owners; the setting itself is 11b.

### 2.6 The dashboard Inbox

- **Navigation:** a new **Inbox** item in the main nav, with the total unread badge. The Conversations list becomes its **All** view.
- **Filters:** Needs a person · Live now (a message in the last 15 minutes) · All; by channel (WhatsApp · Bot page · Website); and by assistant.
- **The chat view:**
  - the thread, with sources under answers, pre-chat answers at the top, the channel badge, the visitor's thumbs (Q2a), and Safety rows;
  - Take over and Hand back to assistant;
  - the reply box, plus the WhatsApp window notice;
  - the banners "You're replying. Your assistant is paused in this chat." and "{name} is replying in this chat."
- **Data:** the inbox reads only the shared store. WhatsApp chats appear only where `sharedStoreWrites` is on (question 4).
- **Copy:** §23, plus any new lines in the same commit.

### 2.7 Tests

- **ally-be:**
  - **The switch:** the engine never runs while a person holds a chat, on WhatsApp and the bot page (and the widget's route when 13 lands).
  - **Crisis while held:** the crisis reply goes out at once, the chat stays held, and `safety_at` is set.
  - **Hand-over phrases** in English, Hindi and Hinglish, and phrases that must not match.
  - **The rest of the flow:**
    - declined twice in a row flags the chat;
    - two take-overs, the first wins;
    - hand-back resumes;
    - auto hand-back.
  - **Human replies:** stored with `agent_human` and the sender, and delivered on WhatsApp (and refused after 24 hours) and on the bot page stream.
  - **Unread, events and email:** unread counts; inbox events only for accessible assistants; the 15-minute email sent once, with no text.
- **ally-web:**
  - the inbox list, live updates and unread counts, and the filters;
  - Take over, reply and Hand back;
  - the banners and notifications (mute);
  - the visitor page receiving a person's reply live;
  - screenshots at 1440 and 390 px with axe.
- **e2e:** a visitor asks for a person, a team member takes over and replies, the visitor sees it, the member hands back, and the assistant answers the next message.

## 3. Questions before I build

1. **How a request for a person is detected.** I recommend a tested phrase list in ally-be (English, Hindi, Hinglish) checked before the engine, with no prompt change. The alternative is a new turn type in the agent prompt, which is a prompt change and needs your approval.
2. **"They usually reply within {hours}" and opening hours.** No opening-hours setting exists. I'd add per-assistant settings:
   - reply time (default "a few hours");
   - opening hours (optional; without them, the in-hours line is always used);
   - auto hand-back (default 12 h);
   - the email delay (default 15 min).

   They'd be edited on the home's Share section. OK?
3. **WhatsApp after 24 hours:** refuse the reply with a plain explanation (no template messages until 17). OK?
4. **WhatsApp in the inbox** needs the shared store's writes (`sharedStoreWrites`), which is a platform flag. Is it on in production? (I can't check.) If it's off, WhatsApp chats can't be taken over until it's on; the bot page works either way.
5. **What the visitor sees while held:** their message shows as sent, with no reply until the person answers. I can add a line ("{first name} from {business} is replying"), shown once when a person takes over. Want it?
