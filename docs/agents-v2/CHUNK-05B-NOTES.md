# Chunk 5b notes: Lists in the dashboard

**Brief:** [chunk-5b.md](./chunk-5b.md), with §9 (the time check from the definition) added by Shehbaz at the start. **Branch:** `feat/agents-v2-fast-track`; commits tagged `[5b]`, not pushed. **Baseline:** `51134509a` (6's last commit).

> Status: **built, waiting for Shehbaz's review** (14 Nov 2026).

**How it went:**
- The plan was approved with changes: a guided setup like onboarding, every state designed, v2 parts instead of native controls, an assistant switcher, and one design stop before building the rest.
- At the stop (14 Nov), Shehbaz approved the design with fixes and copy changes, all applied:
  - Repeat weekly's "For each one", and net counts;
  - "Free nearby" chips;
  - the picker icon;
  - a layout check;
  - capitalised list names, and the rest of the copy.

## Report

Owners can now see and change their lists on the assistant's home:
- **The section:** a Lists section after What it knows. With no lists, two ways to start. With lists, a tab per list, the entries table, then Details, Rules and What your assistant can do.
- **Ready-made lists** install from one definitions file in ally-be through a guided setup:
  1. Choose
  2. Make it yours
  3. Add times
  4. Let your assistant use it
  5. Try it
- **Repeat weekly** fills a list's times in one go.
- **Add and Change:** owners turn them on per list. `hand_over` stays platform-admin only.
- **Deleting an entry** that live entries depend on is refused (`in_use`).
- **Try it** says "Test only: this wasn't saved." under a reply whose run wrote.
- **How it works** gives the purpose's honest limit from the live abilities.

| Done when | Result |
|---|---|
| An owner adds Appointments with Slots from the ready-made lists and fills next week's slots with Repeat weekly | ✅ The guided setup in Playwright on the fixtures. Live on Lakeview Family Clinic, through ally-be's services: install, a second install refused, 35 slots for Dr Mehta, the same again skips all 35, Dr Rao skips none |
| An owner turns on Book, and the assistant books one on the bot page; it appears in the table, marked as made by the assistant | ✅ Add set to Do it live (stored `create_appointments: do_it`, the list's agent write on). Booking: see "Live action cases" below. The table marks the assistant's entries ("By your assistant"; unit test and Playwright) |
| Try it books the same way but says "Test only: this wasn't saved", and the table doesn't change | ✅ `previewWrite` on the test chat; `testOnlyNotice` (unit test); 6's `lists-try-it` case (live) checks nothing is saved |
| Fields, rules and switches can be changed in plain words; refusals show where they belong | ✅ Unit tests: a detail added, a refused change's reason, Whose entry is this? locked, rules as sentences, the entries a new rule breaks (each opens its form), Do it / Never with the first-time note |
| Playwright at 1440 and 390 px, light and dark, axe clean | ✅ at 1440 and 390, light, axe clean, no sideways scroll on any Lists screen. **Dark: not built** (decided at the plan: the home has no dark styles yet) |
| Copy deck §27; `CHUNK-05B-NOTES.md`; 5b's row in the Progress table | ✅ |

## Commits

| Commit | What |
|---|---|
| `aac0060b9` | docs: the brief with §9, the ready-made catalogue (`READY-MADE-LISTS.md`), current chunk 5b |
| `7ea5743af` | ally-ai: the time check reads a date and time the agent fills in itself |
| `a0ff2eae6` | ally-be: ready-made lists, Repeat weekly, the owner abilities route, `in_use`, search, contacts, `created_by`, `time_zone`, `bookingLists`, `previewWrite`, the §9 marking |
| `8a227ef99` | ally-web: the Lists section's design pass (the stop) |
| `6d097faa3` | the review fixes: Repeat weekly's other details and net count, Free nearby, copy, catalogue labels, the layout check |
| this one | How it works' line, unit tests, Playwright with axe and the baselines, the switcher's contrast, notes, Progress row, checklist |

## 1. Code map

**ally-be** (`src/chatbot/`):

| File | What |
|---|---|
| `lists/ready-made-lists.ts` | The 14 ready-made lists, as data: groups, one-liners, example questions, fields, rules, settings, the assistant's switches, the "your services" examples. `list-seed.ts` takes Slots, Appointments, Classes and Bookings from it |
| `lists/list-owner.service.ts` | `ListOwnerService`: `install` (a pair in one transaction, the target first), `repeat`, `setAbilities`, `contacts`, and the owner's list views (`abilities`, `time_zone`) |
| `lists/list-records.service.ts` | `in_use` on delete; `search` (OR of contains over text details, people only); `created_by` on people's views |
| `lists/list-definitions.service.ts` | `createList` and `addRule` take the caller's transaction |
| `lists/list-refusals.ts` | `in_use`, its §26 message, `refuse.inUse` |
| `lists/list.controller.ts`, `dto/list.dto.ts` | `GET …/lists/ready-made`, `POST …/lists/ready-made/:name`, `POST …/lists/:key/records/repeat`, `PUT …/lists/:key/abilities`, `GET …/lists/contacts` |
| `agent-tools/list-tools.ts` | §9: `datedLists` and `valueProperty` |
| `service/chatbot.service.ts` | `previewWrite` on the test chat |
| `bot-draft/home/assistant-home.service.ts` | `bookingLists` on How it works |
| Tests | `lists/test/lists-owner.pg.spec.ts` (33, Postgres), `agent-tools/test/list-tools-dated.spec.ts`, `list.controller.spec.ts` (every new route in `CALLS`), `list-locks.spec.ts` (§26 wording) |

**ally-ai:** `app/core/agent_runtime/tools/confirmed.py`: a `dated` property with no `relation` checks its own value (§9). Tests in `tests/core/agent_runtime/test_list_tools.py`.

**ally-web** (`apps/ally-admin-dashboard/src/`):

| File | What |
|---|---|
| `api/userLists.ts`, `types/userLists.ts` | RTK Query endpoints and types for `v1/chatbots/:id/lists*`; `listRefusalOf` |
| `components/v2/Forms.tsx`, `forms.css` | New v2 parts: `Select`, `Combobox`, `Switch`, `StatusPill`, `Skeleton`, `DatePicker`, `TimePicker` |
| `pages/AssistantHome/userLists/ListsSection.tsx` | The section: empty state, tabs, Add a list, the open list and its blocks |
| `…/userLists/EntriesTable.tsx` | Search, filters (a sheet on a phone), sort, 50 a page, phone cards, delete with Undo, Repeat weekly's sheet |
| `…/userLists/EntryForm.tsx` | The entry form; `FieldInput` (one input per kind); the linked-to picker; Free nearby; Reload; Created by |
| `…/userLists/DetailsBlock.tsx`, `RulesBlock.tsx`, `AssistantBlock.tsx` | Details, Rules as sentences, What your assistant can do |
| `…/userLists/ReadyMadeSetup.tsx`, `RepeatWeekly.tsx`, `NewListForm.tsx` | The guided setup, Repeat weekly with For each one, Start from scratch |
| `…/userLists/format.ts`, `examples.ts` | Dates in the business's zone, statuses, rule sentences, `purposeLimit` |
| `…/ui/AssistantSwitcher.tsx` | Switch assistant in the header |
| `…/fields.tsx` | `CollapsibleGroup` |
| `…/TryIt.tsx`, `sections/HowItWorks.tsx` | `testOnlyNotice`; the purpose's honest limit |
| `…/copy/userLists.ts` | Every string, deck §27 |
| Tests | `__tests__/userLists.test.tsx` (21), `userListsFormat.test.ts` (13), `HowItWorks.test.tsx` (+1), `copy.test.ts` (§27 against the deck); e2e `lists.e2e.ts`, `lists.design.e2e.ts` (the review shots), `lists.fixture.ts` |

## 2. The API added (ally-be)

All under `v1/chatbots/:id`, with the editor role unless it says viewer:

- `GET lists/ready-made` (viewer): the catalogue, grouped.
- `POST lists/ready-made/:name`, body `{ options? }`: installs the list and the one it points at, with no entries. An existing key is a refusal.
- `POST lists/:key/records/repeat`:
  - **body:** `{ field, days (1 Mon … 7 Sun), start, end (exclusive), every_minutes, from?, until, values?, dry_run? }`;
  - **returns:** `{ count (net), skipped, first, dry_run }`;
  - **rules:** at most 500, all or none, times already past left out, a needed detail must be given or have a default.
- `PUT lists/:key/abilities`, body `{ find?, create?, update? }`: writes only that list's three keys, and sets the list's agent read and write to match. `PUT :id/settings` still refuses `abilities` to owners.
- `GET lists/contacts?search=` (viewer): this bot's contacts, masked, for a detail linked to a person.
- **Additions to existing shapes:**
  - list views carry `abilities` and `time_zone`;
  - people's entry views carry `created_by` (`kind`, `name`, `you`, `conversation_id`);
  - the records query takes `search`.

## 3. Decisions, and mismatches with the brief

- **§9, the time check (Shehbaz's reading confirmed at the stop).** The brief's note said only the seeded slot was marked. The code disagreed:
  - Appointments → Slots, Reservations → Tables, Bookings → Classes and Registrations → Events were already marked, because 6 marked any relation to a list with a date field.
  - **Gap 1:** a date and time the agent fills in itself (Site visits' `at`) was never marked or checked.
  - **Gap 2:** a list whose first date field is date-only was marked `date`, even with a date-and-time field after it.
  - Both are fixed. The test is "the list has a date-and-time field": Classes and Events have a name as their title, but the brief names them as cases. A spec checks that exactly five fields across the catalogue are marked.
  - **ally-ai** checks the agent's own value as the wall time it was written in. A value written in UTC ("Z") is read as written and refused unless it matches: the safe direction.
- **Design decisions approved at the stop:**
  - **"Details", not "Fields",** as the block name ("say details").
  - **Collapsible blocks:** the home's own `Collapsed` is a native `<details>`, which the review ruled out, so the three blocks use a new `CollapsibleGroup`.
  - **Start from scratch** creates the list with one "Name" detail, so the table has a column.
  - **Try it from the setup** puts the question in the box rather than sending it.
  - **Add times:** "Add them" moves on; the other button reads "Skip for now".
  - **Example lines** in What your assistant can do use a sample time until the list has entries.
- **The design review's changes:**
  - **List names keep their capital everywhere.** One exception, as Shehbaz's own example has it: Repeat weekly's count reads the list as a plain plural ("This adds 32 slots.").
  - **Repeat weekly** gives every new entry the list's other details ("For each one").
  - **What counts as already there:** a time is skipped only when an entry at that time has the same details, so Dr Rao's 10:00 isn't skipped because Dr Mehta has 10:00. The spec that 5b's own first commit wrote changed with this: its "already there" slot now has Dr Mehta, so the batch adds 34 and the list holds 35 Dr Mehta slots.
  - **The layout:** the clipped and halfway-header screenshots were the capture, not the page. The home's header and left list are sticky, and a full-page capture stitches them in partway down. The shots now unstick them for the capture only. Every Lists screen now checks `scrollWidth <= innerWidth` at 1440 and 390, and none overflows.
- **Dark mode:** not built (decided at the plan). The home has no dark styles; a dark home is a follow-up for every section.
- **Purpose line:** the home showed no purpose card lines, so it goes in How it works' purpose layer (decided at the plan). It reads "What it can't do yet: …" with the live abilities.
- **Repeat weekly's count and first few** come from a dry run on every change (300 ms debounce). The dry run is also where a missing needed detail or the 500 cap is refused.
- **The catalogue, from ally-be at the review:**
  - Callback requests' reason isn't required, or the assistant could never add one.
  - On a health pack, Callback requests' reason and Support tickets' details are never stored from a conversation.
  - Memberships has nothing the assistant may fill in, so its Add and Change don't show.
  - Example questions were written where the catalogue had none: Event registrations, Admissions enquiries and Price list.
- **A person's label** in a linked-to picker is "Visitor · <tag>", with the tag hashed from the contact id. The inbox's tag comes from the conversation id, so the same person can carry two tags.
- **Ready-made installs write all three abilities explicitly,** so an old stored setting can't turn on Add.
- **The Context Library MCP isn't connected in this session,** so no product guidance was searched. The wording is the brief's and Shehbaz's.

## 4. Copy added

- **Deck §27, "Lists in the dashboard (5b)":** every string the section shows, approved at the stop with Shehbaz's changes. It's generated from `copy/userLists.ts`, and the copy test holds each string to the deck.
- **§26 additions (in the engine):**
  - `in_use`: "{n} entries in {list} use this. Cancel or move them first." / "1 entry in {list} uses this. Cancel or move it first."
  - ten new `{why}` reasons;
  - the 500-at-a-time limit.
- **The ready-made catalogue (`READY-MADE-LISTS.md` and the definitions file):**
  - "Time" as the date-and-time label on Slots, Tables, Classes and Events;
  - "Class bookings";
  - the new one-liners for Callback requests and Price list.
- **Wording to look at:** some §26 refusals still say "field" ("it isn't a field of this list", "its type can't change…"). They are the engine's words from 5a. Owners may see them in a refused detail change.

## 5. Checks

- **ally-be:**
  - full jest at the first commit: 1,123 suites and 16,598 tests passed (141 skipped);
  - lists and list-tools Postgres specs on `ally_lists_test`: 183 of 183, after the review fixes;
  - lint and typecheck ✅.
- **ally-ai:** the agent-runtime tests pass (344, 1 skipped), 5 of them new; flake8 ✅.
- **ally-web, on Node 22** (ally-web's version; on Node 24, 8 API test files fail with or without 5b):
  - the admin app's tests pass: 602 files, 10,151 tests, including 5b's 35;
  - typecheck ✅; lint on the changed files ✅.
- **Playwright on the fixtures** (`lists.e2e.ts` plus the home's sections), at 1440 and 390, light, with axe and no sideways scroll: **the Lists tests pass at both widths in the Playwright Docker image (10 of 10); the home's sections pass with Lists added.**
  - axe found one real issue on the phone: the switcher's channel line was too faint on the current assistant's tint. It now uses the muted colour.
  - The first Docker run stalled its dev server on the phone half; it passed rerun with two workers. Baselines made in the Playwright Docker image, as `e2e/README.md` says. The changed home baselines:
  - `home-change` (both widths), `home-overview`, `home-overview-all-numbers` and `home-page` (phone);
  - each changes for the new Lists entry in the left list or the phone's top menu;
  - `home-change` also picks up the Overview's longer "Your assistant is live…" line from an earlier chunk. That baseline was stale, but within the 1% threshold until now.
- **The design shots:** `LISTS_DESIGN_SHOTS=1 npx playwright test -c apps/ally-admin-dashboard/playwright.config.ts lists.design` writes `docs/agents-v2/design/5b/` at both widths.

### Live, on a local seeded bot

**Lakeview Family Clinic** (`a6fd6a0d…`, a local draft with the Bring in customers purpose), through ally-be's own services in the container:
- The owner screens' Playwright run needs a signed-in browser, and an owner token can't be signed in this session (as at 20d-2 and 6).
- Appointments installed with Slots. A second install was refused.
- Repeat weekly, weekdays 10:00 to 17:00 every hour until Sun 22 Nov, for Dr Mehta: the dry run said 35, then 35 were added. The same again skipped all 35; Dr Rao skipped none.
- Add and Change set to Do it: stored as `create_appointments: do_it` and `update_appointments: do_it`. Slots stays look-up only.

**Live action cases** (6's `cases/lists.json`, on Lakeview's ready-made lists): **4 of 6 passed.**
- **Passed:** book after a yes (11:00, cited); a taken slot, refused with the same day's nearest free times; nobody else's bookings revealed; Try it checked, not saved.
- **Failed:** `lists-whats-free` (the reply said "the team will confirm") and `lists-cancel` (it asked for a full name and phone before booking, so nothing was booked or cancelled).
- **Why:** Lakeview's purpose is Bring in customers, whose purpose section tells the assistant to collect a name and number and pass enquiries on. 6's runs were on a bot with no purpose. With booking on, that purpose's instructions now pull against the lists section.
- **Decision for Shehbaz:** chunks don't change prompt text, so this needs one. Either the enquiries purpose section steps aside when a writable list is offered (as 6 did for the two booking checks), or the lists section says it wins. Until then, an assistant on Bring in customers with Add on may still ask for a name before booking.

**Local state:** Lakeview now has Slots (35, Dr Mehta) and Appointments with Add and Change on. Sunrise still has no lists, as 6's checkups need.

## 6. How Shehbaz tests it

1. **Open a local assistant's home, then Lists.** Use one with no lists: Lakeview has them now, so use another, or remove Lakeview's.
2. **Start from a ready-made list → Appointments.** Replace the example services. Add times: weekdays, 10:00 to 17:00, every hour, until the end of next week, Practitioner "Dr Mehta". It should say "This adds 35 slots." Then Add them.
3. **Let your assistant use it:** set Add entries to Do it. The note shows once.
4. **On the bot page,** ask "what's free on Thursday?", then book one. Back in Lists, under Appointments, it shows with "By your assistant"; its form links to the conversation.
5. **Delete that booking's slot (Slots tab):** refused with "1 entry in Appointments uses this. Cancel or move it first."
6. **The same booking in Try it:** "Test only: this wasn't saved." The table doesn't change.
7. **How it works:** the purpose layer says "It books into your Appointments list. It can't take payments yet."
8. **At 390 px:** cards, the form as a bottom sheet, filters in a sheet, the setup one step per screen.

## 7. Open, for later chunks

- **The Bring in customers purpose and booking** (see "Live action cases"): the purpose's section needs a booking-aware line. That's a prompt change for Shehbaz to approve.
- **6:** the time check reads only the person's last two messages (unchanged). An agent-written date and time is compared as written; a model writing UTC is refused, which is safe.
- **In-use race:** a booking created at the moment its slot is deleted can slip past `in_use`, because a create doesn't lock its target row. Rare; a `FOR SHARE` on the target in `checkRelations` would close it.
- **21a:** erasure still doesn't reach list entries (5a's checklist line). The contacts picker shows masked labels only.
- **A time zone setting per bot** (6's note): lists show and repeat in the hand-over hours' zone, else Asia/Kolkata.
- **Dark mode for the home** (every section).
- **The public wiki (Docs guard at PR time):** the new list routes on `repos/ally-be.md`.
- **Owner screens on a seeded bot** need a signed-in browser or an admin token to automate. The fixtures cover the screens; the live run above covers the API.

## 8. Hours

About 7 h were planned. The guided setup, the assistant switcher, the new v2 form parts (select, combobox, date and time pickers, switch, pills, skeletons), the design stop and its review round added about 6 h. Total about 13 h.
