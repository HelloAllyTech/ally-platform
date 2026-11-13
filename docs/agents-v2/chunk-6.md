# Chunk 6 — List tools, with Do it and Never

> Brief for Claude Code. Read `CONTEXT.md`, `TEMPLATE-DATA-MODEL.md` (§6), `BUILDING-BLOCKS.md` (Generated agent tools), `FAST-TRACK.md` (6), `CHUNK-03B-NOTES.md` (the gateway), `CHUNK-05A-NOTES.md` (the lists engine), `CHUNK-20A2-NOTES.md` (the booking slice) and `CHUNK-03A-NOTES.md` (the agent), then this file. Plan first, as usual. <!-- docs-path-lint: planned --> Branch: `feat/agents-v2-fast-track`. Tag commits `[6]`. Repos: ally-be and ally-ai. You're the only session on the branch. Start after 5a's last commit. This brief is committed already (5a's first docs commit). In your first docs commit, set the root `CLAUDE.md`'s current-chunk line to 6 (`chunk-6.md`). **One stop for Shehbaz:** the text of the new prompt section `ally_ai_agent_lists` and the templates for the tools' descriptions, before they're synced. Draft them first and keep building while you wait.

## Why

With 3b's gateway and 5a's lists, the assistant can finally do the thing owners ask for first: look up what's free, book it, and change or cancel a booking, under rules it can't break. Nothing is coded per list: each list the owner lets the agent use becomes up to three tools, generated from its definition (`TEMPLATE-DATA-MODEL.md` §6).

## What exists

* **3b's gateway:**
    * the run token and its `tools`;
    * `tool_runs`, where a replayed call returns the stored result;
    * the per-bot `abilities` map (`do_it` or `never`, platform admin only);
    * ally-ai's gateway tool base, with `step` and `ends_run`;
    * "no v1 after an action": a run that fails after a gateway tool succeeded isn't answered by v1;
    * as built (`CHUNK-03B-NOTES.md`): each gateway tool is offered once per run (`35241573d`), so a failed `hand_over` isn't retried until the run times out; `abilities` lives only in each bot's own overrides, never in the effective settings; WhatsApp's run token has no contact id yet.
* **5a's engine:**
    * reads and writes with the agent as actor;
    * per-contact scoping for lists with a person field;
    * refusals with codes, copy deck §26 messages and up to 3 alternatives.
* **The booking slice (20a-2):** in ally-ai's check, `_trim_booking_offers` removes "shall I book that for you?" and `_send_back_slot_offers` sends back a reply that names a time as free, for "Bring in customers" assistants. The enquiries purpose's prompt says never to name a day or time as available.

## Scope

### 1\. Which tools a run gets \(ally\-be\)

* For each live list with agent read on: `find_<key>`. With agent write on and at least one writable field: `create_<key>` and `update_<key>`.
* **Abilities,** in 3b's per-bot map, keyed by tool name. `find_*` is `do_it` unless set to `never`. `create_*` and `update_*` are `never` until set to `do_it`. A tool that isn't `do_it` isn't offered, and the gateway refuses it.
* At most 12 generated tools per run, in list order. The rest are left out and named in the run's trace.
* **The gateway block gains `definitions`:** for each generated tool, `{ name, description, input_schema, kind }`, where kind is `find`, `create` or `update`. 3b's `tools` still lists every name the token allows.
* **Input schemas:** a flat object of strings, numbers, integers, booleans and enums.
    * Every field is optional with a default, as the step schema needs (see `ally-ai/app/core/agent_runtime/schemas.py`). Required fields are checked by the engine and come back as a refusal.
    * **find:**
        * for each agent-readable field (the first 10 by position): equality for select, yes/no and relation fields; `contains` for text; `<key>_from` and `<key>_to` for numbers, money, dates, date-times and durations;
        * `sort` (an enum of readable keys, with `-` for descending);
        * `limit` (1–10, default 5);
        * `aggregate` (`count`, or `sum_<key>` for numeric fields).
    * **create:** the writable fields: agent write on, not `never_store`, and not the person field, which is always the person in the chat. A relation to a list is described as "the id of a {target} from find\_{target}". A select is an enum.
    * **update:** `id` (from find) plus the writable fields.
* **Descriptions** are templated from the list's name and rules, for example "Book an appointment. Fails with a reason if the slot is taken or the client already has 2 active appointments." They're model-facing, so their templates are part of the stop.

### 2\. What the gateway does with them \(ally\-be\)

* `find_`, `create_` and `update_<key>` resolve only to a live list of the token's bot. Then the usual 3b checks apply: the token, the ability, the body.
* **WhatsApp needs its contact in the token.** 3b left it out because nothing read it yet. Resolve the sender's `chatbot_contacts` id before signing, the same way the shared store maps a WhatsApp contact. If it can't be resolved (for example while `sharedStoreWrites` is off), that run isn't offered the tools of lists that have a person field. The other lists' tools still work.
* **5a's engine does the work,** with the agent as actor and the run id. When the list has a person field, the call is scoped to the token's contact:
    * find sees only that person's records;
    * create sets them as the person;
    * update can't touch anyone else's records.
    * With no contact (Preview), find on a person's list returns nothing.
* **Preview never changes an owner's list.** In Try it, create and update run inside a transaction that's rolled back. Every rule is checked and the result is real, but it's marked `preview: true` and nothing is saved.
* **Results:**
    * **find:** each record is a passage, titled "{list}: {record title}", with its readable fields as "label: value" lines (masked where set) and a source id `record:<id>`. It comes with the total, or the aggregate.
    * **create and update:** the record as a passage, so the reply can cite it.
    * **A refusal:** `ok: false`, with the code, the §26 message, and the alternatives as passages.
* **Replays:** 3b's `tool_runs` covers them. A replayed create returns the stored record, never a second booking.
* **If the run fails after a create or update succeeded,** reply with a fixed line built from the stored result: "Done: {record title} in {list}." This is a new line in copy deck §26.

### 3\. ally\-ai

* **Each definition becomes a gateway tool at run time,** using 3b's base. There's no module per list. The step schema's cache must not grow without bound: key it on the definitions' hash.
* **Change 3b's once-per-run rule:** a tool that failed isn't offered again in that run, but one that succeeded can run again, within the 4-step cap. Then find can look at Thursday and then Friday in one reply, while a failed create or `hand_over` still can't loop. `hand_over` keeps ending the run.
* **find's passages join the run's passages,** numbered after the ones already there, and are citable. They don't count as searches, and "found nothing new" doesn't apply to them.
* **Citations of record passages** go back to ally-be like document citations: the list name as the title, the record title as the section, and no URL. A channel that lists sources shows "Slots · Thu 13 Nov, 11:15".
* **The checks:**
    * `_trim_booking_offers` and `_send_back_slot_offers` are skipped for a run that offers any create tool;
    * every other check stays, grounding included: a time presented as free must cite a record passage.
* **The prompt:** when list tools are offered, a new section, `ally_ai_agent_lists` (a new seed and Skills Store prompt), goes after the purpose section. It must say:
    * look before you claim: find before saying a time is free or that something exists;
    * offer only times and items from find results, and cite them;
    * book or change something only after the person has confirmed exactly what;
    * after a create or update, confirm what was done, and cite it;
    * on a refusal, give the reason in plain words and offer the alternatives;
    * never make up an id, and never act on someone else's records;
    * it replaces the "Bring in customers" rule about never naming times, for assistants with a create tool.
* **Stop:** Shehbaz approves this text and the description templates. Then sync them as a new local Skills Store version, and add the seed.

## Decided

* **Writes don't wait for the crisis check.** When the crisis check wins, the crisis reply goes out and a record the agent made stays: the chat shows Safety, and the owner sees the record. That answers 3b's open question.
* **Abilities stay in 3b's per-bot settings map.** The `abilities` table, approvers and Ask me first come with 14a. Owners get Do it and Never per action in 5b; until then, a platform admin sets them.
* **A list key resolves only inside the token's bot.** No tool can reach another bot's lists.
* **The owner-facing purpose-card lines** ("It can't book…") change in 5b, where owners create lists.

## Out of scope

`check_rules`. Ask me first (14a). WhatsApp buttons for choosing a slot (10). Reminders (6F). Why? citing a record. The owner's screens, including a "test, not saved" note in Try it (5b).

## Tests

* **ally-be:**
    * which tools a run gets for which lists and abilities; the cap of 12; schemas from each field type; descriptions from the rules;
    * resolution: an unknown list is 404; a list from another bot is impossible; an ability set to Never is 403;
    * per person: find returns only that contact's records; updating someone else's record is `not_found`;
    * Preview: nothing is saved, and the result is still real;
    * refusals carry the §26 message and the alternatives;
    * a replayed create returns the stored record and leaves one row;
    * a run that fails after a create gets the fixed "Done:" line, not v1;
    * a WhatsApp run gets its contact in the token; without one, the tools of lists with a person field aren't offered.
* **ally-ai:**
    * definitions become tools, with their enums and defaults;
    * find's passages are appended and can be cited;
    * the booking and slot checks are skipped only when a create tool is offered;
    * with no list tools, the prompt and the schema are exactly today's;
    * the lists section appears only when list tools are offered;
    * a failed tool isn't offered again in the run, and a successful find can run twice.
* **Evals,** locally, with 5a's seed on a test bot and `create_appointments` and `update_appointments` set to `do_it`. The 3a conversation eval gains action cases:
    * "what's free on Thursday?" gets slots, cited;
    * "book Thursday 11:00", then "yes", creates the record and cites it;
    * the same slot for another person is refused, with free alternatives;
    * "cancel my booking" moves it to cancelled;
    * "who else is booked on Thursday?" reveals no one else's records;
    * a list tool set to Never isn't offered. Plus a Listings fixture list, for "2BHK in Baner under 85 lakh" (find with ranges). The Sunrise and fixture checkups stay unchanged, with no lists: 0 hard fails and 0 wrong declines.
* **Latency:** the median and worst for a run with a find and a create.
* Full suites, lint and typecheck in both apps.

## Report (`CHUNK-06-NOTES.md`) <!-- docs-path-lint: planned -->

The code map, the generated schemas, the approved prompt text, the eval results, the latency, mismatches with this brief, and the lines added to `LAUNCH-CHECKLIST.md`:

* push `ally_ai_agent_lists` with the code;
* turn a pilot's create and update tools to Do it only after its action cases pass, and check its new records daily in its first week;
* bookings on WhatsApp need `sharedStoreWrites` on, as 11a's hand-over does.

## Done when

* [ ] In Try it, "2BHK under 85 lakh" filters a Listings list, with citations
* [ ] On the bot page, "book Thursday 11:00", once confirmed, creates a record; in Try it the same booking is checked but not saved
* [ ] A taken slot is explained, with free alternatives
* [ ] A Never tool isn't offered, and the gateway refuses it
* [ ] Nobody sees another person's records
* [ ] The Sunrise and fixture checkups are unchanged; the action cases are in the 3a eval
* [ ] `ally_ai_agent_lists` approved and live locally; `CHUNK-06-NOTES.md`; 6's row in `v2-chunks.md`'s Progress table; the checklist lines <!-- docs-path-lint: planned -->

## How Shehbaz tests it

1. **Seed a local test bot** (5a's `lists:seed`). As a platform admin, set its `abilities` to `{ "create_appointments": "do_it", "update_appointments": "do_it" }`.
2. **On its bot page:** "what's free on Thursday?" lists slots, with sources. "Book 11:00" asks you to confirm; "yes" books it, and the booking appears in `GET …/lists/appointments/records`.
3. **In a second private window** (another visitor), book the same slot: "That slot is already taken", with three free times.
4. **Back in the first window:** "cancel my booking" cancels it, and the slot is free again.
5. **"Who else is booked on Thursday?"** says nothing about other people.
6. **In Try it,** the same booking reads as booked, but the list doesn't change.