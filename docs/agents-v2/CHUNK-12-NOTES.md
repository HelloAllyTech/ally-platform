# Chunk 12 notes: shared conversation store and contact identity

**Brief:** [chunk-12.md](./archive/chunk-12.md). **Branch:** `feat/agents-v2-chunk-12-shared-store`, from master after #232 (chunk 3c) was merged. **Repos:** ally-be only.

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

## 2. What was built (ally-be only)

**Tables** (migration `1980990000001-CreateChatbotSharedStore` (`…0000` until CL1; renumbered when merging master, whose `CreateImageStudio` has that timestamp), entities in `src/chatbot/entity/chatbot-*.entity.ts`, enums in `src/chatbot/enum/conversation.enum.ts`):

| Table | Holds | Keys and indexes |
|---|---|---|
| `chatbot_contacts` | `chatbot_id` (the scope), `display_name` | FK `chatbots` (cascade), idx `chatbot_id` |
| `chatbot_contact_identities` | `contact_id`, `chatbot_id`, `channel` (whatsapp/web/email), `external_id`, `verified`, `verified_at` | **unique (`channel`, `external_id`, `chatbot_id`)**, idx `contact_id` |
| `chatbot_conversations` | `chatbot_id`, `contact_id`, `channel`, `connector_id`, `status` (open/closed), `started_at`, `last_message_at`, `metadata` jsonb, `summary` | idx (`chatbot_id`, `last_message_at`) for the dashboard, and (`contact_id`, `chatbot_id`, `channel`, `last_message_at`) for the open thread |
| `chatbot_messages` | `channel`, `direction`, `role`, `text`, `attachments`, `handled_by`, `citations`, `retrieval_meta`, `agent_run_id`, `agent_runtime`, `provider_message_id`, `status`, `language`, `template_id`, `latency_ms`, `error_message`, `in_reply_to_id` | **partial unique (`channel`, `provider_message_id`)**, idx (`conversation_id`, `createdAt`) for the latest N |

**`ConversationService`** (`src/chatbot/service/conversation.service.ts`, exported by ChatbotModule):
- **`resolveContact`** finds a contact through its identity, or creates the contact and identity in one transaction. It accepts `preferredIds` and is race-safe: a lost race re-reads the winner.
- **`openConversation`** applies WhatsApp's rules (same contact, same bot, same channel, within the idle window). With an `id`, it upserts that thread instead, and `last_message_at` only moves forward.
- **`appendMessage`** is idempotent on the id and on (channel, provider id). It doesn't touch the thread: as on WhatsApp, only an incoming message moves `last_message_at`.
- **`updateMessage`**, **`recentHistory`** (the same output as WhatsApp's helper, the message being answered included) and **`setMetadata`** (jsonb merge).
- **`blankBefore`** (the retention sweep) and **`eraseConversations`** (erasure).

**WhatsApp side** (`src/whatsapp/shared-store/`):
- **`wa-shared-store.mapper.ts`** is the one mapping from `wa_*` rows. It also derives ids with `contactIdsFor`: the `wa_contacts.id` first, then `uuidv5("<waContactId>:<chatbotId>")` under a fixed namespace.
- **`wa-shared-store.writer.ts`** (`WaSharedStoreWriter`) is the dual-write:
  - Every copy is **read back from `wa_*` by id**, so it's exact however late it runs.
  - Copies run in the background, **never reject**, and log failures with ids only, keeping a running count.
  - `history()` waits for the inbound copy only when `readHistoryFrom=shared`, and for at most `SHARED_HISTORY_WAIT_MS` (250 ms). After that it reads `wa_messages`.
- **`wa-shared-store.backfill.ts`** and **`wa-shared-store.check.ts`**, with their CLIs in `src/database/scripts/` (npm `backfill:chatbot-shared-store` and `check:chatbot-shared-store`).

**Call points** (the writer and ConversationService are `@Optional()`, so modules built without them behave as before):
- **`WhatsAppInboundService.handle`**:
  - The inbound copy starts after the row gets its thread.
  - History reads the shared store under the flag (see the wait rule above).
  - At the end of `reply()`, after the send, both rows are synced, once the inbound copy has landed.
  - `discard()` and the `catch` sync the inbound row.
- **The DLQ consumer** syncs the row it marks failed.
- **`WhatsAppRetentionService`** sweeps `wa_*` first, then `ConversationService.blankBefore`. A failure in the shared part is logged, and the next hourly run finishes it.
- **`WhatsAppConversationService.eraseContact`** erases the shared copies too. A failure there **propagates**, so an erasure is never half done; retrying is safe.

**Flags** (`whatsapp_bot` defaults; platform only, so `applyOverride` forces the platform value per bot):
- `sharedStoreWrites` (default `false`).
- `readHistoryFrom` (`'wa'` | `'shared'`, default `'wa'`). It takes effect only while `sharedStoreWrites` is on.
- Both are validated in `UpdateWaSettingsDto` and set through `PUT /v1/whatsapp/settings`. There's no dashboard toggle; this chunk has no ally-web change.

## 3. Decisions (beyond the plan)

- **No `contact_id` on `chatbot_messages`.** The contact is reached through the thread, which avoids a second copy of the contact link that could drift.
- **The writer reads `wa_*` back instead of mapping from memory.** The handler's in-memory objects are stale in two places: a reused thread's `lastMessageAt`, and the inbound row's `createdAt`, which only the database knows.
- **Copied timestamps keep millisecond precision.** `wa_*` holds microseconds and a JS Date holds milliseconds. History order is unaffected unless two messages in one thread were written within the same millisecond, which can't happen for an inbound message and its reply. The check compares to the millisecond, and the backfill's cursor keeps Postgres's own timestamp text so it never re-reads rows.
- **The CLIs live in `src/database/scripts/`**, next to `bootstrap-admin.ts`. The pre-commit lint refuses files under `scripts/`, which isn't in the TypeScript project.
- **Postgres-backed specs** (`src/whatsapp/shared-store/test/*.pg.spec.ts`) run only when `CHATBOT_STORE_TEST_DB` points at a scratch database whose name ends in `_test` or `_fresh`, and they're skipped in CI.
  - They truncate tables, so any other database name is refused.
  - An advisory lock serialises the suites, because Jest runs them in parallel workers.
  - The repo's unit specs mock repositories, and upserts, unique indexes and jsonb merges need real Postgres.
- **The enum guard** (`check-constraints-cover-enums.spec.ts`) gained the five new CHECK constraints, as its own comment asks. This is the one existing spec touched; rows were added and no assertions changed.

## 4. Tests and results

| Spec | What it proves | Result |
|---|---|---|
| `whatsapp-inbound-shared-store.spec.ts` (CI) | Without the writer, as before. Switch off: no shared calls. With `wa`: a copy that never finishes adds **no wait**. With `shared`: waits for the copy and uses the shared history, or waits **at most 250 ms**, then reads `wa`. A store that throws on every call changes nothing (reply sent, `wa` history). The reply is synced only after the send. A discard is synced | 8 passed |
| `wa-shared-store.writer.spec.ts` (CI) | The mapper (`contactIdsFor`, roles, placeholder rows). The writer never rejects, copies a reply only after the inbound copy, skips threadless rows, and `settled()` waits. Retention runs `wa_*` first, then shared, and a shared failure is logged, not thrown. Erasure passes every thread, and a shared failure **rejects** | 11 passed |
| `conversation-service.pg.spec.ts` (Postgres) | Identity uniqueness, per-bot scope, preferred ids, the race. Idle window in and out, same-bot reuse, channels apart, upsert by id moves only forward. `appendMessage` idempotent on id and on provider id, keeps a copied `createdAt`. `updateMessage`, `setMetadata` merge. **`recentHistory` equals WhatsApp's helper on the same 12 rows** (current message included, blank dropped). `blankBefore` idempotent. Erasure | 16 passed |
| `wa-shared-store.pg.spec.ts` (Postgres, the real inbound handler) | An inbound message and its reply write **both stores with the same ids and fields**. Switch off: nothing shared. A failing store leaves the `wa_*` rows, the replies and the engine's history identical to a run with no store. **`readHistoryFrom=shared` gives the engine exactly the input `wa` gives it** over three turns. Retention blanks `wa_*` first, then shared; a failed shared pass is finished by the next run | 6 passed |
| `backfill-check.pg.spec.ts` (Postgres) | Copies what has a thread and a bot, reusing ids, and reports one split, one merge and the skips. **A second run changes nothing. A run that crashed mid-way resumes from its cursor and ends equal to a full run.** A re-run repairs a changed or missing row. A dry run writes nothing. The check passes on a backfilled store and finds a changed message, a missing message, a missing identity and an orphan | 10 passed |
| Migration | `migration:run` → `migration:revert` → `migration:run` on `ally_local`, and on `ally_chunk12_fresh` (an empty schema-only copy) | clean |

- **Full ally-be suite** (`npm test -- --forceExit --detectOpenHandles`): **977 suites passed, 3 skipped (the Postgres specs, 32 tests), 14,189 tests passed, 0 failed.**
- **`npm run lint`, `npm run typecheck` and `npm run build`:** clean.
- **docs-path-lint:** ok.
- **The full migration chain can't run on an empty database.** `AddDialogueLengthToScenarioStates1700000000000` expects a `scenarios` table that no migration creates. This is pre-existing and not from this chunk. The "fresh database" is therefore a schema-only copy of `ally_local`.

**Local run on `ally_local`, with the real Nest app, real engine and real ally-ai (only Meta's provider faked, so nothing reached a phone):**
- **Backfill:** 1 thread and 2 messages copied, 1 discarded placeholder row skipped. **Check: no mismatches.**
- **`sharedStoreWrites` on:** "how do I get access?" → "and after that?" produced the same 4 rows with the same ids in both stores, and the check found no mismatches for the thread.
- **`readHistoryFrom=shared`:** the engine got `user, assistant, user` with the message being answered last, read from the shared store (no "not ready" fallback). The wording differs between runs because of model sampling (chunk 1 open item).
- **Both flags off:** only `wa_*` rows were written, and the check flagged the thread as missing from the shared store. A backfill re-run repaired it, and the check is clean.
- **Not run:** Preview, since it doesn't read stored history (difference 5), and parity, since the script was deleted in #223 (difference 6). The conversation eval wasn't re-run: it calls `/agent/run` with its own history, so neither flag can change its result.

## 5. How Shehbaz tests it

All commands run in `ally-platform/ally-be`.

1. **Suites, lint, typecheck and build:** `npm test -- --forceExit --detectOpenHandles`, then `npm run lint && npm run typecheck && npm run build`.
2. **The Postgres specs:**
   - Create a scratch copy of the schema: `docker exec ally-be-postgres-1 psql -U postgres -c "CREATE DATABASE ally_chunk12_fresh"`, then `docker exec ally-be-postgres-1 sh -c "pg_dump -U postgres -s ally_local | psql -q -U postgres -d ally_chunk12_fresh"`.
   - Run them: `CHATBOT_STORE_TEST_DB=postgres://postgres:<DB_PASSWORD>@localhost:5477/ally_chunk12_fresh npx jest src/whatsapp/shared-store`. Expect 41 passed.
3. **Migration:** `npm run build && npm run migration:run`, then `npm run migration:revert` and `npm run migration:run` again.
4. **Backfill, then check:** `npm run backfill:chatbot-shared-store -- --dry-run`, then `npm run backfill:chatbot-shared-store`, then `npm run check:chatbot-shared-store`. Expect "No mismatches", with 1 message not copied by design (the discarded placeholder row).
5. **Dual-write:**
   - Turn it on: `PUT http://localhost:8001/v1/whatsapp/settings` with `{"sharedStoreWrites": true}` (super-duper-admin token). Or locally: `update global_settings set value = value || '{"sharedStoreWrites":true}' where name='whatsapp_bot'`.
   - Send a WhatsApp message to a connected number (or replay one).
   - Compare: `select id, direction, status, left(body,40) from wa_messages order by "createdAt" desc limit 4;` against the same query on `chatbot_messages` (with `text` for `body`). Same ids, same rows.
   - `npm run check:chatbot-shared-store` stays clean.
6. **Shared history:**
   - Add `{"readHistoryFrom": "shared"}` the same way.
   - Ask "how do I get access?", then "and after that?". The follow-up is understood exactly as before. The ally-be log shows no "Shared history … not ready" line.
   - Preview isn't affected: it sends its own thread.
7. **Both flags off:** `{"sharedStoreWrites": false, "readHistoryFrom": "wa"}`. Nothing new appears in `chatbot_messages`. The check then reports those threads as missing until the next backfill.

## 6. Ops (production)

**Before the backfill, measure the id-reuse exceptions:**
- **Splits:** `SELECT contact_id FROM wa_conversations WHERE chatbot_id IS NOT NULL GROUP BY 1 HAVING COUNT(DISTINCT chatbot_id) > 1;`
- **Merges:** `SELECT phone_e164, chatbot_id, COUNT(DISTINCT k.id) FROM wa_contacts k JOIN wa_conversations c ON c.contact_id = k.id WHERE c.chatbot_id IS NOT NULL GROUP BY 1, 2 HAVING COUNT(DISTINCT k.id) > 1;`
- **No bot:** `SELECT COUNT(*) FROM wa_conversations WHERE chatbot_id IS NULL;`

  The backfill prints the same lists.

**Order:**
1. Deploy, which runs the migration.
2. Turn `sharedStoreWrites` on.
3. Run `backfill:chatbot-shared-store`. It reconciles everything written before the switch.
4. Run `check:chatbot-shared-store`.
5. Once the check has been clean for a day, turn `readHistoryFrom: shared` on.

A backfill re-run is always safe, and it's the repair for anything the check reports. To resume after an interruption: `-- --resume` (it reads `.backfill-chatbot-shared-store.cursor.json`) or `-- --from-cursor '<json>'`.

**Watch for:** `Shared store … failed` warnings from `WaSharedStoreWriter` (each carries the running count), and `Shared store retention sweep failed`.

## 7. Open items

- **Bug in existing code, outside this chunk, needs your decision:** `wa_contacts.phone_e164` is `varchar(32)`, but the retention sweep (`blankOrphanedContacts`) and `eraseContact` both write `erased:<uuid>`, which is 43 characters. On real Postgres both throw `value too long for type character varying(32)`.
  - Production effect: the hourly sweep blanks messages and questions, then fails on the first stale contact, so **phone numbers past retention are never erased**. An admin's "erase contact" returns a 500 after the messages are already blanked.
  - The existing specs mock the repository, so they never saw it.
  - The fix is a one-line migration widening the column (for example to `varchar(64)`), plus a real-Postgres test. Not changed here, because it alters a `wa_*` table.
- **For 12b (decided):** the dashboard's Conversations, unanswered questions and bot stats switch to the shared store in 12b, with a **channel badge**, a **channel filter** and the **pre-chat answers** (`chatbot_conversations.metadata`) shown.
  - Still on `wa_*` until then: analytics (`wa-analytics.repository.ts`) and `lastInboundAt`.
  - `wa_unanswered_questions` keeps pointing at `wa_*` ids. They're the same ids in the shared store, so it stays valid.
- **For 12b:** web contacts have no consent, block or organisation fields (those live on `wa_contacts`). They come with People (chunk 7), or 12b adds what the bot page needs.
- **Who sets `chatbot_conversations.status` to `closed`.** Nothing does yet: the idle window is computed when the next message arrives, as on WhatsApp.
- **`display_name` is null for WhatsApp,** because Meta's profile name isn't captured today.
- **When to make the shared store the source of truth** and stop the dual-write (after 12b moves the dashboard).
- **The full migration chain doesn't run on an empty database** (the `scenarios` table, see section 4). This is pre-existing.
- **The local ally-be watcher** rebuilds `dist/` on restart. While the full Jest suite runs, its temporary `src/test/temp-lint-test` files break the watcher's compile, and the app then boots from a stale `dist` (seen here as a false DI error). Restart `ally-be-app-1` after the suite.

## 8. Commits, in review order

```
b858a793e docs(agents-v2): slice 1 and chunk 12 brief; current chunk 12
24f9ca9f5 docs(agents-v2): chunk 12 code map
59bad4657 feat(chatbot): shared conversation store tables and entities
28c310eab feat(chatbot): ConversationService
87f08dd94 feat(whatsapp): dual-write to the shared store behind sharedStoreWrites; retention and erasure cover it   (includes the readHistoryFrom read path)
0defd7ed8 feat(chatbot): backfill and consistency check for the shared store
8134bc7ea docs(agents-v2): mark the removed parity script in the 3r brief for docs-path-lint
(this commit) docs(agents-v2): chunk 12 notes
```
