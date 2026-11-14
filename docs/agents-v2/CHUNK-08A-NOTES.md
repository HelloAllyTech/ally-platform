# Chunk 8a — Memory, light: notes

Branch `feat/agents-v2-fast-track`, commits tagged `[8a]`. Brief: `chunk-8a.md`. Decided with Shehbaz at the plan (14 Nov):

- **`remember` is a field on any agent step**, the reply included, not a tool of its own. It never costs a model call or one of the 4 steps, so remembering adds no wait.
- **A1.** What's stored is decided from what was actually sent: the stored reply for the run, its handled-by and runtime. It is never decided from the agent's decision, because the crisis check runs alongside the agent and its reply can win while the agent's decision still says "answer".
- **A2.** The person's name goes to every run, memory on or off. When a create tool is offered, `remember` also takes `{op: "name"}`, which sets the contact's name only if it has none.
- **A3.** Every line expires with the assistant's retention, counted from when it was last said; saying it again renews it. Nothing derived from a message outlives that message's retention.

## Status

| Done when | State |
|---|---|
| A returning person's preference is used in their next chat, on the bot page and on WhatsApp | Unit- and Postgres-tested end to end through ally-be (`memory.pg.spec.ts`: stored after the reply, sent to the next run). The live run on the bot page waits for the prompts' approval: ally-ai's container syncs its seed prompts when it starts, so it isn't rebuilt until the texts are approved |
| The Inbox shows it with its source; Forget removes it, and the next run doesn't know it | ✅ Postgres and unit tests; Playwright with axe at 1440 and 390 |
| Clinical details on health packs, never-store items and anything from a crisis run are never stored | ✅ Postgres tests (the health check fails closed; a crisis reply delivered stores nothing, A1); eval cases ready |
| A long chat keeps its start through the summary, with no added wait | ✅ Postgres tests (past 10 messages, one at a time, the old summary kept on failure); after the reply, never awaited |
| With memory off, runs are exactly as before; the checkups are unchanged | ✅ The prompt and step schema are byte-identical with memory off, no summary and no name (ally-ai tests). The checkups' live run waits, as above |
| The three prompts approved and live locally; notes; Progress row; checklist lines | Texts sent at the stop; notes, the Progress row and the checklist lines are in |

## Commits

| Commit | What |
|---|---|
| `7fe861351` | ally-be, 5b follow-up: Repeat weekly counts a time as already there by its text and choice details, ignoring numbers, durations and yes/no |
| `c29e733bc` | docs: the brief, `ROADMAP-NEXT.md`, `BUSINESS-TEMPLATES.md`; current chunk 8a |
| `bdd272c95` | ally-ai: `remember` as a step field, the memory section, the summary and name ahead of the history, `/agent/memory-check`, `/agent/conversation-summary`, Bring in customers' can-book variant, the four seed prompts |
| `0486b81bc` | ally-be: `memory_entries`, `MemoryService`, `SummaryService`, never-store, the run's memory fields, after-reply writes on the bot page and WhatsApp, erasure and retention, the Inbox routes, Try it's `wouldRemember`, the memory home field, the "requested" sentence, registry rows |
| `e5254c55a` | ally-web: the Inbox panel, the switch and never-store list in How it works, Try it's line, copy deck §28, tests, Playwright baselines |
| `013250bab` | ally-ai: the memory cases in the conversation eval |

## 1. Code map

**ally-be** (`src/chatbot/`):

| File | What |
|---|---|
| `memory/memory.service.ts` | `MemoryService`. `forRun` gives the run the person's lines (memory on), the chat's summary and the name. `afterTurn` decides from the stored reply (A1) and calls `apply`, which runs the checks, the health check, the name, renew-on-repeat, the 40-line limit and expiry (A3). Also the Inbox's `forInbox`, `forget`, `edit` and `forgetPerson`. `expiryFor` is the expiry rule |
| `memory/memory-render.ts` | `renderMemory`: the one rendering of the lines (open items, then preferences, then context, newest first, within 1,500 characters, with short ids `m1`…). 4a reuses it as `USER.md` |
| `memory/never-store.ts` | The defaults (every bot's, and a health pack's), `cleanOwnerNeverStore`, `matchesNeverStore` |
| `memory/memory-settings.ts` | `memorySettingsOf`: `settings.memory` `{on, neverStore}`, off unless set. In its own file so the home's fields don't load the service |
| `memory/summary.service.ts` | `SummaryService`: the rolling summary after a reply, under a Redis lock per chat; `metadata.summaryUpto` is the last message folded in |
| `entity/memory-entry.entity.ts`, `database/migrations/1981900951000-AddMemoryEntries.ts` | The table |
| `engine/agent-runtime-runner.service.ts` | `requestFor` adds `memory`, `summary` and `person_name`; `answer` keeps the run's `memory_writes` and the ids it showed on the run ref |
| `bot-page/bot-page-public.service.ts`, `../whatsapp/service/whatsapp-inbound.service.ts` | After the reply: memory and the summary. On WhatsApp they run once the reply's copy reaches the shared store |
| `service/conversation.service.ts` | Erasure and retention delete lines and blank summaries; `sweepMemory` (hourly, from the retention sweep, even with retention off) |
| `inbox/inbox.controller.ts` | `GET contacts/:contactId/memory` (viewers); `POST memory/:id/forget`, `PATCH memory/:id`, `POST contacts/:contactId/forget` (editors). The thread now carries `contactId` |
| `service/chatbot.service.ts` | Try it's `wouldRemember` |
| `../bot-draft/home/home-fields.ts` | The `memory` home field |
| `agent-tools/list-tools.ts` | A create tool on a list whose new entries start as requested (Site visits) says so: "New entries start as requested: the team confirms them." |
| `engine/chatbot-engine.service.ts` | Loads `ally_ai_agent_memory` with the agent's prompts, and `ally_ai_agent_purpose_enquiries_can_book` for an enquiries bot |

**ally-ai**:

| File | What |
|---|---|
| `app/core/agent_runtime/memory.py` | `remember_mode` (memory, name, both, or none), `memory_section`, `history_lead` (the name and the summary), `collect` (clean ops, 3 a step, 6 a run, no repeats), the trace's counts |
| `app/core/agent_runtime/schemas.py` | `remember` on the step schema, only when the mode says so |
| `app/core/knowledge_agent/prompt.py` | `format_purpose(..., can_book, channel)` picks the can-book variant; `format_persona(..., memory=)` places the memory section after the lists and before the safety rules |
| `app/core/memory_lines/service.py`, `app/api/v1/endpoints/agent_runtime.py` | `/agent/memory-check` (fails closed) and `/agent/conversation-summary` (`failed` keeps the old one) |
| `app/prompts/agent/memory.txt`, `memory/check.txt`, `conversation/summary.txt`, `agent/purpose_enquiries_can_book.txt` | The four seeds, with their contracts in `contracts.py` |

**ally-web** (`apps/ally-admin-dashboard/src/`): `pages/Inbox/MemoryPanel.tsx` (the panel and Forget this person's dialog), `pages/Inbox/ChatView.tsx` (beside the chat from 1200 px, a sheet below; a chat with no contact renders exactly as before), `pages/AssistantHome/sections/MemorySettings.tsx` (the switch and the never-store list), `TryIt.tsx` (`testOnlyNotice` adds "Would remember: …"), `copy/memory.ts`, `Inbox/copy.ts` (`INBOX.memory`), copy deck §28.

## 2. Decisions and mismatches with the brief

- **`remember` is a step field** (decided at the plan), not a tool. The trace shows a `remember` step with counts, never text.
- **The source message** is the person message that the stored reply answers (`in_reply_to_id`), so ally-ai doesn't send message ids.
- **Forget deletes at once** (the owner's and the agent's), rather than marking `forgotten` for the sweep: nothing forgotten lingers for an hour. The status stays in the schema, and the sweep deletes any row that has it.
- **`said_at`** is a column the brief doesn't list. A3 needs it: retention counts from when a line was last said, and an owner's edit mustn't renew it.
- **Memory settings live in `chatbots.settings.memory`** (like `abilities`, read from the bot's own value only), not a new column.
- **The memory check runs once per run** for every line to be written, not once per line.
- **Never-store in code**: the defaults by pattern, the health words as a backstop (the model check is the gate), and an owner's line by its words, each as the start of a word ("religion" catches "religious").
- **The summary and the name go ahead of the history in code** ("The person's name: …", "Earlier in this chat (a summary): …"), so `system.txt` is unchanged.
- **The data model (`TEMPLATE-DATA-MODEL.md` §2)** lists `confidence` and a `merged` status. Both belong to the nightly tidy (later); 8a follows the brief.
- **Before 8a, retention and erasure didn't blank `chatbot_conversations.summary`** (nothing wrote it). They do now.
- **How it works** shows Bring in customers' can-book variant when the assistant can book. The memory section isn't one of its layers yet, because it's per person; the switch sits below the layers.
- **The name** is offered whenever a create tool is, memory on or off, so a booking can ask for it once. It's set only when the contact has none.

## 3. How to test

- **ally-be:** `npm test -- --forceExit --detectOpenHandles`. The Postgres specs need `CHATBOT_STORE_TEST_DB` on a database whose name ends in `_test` (`ally_lists_test` here, migrated): `src/chatbot/memory/test/memory.pg.spec.ts` (39) and `memory.spec.ts` (36).
- **ally-ai:** `poetry run pytest tests/core/agent_runtime/test_memory.py` (27); the full suite.
- **ally-web (Node 22):** `npx vitest run --root apps/ally-admin-dashboard src/pages/Inbox/__tests__/memory.test.tsx` (49). Playwright: `inbox.e2e.ts` ("what the assistant remembers"), `assistantHome.e2e.ts` (how).
- **Evals:** `poetry run python scripts/agent_conversation_eval.py --cases tests/fixtures/agent_conversation_cases.yaml --only mem-…` (eight `mem-` cases).

## 4. Checks run

- ally-be: full jest with the Postgres specs: 1,136 of 1,139 suites passed. The three failures:
  - `backfill-check.pg.spec.ts`: its `TRUNCATE` without CASCADE is refused because of the foreign keys to `chatbot_contacts`/`chatbot_messages`. It fails the same way without 8a's migration (5b's `collection_records` and the scorecard's feedback table already reference them).
  - `llm-completion.service.spec.ts` and `voice-note.service.spec.ts`: they pass on their own, three times in a row; they're flaky under the full run.
  - Lint, typecheck and build ✅. Migration run, revert, run ✅ (on `ally_lists_test`); applied to `ally_local`.
- ally-ai: full suite 2,572 passed; flake8 ✅; the prompt-contract tests ✅.
- ally-web: on Node 22, 603 files and 10,209 tests passed. On the host's Node 24, 8 API test files fail with "Expected signal to be an instance of AbortSignal", with or without 8a. Typecheck, lint and format ✅. Playwright in Docker: the memory panel and How it works, axe clean, no sideways scroll; new baselines `inbox-memory.png` (desktop, phone) and `home-how.png` (the switch). An early run showed the Inbox chat shifted on a phone; it was fixed by leaving a chat with no person exactly as before.
- **The ally-be container ran out of memory once** (SIGKILL) while host builds and the Docker Playwright run overlapped. It was restarted after.

## 5. Waiting for the stop

- The four prompt texts (sent at the stop). Once approved: replace the seeds, rebuild ally-ai (its start syncs them to the local Skills Store), then run:
  - the eight `mem-` eval cases;
  - "How Shehbaz tests it" on a local bot page;
  - Sunrise and the fixture checkups with memory off and on;
  - §7's six action cases on Lakeview 3 times;
  - the latency check.

  Then remove the "don't turn Add on for an enquiries pilot" line from `LAUNCH-CHECKLIST.md`.

## 6. Open, for later chunks

- **16c (the assistant map, sprint 1): show a reply's steps in Try it** (decided 14 Nov). The run's trace already comes back in Try it's result (each search, list tool call and the `remember` step, counts only); Try it drops the live steps and "Why this answer?" shows only sources and timing. For example: "Looked up Slots: 3 found · Booked in Appointments · Would remember: prefers evenings". The full "Why?" for live chats in the Inbox needs an ally-be route (16b).
- **16a recall** (search across past chats) and **8's nightly tidy** (merge, `confidence`) as planned.
- **4a** shows `renderMemory`'s text as `/contacts/<id>/USER.md`.
- **Carrying memory across channels** (a WhatsApp number and a verified email being one person) waits for 8's people work.
- **The Context Library MCP wasn't connected in this session**, so the labels in §28 weren't checked against it.
