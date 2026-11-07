# Chunk 12 notes: shared conversation store and contact identity

**Brief:** [chunk-12.md](./chunk-12.md). **Branch:** `feat/agents-v2-chunk-12-shared-store`, from master after #232 (chunk 3c) was merged. **Repos:** ally-be only.

Plan approved 2026-11-07 at `~/.claude/plans/pasted-content-id-bd8d-we-re-starting-tingly-bee.md`.

## 1. Code map: what exists today (read before building)

All paths are under `ally-be/src/`.

### Every read and write of the `wa_*` tables

| Where | Reads | Writes |
|---|---|---|
| `whatsapp/service/whatsapp-inbound.service.ts` `handle` | the contact by (phone, business number) (`resolveContact` :622); the open thread (`resolveConversation` :661); history (`recentHistory` :601) | See the list below the table. |
| `whatsapp/service/whatsapp-identity.service.ts` `identify` (:126) | the contact | its `userId`, `tenantId`, `identifiedAt` and `identitySource`, re-resolved on every message |
| `whatsapp/consumer/whatsapp-inbound.consumer.ts`, the DLQ consumer (:88) | the message by provider id | marks the message `failed` unless it is already `sent` or `discarded` |
| `whatsapp/service/whatsapp-conversation.service.ts` (the dashboard's Conversations and Unanswered screens, and the contact actions) | `listConversations` (joins contacts and the tenant, with an EXISTS over `wa_messages` for the `handledBy` filter and search); `listLanguages`; `getConversation` (every message, oldest first); the scope checks; `createDocumentFromUnanswered` | `setContactBlocked`; **`eraseContact`** (:371): blanks the message bodies and citations, the unanswered questions, and the number (to `erased:<id>`), and clears the identity columns |
| `whatsapp/repository/wa-analytics.repository.ts` | overview, timeseries, languages and corpus coverage over `wa_messages` and `wa_conversations` | none |
| `chatbot/service/chatbot.service.ts` :285-320 | per-bot stats (messages, people, answered, declined, last message) and open unanswered questions | none |
| `whatsapp/service/whatsapp-business-number.service.ts` `lastInboundAt` (:283) | the last inbound message per number | none |
| `whatsapp/service/whatsapp-retention.service.ts` (hourly, registered in `whatsapp-scheduler-registration.service.ts`) | rows past the cutoff | blanks bodies, citations and `retrieval_meta` in batches of 500; blanks unanswered question text; blanks the numbers of contacts whose **latest conversation** is past the cutoff |
| **Engine** (`chatbot/engine/*`) | **nothing.** History arrives in `ChatTurn.history`, and `knowledge-request.ts:37` cuts it to 10 | nothing |
| **Preview** (`ChatbotService.test`, `/test/stream`) | **nothing.** History is the dashboard's `dto.history` | nothing: Preview conversations aren't stored |

Writes in the inbound handler:
- **Dedupe insert:** the inbound row is inserted with the placeholder ids `000…0` (:165). Once the contact and thread are resolved, the row gets their ids and becomes `processing` (:213).
- **Contact:** `lastSeenAt`, `messageCount`, `locale` and the consent fields (:334, :483, :511, :860).
- **Conversation:** `lastMessageAt`, `messageCount` and `lastLanguage`.
- **`reply()` (:709):**
  - the outbound row is saved as `queued`, **then the message is sent**;
  - the outbound row then becomes `sent` with its `providerMessageId`, or `failed`;
  - the inbound row's status and `handledBy` are updated to match.
- **`discard()` (:870)**, and the `catch` that marks the inbound row `failed` (:377).
- **The `wa_unanswered_questions` insert** (:878).

None of these writes share a transaction: each is its own statement.

### Contact scope today

- There is one `wa_contacts` row per **(phone, WhatsApp business number)**, enforced by two partial unique indexes. A NULL `business_number_id` means the platform number. A contact is scoped neither per bot nor per organisation.
- `wa_contacts.tenant_id` records **who the person is** (from identity resolution), not the bot's organisation.
- Bots have no tenant column.
- Consent, blocking, locale and the rate limit are all per (number, phone).

### Idle-window and same-bot rules

- `resolveConversation` reuses the newest thread for the same `contact_id` **and** `chatbot_id` whose `last_message_at >= now − conversationIdleMinutes`. Otherwise it starts a new thread, stamped with `chatbot_id` and `connector_id`.
- `conversationIdleMinutes` defaults to 1440 (`whatsapp/type/whatsapp-settings.type.ts:176`) and can be overridden per bot.
- Because `chatbot_id` is stamped when the thread starts, a number moved to another bot starts a fresh thread.

### Does history include the message being answered?

**Yes.** `recentHistory` runs after the inbound row is attached to its conversation. It takes the latest `MAX_HISTORY_MESSAGES` (10) by `createdAt`, newest first, then reverses them. Inbound rows become `user` turns and outbound rows `assistant` turns, and blank bodies are dropped.

So the message being answered appears twice in the request: as the last history turn and as the latest message. This was already an open item in 3a. The shared store keeps it exactly.

### Where retention rules live

- `WhatsAppRetentionService` runs hourly. `retentionDays` defaults to 180, and 0 turns it off. It **blanks rows in place** and never deletes them.
- Manual erasure is `WhatsAppConversationService.eraseContact`.
- Both use the same constants: `ERASED = '[erased]'` and `ERASED_PHONE_PREFIX = 'erased:'`.
- `DATA_SCHEMA.md` describes both paths.

### Can the backfill reuse ids?

- **Conversations and messages: yes, one to one.** Both use uuids, so a shared row's id equals its `wa_*` id. The LangGraph checkpoints (thread = conversation id) and `agent_run_id` links stay valid.
- **Contacts, with per-bot scope (decided below):** the id is reused one to one when a `wa_contact` has threads with only one bot. Two cases can't reuse it:
  - **Split:** a `wa_contact` with threads on two or more bots, because its number was moved between bots. The earliest bot keeps the `wa_contact` id. Each other bot gets `uuidv5("<waContactId>:<chatbotId>")`.
  - **Merge:** the same phone on two numbers bound to one bot. The identity is unique per (whatsapp, phone, bot), so the second `wa_contact`'s threads attach to the first contact.

  The backfill lists both cases.
- **Local data:** 1 contact, 1 thread and 3 messages. There are no splits and no merges, so every id is reused.
- **Production:** run the queries under "Ops" before the backfill.
- **Rows that aren't copied, because they have no thread:**
  - Inbound rows discarded before the contact was known (kill switch, or the bot not live). They keep `conversation_id = 000…0`. There is one locally.
  - `wa_conversations` rows with a NULL `chatbot_id` (a legacy nullable column). There are none locally.

  The check counts both separately.

### Where the code differs from the brief (the code wins)

1. **A `messages` table already exists.** It belongs to the chat module (`src/chat/entity/message.entity.ts`, integer ids). **Decision (Shehbaz):** the four tables take a `chatbot_` prefix: `chatbot_contacts`, `chatbot_contact_identities`, `chatbot_conversations` and `chatbot_messages`.
2. **Today a contact is scoped per WhatsApp number**, not per bot or organisation. **Decision (Shehbaz): per bot** (`chatbot_id`). The id-reuse exceptions are listed above.
3. **The inbound handler uses no transactions:** every write is its own statement. Shared writes therefore happen **right after** the matching `wa_*` write, not inside a transaction.
   - Reconciliation is a re-run of the backfill, which upserts by id.
   - The consistency check finds any gaps.
4. **Status changes after a row is written.** An outbound row gets its status and provider id after the send, and the inbound row's status changes in several places. So the service also has `updateMessage(id, patch)`, which the brief doesn't list.
5. **The engine and Preview never read stored history.** Preview's history is the thread the dashboard holds. So `readHistoryFrom` affects **WhatsApp inbound only**, and Preview is identical by construction.
6. **Parity can't run.** #223 deleted `agent_parity.py`. The conversation eval calls `/agent/run` with its own history, so it never sees the flag. The real check is an inbound spec snapshot plus a replayed inbound message.
7. **`turn_type` isn't a column.** It lives in `retrieval_meta.turn_type` and is copied as is.
8. **`wa_messages` has columns the brief doesn't list:** `language`, `template_id`, `latency_ms`, `error_message`, `in_reply_to_id` and `contact_id`. The first five are kept, because the 12b dashboard switch needs them. The contact is reached through the conversation.
9. **Timestamps follow the repo's base entity** (`"createdAt"` and `"updatedAt"`), as decided in chunk 2. A shared message's `createdAt` copies `wa_messages."createdAt"` exactly, so history comes back in the same order.
10. **Retention has to cover the new tables.** The sweep and erasure blank them too, always, whatever the flags say.
11. **There's no metrics library.** "Count" means an in-process counter logged with a running total, the same as `AgentRuntimeAlertThrottle`.
12. **Branch:** the chunk-12 docs were uncommitted on master, so the branch was created from master and the docs were committed there first.

### Decisions at plan time (Shehbaz, 2026-11-07)

- **Table names:** `chatbot_*` (difference 1).
- **Contact scope:** per bot (difference 2).
- **The pre-send mirror waits only when `readHistoryFrom === 'shared'`,** and then for at most 250 ms. Otherwise it runs in the background and adds no latency.
- **Retention blanks `wa_*` first, then the shared tables.**
  - A failure in the shared part is logged, and the next hourly run finishes it (blanking is idempotent).
  - `eraseContact` still propagates errors, so an erasure is always complete.
- **For 12b:** the dashboard's Conversations, unanswered questions and bot stats switch to the shared store in 12b, with a channel badge, a channel filter, and the pre-chat answers shown.
