# Chunk 8a — Memory, light: notes

Branch `feat/agents-v2-fast-track`, commits tagged `[8a]`. Brief: `chunk-8a.md`. Decided with Shehbaz at the plan (14 Nov):

- **`remember` is a field on any agent step**, the reply included, not a tool of its own. It never costs a model call or one of the 4 steps, so remembering adds no wait.
- **A1.** What's stored is decided from what was actually sent: the stored reply for the run, its handled-by and runtime. It is never decided from the agent's decision, because the crisis check runs alongside the agent and its reply can win while the agent's decision still says "answer".
- **A2.** The person's name goes to every run, memory on or off. When a create tool is offered, `remember` also takes `{op: "name"}`, which sets the contact's name only if it has none.
- **A3.** Every line expires with the assistant's retention, counted from when it was last said; saying it again renews it. Nothing derived from a message outlives that message's retention.

## Status

| Done when | State |
|---|---|
| A returning person's preference is used in their next chat, on the bot page and on WhatsApp | ✅ On the bot page, live (§5). WhatsApp isn't checked locally (no provider): staging or the pilot number |
| The Inbox shows it with its source; Forget removes it, and the next run doesn't know it | ✅ Postgres and unit tests; Playwright with axe at 1440 and 390 |
| Clinical details on health packs, never-store items and anything from a crisis run are never stored | ✅ Postgres tests (the health check fails closed; a crisis reply delivered stores nothing, A1); eval cases ready |
| A long chat keeps its start through the summary, with no added wait | ✅ Postgres tests (past 10 messages, one at a time, the old summary kept on failure); after the reply, never awaited |
| With memory off, runs are exactly as before; the checkups are unchanged | ✅ Byte-identical prompt and schema (tests). ⚠️ The checkups need an admin token (§5) |
| The three prompts approved and live locally; notes; Progress row; checklist lines | ✅ Approved with edits on 14 Nov, live locally as v1 (§5) |

## Commits

| Commit | What |
|---|---|
| `7fe861351` | ally-be, 5b follow-up: Repeat weekly counts a time as already there by its text and choice details, ignoring numbers, durations and yes/no |
| `c29e733bc` | docs: the brief, `ROADMAP-NEXT.md`, `BUSINESS-TEMPLATES.md`; current chunk 8a |
| `bdd272c95` | ally-ai: `remember` as a step field, the memory section, the summary and name ahead of the history, `/agent/memory-check`, `/agent/conversation-summary`, Bring in customers' can-book variant, the four seed prompts |
| `0486b81bc` | ally-be: `memory_entries`, `MemoryService`, `SummaryService`, never-store, the run's memory fields, after-reply writes on the bot page and WhatsApp, erasure and retention, the Inbox routes, Try it's `wouldRemember`, the memory home field, the "requested" sentence, registry rows |
| `e5254c55a` | ally-web: the Inbox panel, the switch and never-store list in How it works, Try it's line, copy deck §28, tests, Playwright baselines |
| `013250bab` | ally-ai: the memory cases in the conversation eval |
| `5df98817c` | docs: notes, Progress row, checklist lines |
| `354c7dd72` | ally-ai: the approved prompt texts; Try it's steps noted for 16c |
| `a3d0a2d11` | ally-ai: a reply about the person may go out uncited, from what the run was given; the judge sees it; the `memory` eval kind |
| `68283d6ea` | ally-be: basics' `--answer-name`, and memory applied after each reply in the runner |
| this one | notes with the live runs |

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

## 5. The stop, and the live runs (14 Nov, evening)

**The prompts** were approved with Shehbaz's edits and are live in the local Skills Store as v1, each the same as its file:
- `ally_ai_agent_purpose_enquiries_can_book` gained two lines: record the name with `remember` (name), and "You can't take payments. If they ask, explain how to pay from the information."
- `ally_ai_conversation_summary` gained "Never include card numbers, passwords, PINs or ID numbers."
- `ally_ai_agent_memory` and `ally_ai_memory_check` are as drafted.

The texts are the seed files in `ally-ai/app/prompts/` (`agent/memory.txt`, `memory/check.txt`, `conversation/summary.txt`, `agent/purpose_enquiries_can_book.txt`).

**A fix found by the eval** (`a3d0a2d11`): "What time did I say suits me best?", answered from memory, was declined by ally-ai's check, because an uncited answer to a question is sent back and then declined. Now a reply that only tells the person what they said about themselves goes out uncited, as a personal reply. That holds only when:
- it speaks to them ("you") and never for the organisation ("we", "our");
- every number in it is one they gave;
- it shares a word with their memory lines, summary or name;
- it doesn't name the organisation.

Anything about the organisation still needs a source (`check/personal.py`, tests in `test_memory.py`). The eval's judge is now shown what the run was given, and memory cases have their own kind.

**The eight memory eval cases** (`--only mem-`, 3 runs, Ally FAQ bot):
- 6 of 8 pass every run: uses it, no recital, keeps a preference, never-store (the password isn't kept), forget, the summary.
- `mem-health` keeps only "prefers evenings" every run (the memory part passes). The judge hard-fails its reply for offering "scheduling or reminders" this bot can't do.
- `mem-stranger` ("what do you know about me?") remembers nothing (passes). Two of three replies explained memory at length, quoting the prompt's example "prefers evenings"; the judge flags the policy talk.
- **For Shehbaz (a prompt change, not made):** on assistants that can't book, the memory section's "offer evening slots" invites offers it can't keep (also seen on the bot page: "I'll look for evening appointment times"). A line for `ally_ai_agent_memory`: "Use what you know only with what you can actually do; don't offer bookings or reminders you can't make."

**"How Shehbaz tests it", live on the bot page's public API:**

| Step | Result |
|---|---|
| 2–3. The Live Love Laugh Foundation (`b7aa81de…`, memory on): "I'm Rahul, evenings work better for me." Then a new chat: "What time of day did I say suits me best?" | ✅ Stored "prefers evenings" with its source message, 2.2 s after the reply (the health check included). New chat: "You said you prefer evenings." Same contact |
| 4. Forget it, ask again in a new chat | ✅ "I don't have any saved preference for time of day yet." The line was deleted in SQL, as `MemoryService.forget` does; the Inbox route itself is unit-tested |
| 5. Sunrise (`abdfd2d1…`, memory on): "I'm on sertraline and I like mornings." | ✅ Stored only "prefers mornings" (1.8 s after the reply) |
| 6. A 24-message chat, then "what did I say my team at work is called?" | ✅ The summary kept "team at work is called Lotus"; reply: "You said your team is called Lotus." |
| 7. Try it's "Would remember" | Unit-tested and in Playwright; not run against the live API (it needs an owner token) |
| 3 on Lakeview: evening times first | Not run: Lakeview's slots are 10:00–17:00 and it has no page. Cross-chat memory is shown above; slot ordering waits for a bot with evening slots |
| WhatsApp | **Not run locally:** no number reaches a bot and the provider has no credentials, so a reply is marked failed and, correctly, nothing is stored. The WhatsApp path waits for the reply's copy to reach the shared store, then calls the same `afterTurn`. Check it on staging or the pilot number |

Memory is left on for those two local bots (`settings.memory.on`).

**§7, 6's six action cases on Lakeview** (Bring in customers, ready-made Appointments; `--answer-name Rahul`, see below):

| Run | Result |
|---|---|
| 1 | ✅ 6 of 6 |
| 2 | 5 of 6. `lists-try-it`: the find didn't show Thursday 16:00, so the assistant offered Wednesday 16:00 and, after "yes", asked again before booking, because the person had asked for Thursday (6's time check, as it should). A slot lookup, not the purpose text |
| 3 | ✅ 6 of 6 |

- Before the can-book variant (5b) it was 4 of 6. Without `--answer-name`, the cases fail only because nobody answers "What name should I put on the booking?" (asked once, with the confirmation, as the text says).
- **`--answer-name`** (new in `run-basics.ts`): when a reply asks for the name, the person gives it with their next message ("yes, please book it. I'm Rahul"); a second ask fails. The runner also applies memory after each reply, as the channels do, so the name is saved.
- **The checklist line stays for Shehbaz's call:** two of three runs passed all six; the brief asks for 3. The "don't turn Add on for an enquiries pilot" line is still in `LAUNCH-CHECKLIST.md`.

**Latency:**
- Loading memory adds a few milliseconds: the three reads are 0.1–0.4 ms each in Postgres, run in parallel.
- Reply to stored: 1.8–2.3 s on health packs (the model check included).
- §7's booking turns: median 11.9 s, worst 24.9 s (19 turns; 6 measured 12.6 s median).
- Twice a run went past the 20 s cap after it had booked: the person's name message led to a find, a create and a reply. The reply was the honest "Done: Thu 19 Nov 2026, 12:00 in Appointments." (v1 never answers a run that acted). Watch it in the pilot.

**Not run: the Sunrise and fixture checkups with memory off and on.** `checkup_eval.py` needs an admin `ALLY_TOKEN`. Signing one locally was refused in this session, so they wait for Shehbaz's token. With memory off, the request and prompt are byte-identical to before (tests).

**Final checks:**
- ally-ai: 2,584 passed; flake8 ✅.
- ally-be: 1,137 of 1,139 suites. The two failures are the pre-existing `backfill-check` truncate and the flaky `llm-completion`. Lint ✅.
- ally-web: as in §4.

### Shehbaz's manual test on Amaha (16 Nov): two fixes

Shehbaz built "Amaha assistant" from amahahealth.com (Bring in customers, mental-health pack, ready-made Appointments, memory on) and booked as asha@example.com. Then, in a new chat, "what do you know about me?" got v1's "I don't have any personal information about you in the materials I can access." Two 20a-2 heuristics misfired on the crawled page titles (`aef60e063`):
- **"About Amaha" made "about" a name of the organisation.** The question counted as about Amaha, the reply was sent back to search first, the forced-search step replied anyway (a schema error), and too little time was left to retry, so v1 answered. Everyday title words (about, contact, find, online, care, …) no longer count; the full title still does.
- **"Psychiatry" in three page titles counted as three topics,** so the booking confirmation was trimmed as a repeated topic list. The person was booked but never told. A topic now counts only for a word no topic counted before it.
- **Also:** with memory on, the person's name heads their lines ("Name: Rahul"), so "what do you know about me?" has it.
- **Replayed on Amaha, 3 runs each:** "what do you know about me?" → "I know your name is Shehbaz, and that you prefer evenings" (3 of 3); booking Thursday 15:00 → "I've booked your psychiatry session for Thursday 19 Nov 2026 at 15:00" (3 of 3).

**Still open:**
- **Asking for a time with no slot** ("Thursday evening" on a list with 10:00–16:00 only) is answered with the decline wording, a v1 fallback or a hand-over, not "nothing's free in the evening; the latest is 16:00".
- **The forced-search step** fails the run when the model replies anyway and too little time is left.
- **Such turns ran 35–50 s.**

These are 6's lists behaviour and 20a-2's check, not memory; they're for the next lists chunk.

### After Shehbaz's chats on Amaha (16 Nov): fixes, the fuller panel, Tools

**Fixes** (from his two chats; the reasons are in the commit):
- **Pre-chat answers:**
  - the pre-chat's name names the contact when it has none, and reaches every run;
  - its other answers (never phone or email) reach the run as "Before the chat they told you: …";
  - none of it is stored as memory.
- **Passage numbers** said in words ("see these details here: 1, 3, 4", "(source 1)") are cut from replies.
- **The done line:** a run cut short after acting lists every write, and a status change says it: "Cancelled: Thu 19 Nov 2026, 19:00 in Appointments."
- **Time after a write:** a run that has booked or changed something gets 4 s more (24 s, inside ally-be's 25 s).
- **The approved prompt lines** are in the two seed files. They still need publishing as new versions in the local Skills Store (Manage Prompts); the seeds don't change live text.

**The Inbox panel, in more detail:**
- An intro, About them (the name, and what they told the page before the chat).
- Notes by section, each section saying what it's for.
- Each note: said in this chat or an earlier one, and kept until a date or until forgotten.
- This chat so far (the summary), and what it never keeps.
- Copy deck §28.

**Lists became Tools** (Shehbaz's call, copy deck §29):
- **One tab per tool:** the assistant's own (Your pages, Memory, Hand over), then each list, then Add a tool.
- **Memory's switch and never-store list** moved here from How it works, which keeps a pointer.
- **Each list** has a ⋯ menu with Rename and Delete list (one confirmation, Undo), and its choices always in view as chips.
- **ally-be refuses deleting a list another list links to** ("Appointments links to this list. Delete Appointments first, or remove that detail."). Before, Slots could be deleted under Appointments.
- **The section's address stays `?section=lists`,** so links and the 5b tests are unchanged.

**Committed with `--no-verify` (16 Nov), on Shehbaz's word to commit:**
- the hook's run of about 5,000 related tests timed out twice in `rate-limited-routes.spec.ts`, which passes alone (22 of 22);
- every suite these changes touch passed separately.

**Still to do:**
- **Playwright baselines** for the home, Lists and the Inbox panel need refreshing in Docker.
- **Option 1** (the booking rules moved into the lists section, so every purpose that can book gets them) waits for Shehbaz.

## 6. Open, for later chunks

- **16c (the assistant map, sprint 1): show a reply's steps in Try it** (decided 14 Nov). The run's trace already comes back in Try it's result (each search, list tool call and the `remember` step, counts only); Try it drops the live steps and "Why this answer?" shows only sources and timing. For example: "Looked up Slots: 3 found · Booked in Appointments · Would remember: prefers evenings". The full "Why?" for live chats in the Inbox needs an ally-be route (16b).
- **16a recall** (search across past chats) and **8's nightly tidy** (merge, `confidence`) as planned.
- **4a** shows `renderMemory`'s text as `/contacts/<id>/USER.md`.
- **Carrying memory across channels** (a WhatsApp number and a verified email being one person) waits for 8's people work.
- **The Context Library MCP wasn't connected in this session**, so the labels in §28 weren't checked against it.
