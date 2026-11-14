# Chunk 6 notes: list tools, with Do it and Never

**Brief:** [chunk-6.md](./chunk-6.md). **Branch:** `feat/agents-v2-fast-track`; commits tagged `[6]`, not pushed. **Baseline:** `441c054b2` (5a's last commit). The plan was approved on 14 Nov. Shehbaz decided to keep the action cases in ally-be's basics runner, not the 3a eval (§5). He approved the prompt text and the description templates as drafted, then approved adding the `{today}` line after the first live run (§5).

> Status: **built, waiting for Shehbaz's review** (14 Nov 2026).

## Follow-ups before acceptance (14 Nov)

Shehbaz asked for three changes before accepting 6. The action cases were then re-run.

1. **"I dropped that turn's citation requirement" was only the eval case's expectation.** The reply check itself was never loosened. But the check had two gaps that let the right times go out uncited:
   - its slot detector (20a-2's `offers_slot`) only knew "am/pm" times and full weekday names, so "1) Mon 16 Nov 10:00" never triggered it;
   - a clarify reply ("which of these should I book?") lost all its citations in `_build_result`.

   Both are fixed:
   - **Each offered time is matched against the run's record passages** (`check/offered_times.py`), by time of day and, where the sentence or the line before names one, by day.
   - **A matched time's record is cited**, before grounding, so the model's uncited list of the right times now carries its sources.
   - **A time no record of the run backs** is taken out and the draft is sent back (`UNFOUND_SLOT`). A day offered with no time ("Thursday is free") must still cite a record, as before.
   - **A clarify keeps its record citations** and still drops document ones, so v1 and document replies are unchanged.
   - Opening-hours ranges ("open 9:00 to 18:00") and times that aren't offered are left alone.
   - **The eval case's citation expectation is back.** It's now stricter: the refusal must cite Thursday's 11:00 or 13:00.
2. **"Never show ids, record numbers or passage numbers in a reply."** This line is in `ally_ai_agent_lists`, as local Skills Store v3 (identical to the seed) and in the seed. The code trim stays as the safety net. It also now takes out a sentence that starts with "Citations:", which a run produced.
3. **Alternatives are ordered by closeness to what was asked for** (5a's engine, `alternatives()`): the same day first, then the nearest days, each by time of day, compared as written (the business's wall time). A list without a date field keeps its own order.
   - Example: a taken Thursday 12:00 now offers Thursday 13:00, 11:00 or 10:00, then 14:00, where it used to offer Monday.
   - **5a spec changed:** the capacity test's expected order is now nearest-first (Spin is in 2030, after all three classes: Breathwork, Evening yoga, Morning yoga).
   - **Two new Postgres tests:** same day first; the nearest days once the day is full.

**Re-run, 6 action cases × 3 runs (separate invocations), after all three changes plus the "Citations:" trim:** 16 of 18 case runs passed.
- **Refusals:** every one offered the same day's nearest free slots, cited.
- **Run 6, `lists-book-confirm` (serious, open):** the person asked for 11:00 and said yes, but the agent booked **10:00**. Its find returned one slot (10:00), and it created that one. One booking exists, so the record count passed; the citation expectation caught it. Nothing checks that the booked slot is the one the person confirmed. See §6.
- **Run 6, `lists-who-else`:** the Host test bot's own decline wording ("My reference material…") tripped basics' platform pattern. Nothing leaked.
- **The three runs before the "Citations:" trim:** 17 of 18. The one failure was that sentence.
- **Latency, a run with a find and a create** (19 turns): median 11.3 s, worst 18.2 s. Gateway calls: median 22 ms, worst 91 ms.

## The wrong booking, fixed (14 Nov, second follow-up)

Shehbaz asked for two changes before 5b.

1. **A write books only the day and time the person confirmed** (`ally-ai/app/core/agent_runtime/tools/confirmed.py`). It applies before a create or update that sets a relation to a dated record (a slot, a class, a table, a visit).
   - **What it compares:** the target record's date and time (from its passage in this run) against what the person said. That means a time named in their latest message or the one before ("11:00", "4 pm", "at 4", "noon"), and their day if they named one ("Thursday", "tomorrow", "19 Nov"), worked out from `{today}` in the bot's zone.
   - **Where it runs:** in the tools node, from the person's own messages in the run's state, never from the model's words.
   - **If they don't match, the person never named a time, or the target wasn't looked up in this run:** the gateway isn't called. The record is a failed call (`unconfirmed_time`), so the tool isn't offered again this run. The agent reads, for example: ``- `create_appointments`: refused (Not done: the person hasn't confirmed this exact day and time (Thu 19 Nov 2026, 10:00). Ask them to confirm the day and time before you book it.), not done``.
   - **An update that keeps the target the record already has** (a cancel that repeats its slot) isn't checked.
   - **ally-be marks which fields this applies to:** create and update properties carry `relation` and `dated` (`date` or `datetime`, from the target list's first date field).
2. **find has an exact match on date-time fields:** `<key>_at` (e.g. `starts_at_at`), alongside the ranges. It's sent to the engine as from = to, so any written form of the instant matches. The description adds: "When the person named a time, use starts_at_at to find exactly that time."

**Tests:**
- **ally-ai** (`TestConfirmedTime`, `TestNamedTimesAndDays`, 9 tests):
  - **Run 6:** 11:00 was confirmed and find returned only 10:00. The create isn't sent, the agent reads why, and the create isn't offered again.
  - A correct 11:00 booking goes through.
  - "Tomorrow at 4 pm" with today Saturday 14 Nov books Sunday 15 Nov 16:00 and refuses Monday 16:00.
  - With no time named, nothing is booked.
  - A cancel that keeps its slot goes through.
  - The parsers for times and days, and the person's last two messages.
- **ally-be:** relation and dated metadata; `_at` in the schema, the description and the query; a Postgres test that `starts_at_at` finds exactly one slot from its own string or its UTC form.

**Action cases, 6 × 3 runs (separate invocations): 18 of 18 passed.**
- Every booking was the time confirmed: the 11:00 case booked 11:00 all three times.
- No write was refused in these runs: every create matched.
- A run with a find and a create: median 11.5 s, worst 14.2 s (18 turns). Gateway calls: median 20 ms, worst 47 ms.

## Report: 6 is done, except the checkups

The assistant can now look up a list, book, and change or cancel a booking under the list's rules. Each list the agent may use becomes up to three tools, generated from its definition, with no code per list.

| Done when | Result |
|---|---|
| In Try it, "2BHK under 85 lakh" filters a Listings list, with citations | ✅ `listings.json`, ×3: `find_listings` with `bhk`, `locality` and `price_to`; both flats cited (Pancard Club Road, Sus Road); the 95-lakh Balewadi flat never offered. Run through the engine as a bot-page visitor; Try it uses the same tools |
| On the bot page, "book Thursday 11:00", once confirmed, creates a record; in Try it the same booking is checked but not saved | ✅ `lists-book-confirm` (no create before the "yes", one `booked` record after it, cited); `lists-try-it` (`create_appointments: ok`, no record saved; Postgres spec too) |
| A taken slot is explained, with free alternatives | ✅ `lists-taken-slot`: "that slot is already taken" and three free slots |
| A Never tool isn't offered, and the gateway refuses it | ✅ specs: not offered (`list-tools.spec`, engine spec); 403 from the gateway (unit and Postgres) |
| Nobody sees another person's records | ✅ `lists-who-else` reveals no one; Postgres: find returns only the token's contact's records, and updating another person's record is `not_found` |
| The Sunrise and fixture checkups are unchanged; the action cases are in the eval | ⚠️ **Checkups not run:** `checkup_eval.py` needs an admin `ALLY_TOKEN`, which this session can't get (as at 20d-2). What did run: Sunrise basics 28/28 (0 crisis misses, 0 false alarms), and the 3a eval with 0 hard fails (§4). With no lists, the request and prompt are exactly today's (tests). Action cases are in basics, by Shehbaz's decision |
| `ally_ai_agent_lists` approved and live locally; these notes; the Progress row; the checklist lines | ✅ v3 is live in the local Skills Store, identical to the seed |

| Commit | What |
|---|---|
| `c8de9b8de` | docs: current chunk is 6 |
| `eb95965b4` | ally-be: generated tools, the gateway, Try it rolled back, WhatsApp contact, "Done:" line, record citations, copy deck §26 |
| `7eeb7557c` | ally-ai: tools from definitions, record passages, once-per-run for failures only, the check, `ally_ai_agent_lists` |
| `21708681f` | found live: today's date (`{today}`), record ids kept out of replies, basics action cases, `lists:seed --listings` |
| `abeea9d55` | found live: shortened ids and "see record" talk trimmed |
| `0e5b09461` | notes, `LAUNCH-CHECKLIST.md`, the Progress row |
| `6748d2a17` | follow-ups: offered times grounded and cited, clarify keeps record citations, the no-ids line (v3), alternatives nearest first |
| this one | the wrong booking: writes check the confirmed day and time; find's exact `<key>_at`; notes and checklist |

**Checks:**
- ally-be: full jest 1,122 suites and 16,585 tests passed (13 suites and 111 tests skipped: Postgres specs without a database). The lists and list-tools Postgres specs (138 with the unit specs) pass with `CHATBOT_STORE_TEST_DB` on `ally_lists_test`. Lint and typecheck ✅.
- ally-ai: 2,536 passed (46 skipped); flake8 ✅.
- Each run's diff was checked. `black` reformats files outside the chunk, so those were reverted every time.

**Local state:**
- **Host (`60b6e860…`):** has 5a's lists and `abilities` `{ create_appointments: do_it, update_appointments: do_it }`.
- **Second Host (`26792365…`):** has the Listings fixture (12 flats).
- **Sunrise:** has no lists.
- **Skills Store:** `ally_ai_agent_lists` v3 is live.
- **Basics runs:** their records and contacts are deleted at the end of each run.

### How Shehbaz tests it

1. **Seed:** `docker exec -w /app ally-be-app-1 npm run lists:seed -- --bot <id>`. Set `abilities` to `{ "create_appointments": "do_it", "update_appointments": "do_it" }` in the bot's overrides (3b's steps).
2. **The action cases:** `docker exec -w /app ally-be-app-1 node dist/chatbot/basics/run-basics.js --bot <id> --cases src/chatbot/basics/cases/lists.json --only lists-whats-free,lists-book-confirm,lists-taken-slot,lists-cancel,lists-who-else,lists-try-it --concurrency 1`. Don't use `--repeat`: bookings stay until the run's cleanup at the end, so a repeat finds its slot taken. Run it again instead.
3. **On its bot page** (a live bot): "what's free on Thursday?" lists times with sources (e.g. "Slots · Thu 19 Nov 2026, 11:00"). Say "book 11:00", then "yes". `GET …/lists/appointments/records` shows it.
4. **A second private window:** book the same slot. It should say the slot is taken and offer three free times.
5. **Back in the first window:** "cancel my booking". "Who else is booked on Thursday?" should reveal nobody.
6. **Try it:** the same booking reads as done, and the list doesn't change.
7. **Listings:** `npm run lists:seed -- --bot <another id> --listings`, then "any 2BHK in Baner under 85 lakh?"
8. **Checkups (still to run):** `ALLY_TOKEN=… poetry run python scripts/checkup_eval.py --suite ../docs/agents-v2/evals/sunrise-mind-checkups.yaml --bot abdfd2d1-0c6f-46a1-9a21-ce476205b0c4`, and the fixtures run as in 20a-2. Expect 0 hard fails and 0 wrong declines.

## 1. Code map

**ally-be** (`src/chatbot/agent-tools/`):

| File | What |
|---|---|
| `list-tools.ts` | Pure:<br>• `listToolDefinitions` (a list's tools), `offeredListTools` (abilities, person lists, the cap of 12, `omitted`)<br>• `abilityFor` (find on unless Never; writes off until Do it)<br>• the schemas and description templates<br>• `parseListToolInput`, `toListQuery`, `toListData`, `recordPassage`<br>• `todayFor`, `listDoneLine` |
| `list-tools.service.ts` | `ListToolsService`:<br>• `offeredFor`, and `resolve` (name → gateway tool, live lists of the token's bot only)<br>• `run` (5a's engine with the agent as actor and the token's contact)<br>• `previewCreate` (Try it: a stand-in contact and the write in one transaction, rolled back) |
| `tools.ts`, `agent-gateway.service.ts` | `AgentToolOutcome` may carry `result` on an error (a refusal's message and alternatives, stored and replayed). The gateway falls back to `ListToolsService.resolve` and checks `abilityFor` |
| `test/list-tools.spec.ts`, `test/list-tools.pg.spec.ts` | 18 unit tests and 8 Postgres tests; gateway and engine specs extended |

**Elsewhere in ally-be:**
- **Runner and engine:**
  - `engine/agent-runtime-runner.service.ts`: `requestFor` adds the list tools to the token and sends `definitions`, `omitted` and `today`. `actedIn` ignores finds and returns the last write's "Done:" line.
  - `chatbot-engine.service.ts` sends that line instead of the fallback wording.
  - `ai/dto/knowledge.dto.ts`: `AgentGatewayBlock`, and `KnowledgeCitation.record_id`.
- **WhatsApp contact:** `whatsapp/shared-store/wa-shared-store.writer.ts` `contactIdFor` resolves the shared contact before the reply, with the same arguments as `copyThread`. `whatsapp-inbound.service.ts` passes it on.
- **Record citations:**
  - `bot-page/bot-page-public.service.ts` `publicCitations` shows "Slots · Thu …".
  - `wa-analytics.repository.ts` `corpusCoverage` skips them.
- **Basics:** `basics-cases.ts`, `basics-evaluate.ts` and `run-basics.ts` gain `as`, `preview`, `tools`, `noTools`, `cites` and `records`; cleanup deletes the run's records. Case files are `cases/lists.json` and `cases/listings.json`.
- **Seed:** `lists/list-seed.ts` `SEED_LISTINGS`, `seedListings`; `database/scripts/seed-lists.ts` `--listings`.

**ally-ai** (`app/core/agent_runtime/`):
- **The tools:**
  - `tools/lists.py`: definition → `Tool`. The input model comes from the schema, with aliases so any field key works. It is cached on the definition's hash (`lru_cache` 64), so the step schema's cache hits. Record passages are numbered after the run's passages.
  - `tools/__init__.py`: `gateway_tools` adds them.
  - `gateway.py`: a refusal keeps its `result`.
  - `nodes/tools.py`: gateway passages are appended.
  - `nodes/agent.py`: a tool is left out only after it failed; the `omitted` trace step.
  - `trace.py`: a node may add steps of its own.
- **The prompt:** `prompt.py` (`_format_list_call`, field aliases in `format_tools`, the lists section); `knowledge_agent/prompt.py` (`format_persona(lists=…)`); `prompts/agent/lists.txt` and `AgentListsInputs`.
- **The check:**
  - `check/offered_times.py`: the times a reply offers, matched to the run's record passages.
  - `check/fixes.py`: `cite_offered_times` (run before grounding) and `_ground_offered_times` (trims unbacked times, `UNFOUND_SLOT`); `_drop_record_ids`; the two 20a-2 fixes skip when `can_book`.
  - `check/pipeline.py`: a clarify keeps record citations.
  - `check/text.py`: `without_record_ids`.
  - `check/rejections.py`: `UNFOUND_SLOT`.
- **Schemas and state:** `schemas/agent_runtime.py` (`ListToolDefinition`, `definitions`, `omitted`, `today`); `schemas/knowledge_agent.py` (`Citation.record_id`, sent only when set); `knowledge_agent/agent.py` (`resolve_citations` keeps it); `state.py`.
- **The confirmed-time check:** `tools/confirmed.py`; `tools/lists.py` runs it before a write; `tools/base.py` (`ToolContext.messages`, `today`); `nodes/tools.py` passes the person's last two messages.
- **Tests:** `tests/core/agent_runtime/test_list_tools.py`, 46.

**ally-be, 5a's engine (follow-up 3):** `lists/list-records.service.ts` `alternatives()` takes the requested target and orders by day, then time of day; `dateOf`.

## 2. The generated tools (5a's seed and the Listings fixture)

- **`find_slots`:** "Look up entries in Slots. Filter by practitioner, starts at, duration and open; returns up to 10 matches as passages to cite, with the total. Use aggregate to count or to add up duration. When the person named a time, use starts_at_at to find exactly that time."
  - **Inputs:** `practitioner_contains`, `starts_at_at` (exactly), `starts_at_from`/`_to` ("a date and time like 2026-11-20T11:15:00+05:30"), `duration_from`/`_to`, `open` [yes, no], `sort`, `limit` (1–10, default 5), `aggregate` [count, sum_duration].
- **`create_appointments`:** "Add an entry to Appointments for the person in this chat, only after they've confirmed it. Needs slot. Fails with a reason if that slot is already taken. Fails if the person already has 2 appointments."
  - **Inputs:** `slot` ("the id of a slots entry from find_slots"; marked `relation: slots`, `dated: datetime`), `service` and `status` (enums). No `client`: the person in the chat always is.
- **`update_appointments`:** "Change an entry in Appointments that belongs to the person in this chat; id comes from find_appointments. … Status can change from booked to confirmed or cancelled; from confirmed to completed, cancelled or no show."
  - **Inputs:** `id`, then the same fields, where empty leaves a field as it is.
- **`find_listings`:**
  - **Inputs:** `title_contains`, `locality` [Baner, Wakad, Kothrud], `bhk` [1BHK, 2BHK, 3BHK], `price_from`/`_to`, `area_from`/`_to`, `sort`, `limit`, `aggregate` [count, sum_price, sum_area].

**Every input has a default.** An empty string or enum value means "any" (find) or "not given".

**Results reach the agent as passages.**
- **Title:** "Slots: Thu 19 Nov 2026, 11:00".
- **Text:** `id: …`, then "label: value" lines of the readable fields, masked where set.
- **Citation:** the list as the title and the record as the section, with `record_id` set and no URL.

**What the agent sees in `{searches}`:**
- ``- `find_slots`: 7 found → passages 1–2``
- ``- `create_appointments`: done → passage 3``
- ``- `create_appointments`: refused (That slot is already taken.), not done; alternatives → passage 4``
- ``- `find_slots`: count = 7``

## 3. The approved prompt text (`ally_ai_agent_lists`, local v3)

```
# Lists you can use
Some of your tools read or change this business's lists: find_… looks entries up, create_… adds one, update_… changes one. What they return is numbered with the passages, and you cite it the same way.
Today is {today}. Work out days like "Thursday" or "tomorrow" from it: the next one coming, unless they say otherwise. Look first, and ask which one only if it's still unclear.
- Look before you claim. Use find before you say a time is free, that something exists, or what it costs.
- Offer only times and items that a find result shows, and cite those passages.
- Book or change something only after the person has confirmed exactly what: which item, which time. If they haven't, ask first.
- After a create or update succeeds, say plainly what was done and cite it.
- If a tool refuses, give its reason in plain words and offer the alternatives it returned, citing them.
- Use only ids from find results; never make one up. Never look up, book or change anything for anyone but the person you're talking to.
- Never show ids, record numbers or passage numbers in a reply.
- If you have a create tool, this replaces any earlier rule never to name a day or time as available: you may name the times find shows as free.
```

It sits after the purpose section, and only in runs with list tools. `{today}` reads like "Saturday 14 Nov 2026, 11:58 (Asia/Kolkata, UTC+05:30)".

**Other model-facing text, approved with it:**
- the description templates (§2);
- the `UNFOUND_SLOT` send-back: "It named a day or time as free, or as booked, without citing an entry a find_ or create_ tool returned. Look it up with find first and offer only what it shows, citing it; say something is booked only after create or update did it, citing that."

## 4. Evals and latency

- **Action cases**, six of them, run six times in separate invocations:
  - **Earlier code (runs 1–3):** 33 of 36 case runs passed overall. Run 1's one failure was "(passage 1)" in a reply; that's now trimmed.
  - **Code at `abeea9d55` (runs 4–6):** 16 of 18 passed. Both failures were `lists-taken-slot` replies that offered the right alternatives but didn't cite them. That turn's `cites` expectation was dropped from the eval case only, then restored by the follow-ups, which fixed the check instead (above).
  - **After the follow-ups:** see "Follow-ups before acceptance".
  - **First run, before `{today}`:** 1 of 6 passed (§5).
- **Listings:** 3 of 3.
- **Sunrise basics** (`PLATFORM_BASICS`, no lists): 28 of 28, 0 crisis misses, 0 false alarms. Same as 3b.
- **3a conversation eval** (no gateway):
  - 0 hard fails, 1 check fail (as in the baseline);
  - judge mean 4.71;
  - in scope, 100% the same documents as v1;
  - p50 6,790 ms against v1's 8,411 ms (−19%).
  - The report isn't committed, following 3a's rule; it's at `/tmp/claude-501/ev/eval_6.md`.
- **Sunrise and fixture checkups:** not run (no `ALLY_TOKEN`).
- **Latency, a run with a find and a create** (36 such turns): **median 12.6 s, worst 17.2 s**, all under the 20 s cap.
  - Gateway calls: median 23 ms, worst 56 ms (113 calls).
  - Almost all the time is model steps: find, create, reply and sometimes a second find.
  - A Listings find: 5.1–8.3 s.

## 5. Mismatches with the brief, and decisions

- **Action cases are in ally-be's basics** (`cases/lists.json`), not the 3a eval. The 3a eval calls ally-ai directly, with no gateway, token or contacts. Shehbaz decided this at the plan. Basics gained a second visitor, Try it turns, and checks on tool steps, citations and record counts.
- **Numbers are strings in the schemas.** ally-ai's step schema avoids `Optional`, and a number has no empty default. ally-be parses "85,00,000" and "8500000". The brief lists numbers as a schema type.
- **Today's date (found live, approved by Shehbaz).** Without it, every "book Thursday" got "which Thursday?" (1 of 6 cases passed).
  - ally-be sends `today` in the gateway block, and the lists section has `{today}`.
  - **A bot has no time zone setting.** The hand-over hours' time zone is used, otherwise Asia/Kolkata. Needs a real setting (5b or later).
- **Record ids in replies (found live).** The model copies a passage's `id:` line, sometimes shortened, and writes "(see record: 1)" or "(passage 1)". In runs with record passages only, the check trims these deterministically (`_drop_record_ids`); everything else is unchanged.
  - The ids stay in the passages, because the tools need them.
  - Shehbaz approved a prompt line for it (v3). The trim stays as the safety net.
- **Try it books for a stand-in.** Preview has no contact, and the engine refuses a person's list write for nobody. So in Try it, create makes a stand-in contact ("Try it"), writes the record for them, checks every rule, then rolls everything back.
  - In Try it, find on a person's list returns nothing (the brief), so update has nothing to change there.
- **A run with only finds still falls back to v1** if it fails: a find did nothing. Only `hand_over`, `create_*` and `update_*` stop v1.
- **A time named as free must come from a find in this run** (the brief's "grounding included"). With a create tool:
  - each offered time is matched to a record passage of the run and cited;
  - an unbacked time is trimmed and the draft sent back once (`UNFOUND_SLOT`);
  - a clarify keeps record citations (follow-up 1).
- **Alternatives are nearest first** (follow-up 3). This changes 5a's rule, which was the earliest free slots in the list's order.
- **The WhatsApp contact** is resolved before the reply with the shared store's own arguments (`contactIdFor`), so the background copy lands on the same row. It's null while `sharedStoreWrites` is off; then person lists' tools aren't offered.
- **Relations to a contact are never writable by the agent and never filterable.** The brief names only the person field.
- **The refusal comes back as `ok: false`** with the code as `error` (stored in `error_code`). Its message and alternatives go in `result`, stored and replayed with it. The brief says "ok: false, with the code, the message and the alternatives"; 3b's error column holds 64 characters.
- **The Context Library MCP isn't connected in this session,** so no product guidance was searched. The wording is the brief's, plus what Shehbaz approved.

## 6. Open, for later chunks

- **Run the Sunrise and fixture checkups** (How Shehbaz tests it, step 8).
- **Fixed: the agent could book a different slot than the one confirmed** (see "The wrong booking, fixed").
  - **Remaining limit:** the check reads only the person's last two messages. A time confirmed earlier ("11:00", then three turns of other questions, then "yes, book it") is refused, and the agent asks again. That's the safe direction.
  - **Remaining limit:** "at 4" counts as both 04:00 and 16:00.
- **A failed create isn't retried in the run.** One run passed a shortened id (`invalid_value`), and the brief's once-per-run rule then stopped it. Retrying after `invalid_value` only could be considered.
- **Latency:** a booking turn takes 12–17 s. The model steps are the cost.
- **A time zone setting per bot** (above).
- **Small things:**
  - find's `sort` offers person and relation keys (harmless).
  - A cleaned reply can keep a stray phrase ("See the slot info:.").
  - The model sometimes asks for an optional field (the service) twice before booking.
  - The Host test bot's decline wording ("My reference material…") trips basics' platform pattern: one failure in the earlier `--repeat` run and one in the follow-up re-run. Nothing leaked; giving the test bot neutral decline wording would remove it.
- **5b:** owners' Do it and Never; the purpose cards' "It can't book…" lines; a "test, not saved" note in Try it.
- **14a:** Ask me first.
- **Public wiki (Docs guard at PR time):** the gateway's list tools on `repos/ally-be.md` and `repos/ally-ai.md`.
