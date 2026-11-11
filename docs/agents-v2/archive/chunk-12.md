# Chunk 12 — Shared conversation store and contact identity

> Brief for Claude Code. Read `docs/agents-v2/CONTEXT.md`, `BUILDING-BLOCKS.md`, `SLICE-1.md`, `v2-chunks.md`, the NOTES for chunks 1, 2, 3a and 3c, then this file.
> Branch: `feat/agents-v2-chunk-12-shared-store` from master (after 3c is merged). Repos: **ally-be** (almost all), **ally-ai** (none expected), **ally-web** (none, unless a read path is switched behind a flag).

## Why

Today every conversation is a WhatsApp conversation: `wa_contacts`, `wa_conversations`, `wa_messages`. The bot page (12b), the website widget (13) and onboarding's readiness check (20a) need conversations that belong to **no particular channel**. This chunk adds one channel-agnostic store and a single service to use it, **without changing anything a WhatsApp user or a dashboard user sees**.

## Scope

### Data (ally-be migrations)

| Table | Holds | Key points |
|---|---|---|
| `contacts` | A person, per organisation or bot scope (verify which scope matches today's `wa_contacts` and record it) | `id`, scope columns, `display_name`, `created_at`. Profile fields, relations and memory come in chunks 7–8, so leave room, don't add them |
| `contact_identities` | How we recognise a contact on a channel | `contact_id`, `channel` (`whatsapp`, `web`, `email`), `external_id` (phone, visitor id, email), `verified` (bool), `verified_at`; **unique (channel, external_id, scope)** |
| `conversations` | A thread | `id`, `chatbot_id`, `contact_id`, `channel`, `connector_id` (nullable), `status`, `started_at`, `last_message_at`, `metadata` jsonb (12b puts pre-chat answers here), `summary` (nullable, chunk 16) |
| `messages` | Every message, any channel | `id`, `conversation_id`, `direction`, `role`, `text`, `attachments` jsonb, `handled_by`, `citations`, `retrieval_meta`, `agent_run_id`, `agent_runtime`, `turn_type` (if stored today), `provider_message_id` (**unique per channel**), `status`, `created_at` |

Rules:
- **Backfilled rows reuse the old ids.** A shared `conversations.id` equals the `wa_conversations.id` it came from, and the same holds for messages and contacts where possible. The LangGraph checkpoints (thread = conversation id), `agent_run_id` links and shadow rows then all stay valid. If an id can't be reused, stop and tell me.
- Indexes for the reads the engine and dashboard do today: the latest N messages per conversation, conversations per bot by `last_message_at`, and identity lookup.
- Retention: the same as today's WhatsApp tables. Note in NOTES where today's rules live.

### ConversationService (ally-be, new, channel-agnostic)

- `resolveContact(scope, channel, externalId, {verified?, displayName?})` returns a contact (create or find through identities).
- `openConversation(chatbotId, contactId, channel, {connectorId?, idleWindow})` reuses today's idle-window and same-bot rules, generalised.
- `appendMessage(conversationId, message)`: idempotent on `(channel, provider_message_id)` when present.
- `recentHistory(conversationId, n)` returns the same shape the engine uses today, including today's quirks. Check whether today's history includes the message being answered, keep the behaviour identical, and note it.
- `setMetadata(conversationId, patch)` for 12b's pre-chat answers.

### WhatsApp: dual-write, nothing else changes

- Behind a platform flag `sharedStoreWrites` (default **off**; on locally and in tests), WhatsApp inbound and outbound write to **both** the `wa_*` tables (still the source of truth) and the shared tables through ConversationService, **in the same transaction** where the current code writes, or right after with a reconciliation note if a transaction isn't possible. A shared-store write failure must **never** fail or delay a WhatsApp reply: log it, count it, and keep going.
- The existing "throw only before sending" rule holds.

### Backfill

- An idempotent, batched job (a script or admin command, following repo conventions) that copies `wa_contacts` → contacts and identities, `wa_conversations` → conversations, and `wa_messages` → messages, resumable from a cursor and safe to re-run.
- A **consistency check** command: counts per bot, the last 100 messages per conversation for a sample, and the identity coverage. It prints mismatches and exits non-zero on any.

### Engine read path, behind a flag

- `readHistoryFrom: 'wa' | 'shared'` (platform setting, default `wa`). The engine and Preview get history through ConversationService when it's `shared`. With the setting on, the conversation eval, parity and the engine specs must give identical results.
- The dashboard's Conversations views keep reading `wa_*` in this chunk. Switching them is part of 12b or later; note it.

## Out of scope

- No new channel UI (that's 12b), no profile fields, relations or memory (7–8), no summaries (16).
- No dropping or renaming `wa_*` tables, and no change to what WhatsApp users or dashboard users see.

## Tests

- Migrations up and down on a fresh database and on the current local one.
- ConversationService: identity uniqueness; the idle window; same-bot reuse; idempotent `appendMessage`; `recentHistory` equals today's helper output for the same data (snapshot).
- Dual-write: a WhatsApp inbound plus reply writes both stores; a shared-store failure leaves the WhatsApp reply and `wa_*` rows unchanged; flag off means no shared writes.
- Backfill: run twice, same result; resumes from the cursor; reused ids; the consistency check passes on a seeded dataset and fails on a corrupted one.
- With `readHistoryFrom=shared`: the engine specs and the v1 request snapshot are unchanged.
- All existing tests pass unmodified; lint, typecheck and build are clean. Run the full ally-be suite (no `--no-verify`).

## Done when

- [ ] Migrations, ConversationService, dual-write, backfill and the consistency check are merged behind flags, with the defaults off
- [ ] Locally: backfill run, consistency check clean, dual-write on, and a WhatsApp (or replayed inbound) conversation appears identically in both stores
- [ ] With `readHistoryFrom=shared`: conversation eval 0 hard fails, parity 0 must-match failures, Preview identical
- [ ] `CHUNK-12-NOTES.md`: code map, the scope decision for contacts, the id-reuse result, flags, how to run the backfill and check in production, and open items for 12b

## How Shehbaz tests it

1. Suites and lint; run the migrations.
2. Run the backfill, then the consistency check: expect no mismatches.
3. Turn on `sharedStoreWrites` and send a few Preview or WhatsApp messages. Query both stores; the same messages should appear in each.
4. Turn on `readHistoryFrom=shared`. Ask a follow-up in Preview ("how do I get access?" → "and after that?") and check it's understood exactly as before.
5. Turn both flags off: everything behaves as before.
