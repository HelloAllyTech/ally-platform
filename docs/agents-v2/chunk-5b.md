# Chunk 5b — Lists in the dashboard

> Brief for Claude Code. Read `CONTEXT.md`, `DESIGN.md`, `ONBOARDING-COPY.md` (§20, §25, §26), `CHUNK-05A-NOTES.md` (the engine and its API), `CHUNK-06-NOTES.md` (the list tools and Try it's preview writes), `CHUNK-20D2-NOTES.md` (the home's layout rules) and `FAST-TRACK.md` (5b), then this file. Plan first, as usual. <!-- docs-path-lint: planned -->
> Branch: `feat/agents-v2-fast-track`. Tag commits `[5b]`. Repos: ally-web, plus small additions in ally-be.
> You're the only session on the branch. Start after 6's last commit. In your first docs commit, commit this brief and set the root `CLAUDE.md`'s current-chunk line to 5b (`chunk-5b.md`).
> **No stop is planned.** The copy below is decided; anything you have to add follows the deck's voice and is listed in the notes for review.

## Why

5a built the lists and 6 lets the assistant book from them, but an owner can't see or change any of it. 5b adds a **Lists** section to each assistant's home: see and edit entries, shape a list's fields and rules in plain words, start from a ready-made list, and choose what the assistant may do with each one.

## What exists

- **ally-be:**
  - the owner API under `v1/chatbots/:id/lists`: lists, fields, rules, records, a JSON query, CSV export and import (with a dry run);
  - a record view with `title` and `display`, ready for people to read;
  - refusals with §26 messages (`LIST_REFUSED`, the refusal in `details`);
  - `list-seed.ts`, with the Slots, Appointments, Classes and Bookings definitions;
  - 3b's per-bot `abilities` map, platform admin only.
- **ally-web:** the assistant home's sections (`sections.ts`) and their copy files. `copy/lists.ts` already exists, for the home's small lists (access lists and the like): give this section its own copy file, so the names don't clash.

## Scope

### 1. The section

- A new home section, **Lists**, after What it knows. Add it to `SECTION_IDS`, the left list, and the phone's top menu.
- **No lists yet:** an empty state, "Keep your bookings, leads and orders here", with "Your assistant can look things up in them and, if you let it, book and change entries." The buttons are **Start from a ready-made list** and **Start from scratch**.
- **With lists:** a row of tabs, one per list, plus **Add a list**. The open list shows its entries, then **Fields**, **Rules** and **What your assistant can do**, as collapsible blocks below the table.

### 2. Entries (the table)

- Columns are the list's live fields, by position. Values come from `display`, and a relation shows its target's title.
- **Search** (the contains filter over the text fields), plus one filter per select field (for example Status), a sort by any column, and cursor paging of 50.
- **Add** and **Edit** open a form built from the fields: one input per type (a date picker, a date-and-time picker, a select, a yes/no switch, a relation picker that searches the target list or the assistant's contacts). Required fields are marked.
  - Every save sends the version it read. A refusal shows its §26 message next to the field, or above the form. `version_conflict` offers **Reload**.
  - On a status field with a transitions rule, the select offers only the allowed next values.
- **Delete** asks once, and can be undone from a toast for as long as it shows (restore).
- **On a phone,** each entry is a card: its title, then the first three fields.
- **Created by** shows on the entry's form: You, Your assistant (with a link to the conversation, if there is one) or an import.

### 3. Fields

- Add, rename, reorder (up and down buttons; no drag), change the type, set options for a select, required, a default, and archive.
- Privacy, in plain words: **Your assistant can see this** (agent read), **Your assistant can fill this in** (agent write), **Hide most of it from your assistant** (masked), **Never take this from a conversation** (never_store).
- A refused change (a type change with values, archiving a field a rule uses) shows the engine's reason.
- The person field is chosen once, as **Whose entry is this?**, from the relation-to-contact fields. It's locked once the list has entries, with the reason shown.

### 4. Rules, in plain words

Each rule shows as a sentence, and **Add a rule** offers four kinds as sentences to fill in:

- **Only one entry per {field}** (unique), with "…not counting entries whose {status} is {cancelled}";
- **At most {n} entries per {field}**, or **as many as its {number field}** (capacity);
- **At most {n} per person** (limit per person), with the same "not counting" option;
- **{Status} can only move like this:** a small grid of from → to, plus where entries start (transitions).

Adding a rule that existing entries break shows the engine's refusal and lists those entries, each linked to its form.

### 5. What your assistant can do

For each list:

- **Look things up in it:** Do it or Never;
- **Add entries:** Do it or Never, shown only when at least one field allows it;
- **Change entries:** Do it or Never, shown under the same condition.

These write the `find_`, `create_` and `update_<key>` keys of the bot's `abilities`, plus the list's agent read and write switches.

- **ally-be:** an owner can change only these list-tool keys, through a new route, `PUT v1/chatbots/:id/lists/:key/abilities`, with the editor role. `hand_over` and any other key stay platform-admin only, as 3b built them, and the existing settings route still refuses them to owners.
- **Turning on Add or Change for the first time** shows a short note: "Your assistant will book only after the person confirms. Check new entries for the first few days."

### 6. Ready-made lists and "Repeat weekly until"

- **Start from a ready-made list** offers the whole catalogue in `READY-MADE-LISTS.md`: 14 lists, grouped as that file groups them, each with a one-line "for clinics, salons…" description. <!-- docs-path-lint: planned -->
  - It installs the definitions (fields, rules, settings and the assistant's switches) with no entries. Add and Change start at Never.
  - Selects marked "your services" (and the like) install with example values, and the list opens with a prompt to replace them.
- **ally-be:** `POST v1/chatbots/:id/lists/ready-made/:name` installs from one definitions file in code. It takes the catalogue word for word, and it's the same source the seed uses.
  - A spec installs every one and checks its rules are valid.
  - An existing list with the same key is a refusal, not an overwrite.
  - A pair (Appointments with Slots, Site visits with Property listings and so on) installs both in one transaction.
- **Repeat weekly until,** on a list with a date-and-time field (Slots):
  - fill in the days, a start and end time, every N minutes, and an end date;
  - you see "This adds 35 slots", then they're added.
  - **ally-be:** `POST …/lists/:key/records/repeat` creates them in one transaction through the engine, at most 500 at a time, skipping times that already exist. No recurrence is stored.

### 7. When a slot with bookings is deleted

5a allows it, and the bookings keep a dead slot. **Decided:** deleting an entry that live entries in another list point at, through a required relation, is refused: "3 entries in Appointments use this. Cancel or move them first." That's a small engine change in ally-be (a new code, `in_use`, with its message added to §26). Archived or cancelled entries don't count: count only the ones a unique or capacity rule would count, or else all live ones.

### 8. Try it and the purpose card

- **Try it:** when a reply's run made a write in preview (6 marks them in the trace), show under it "Test only: this wasn't saved."
- **The purpose card:** for an assistant whose Add entries is Do it on a list, the "Bring in customers" won't-line "It can't book or take payments yet…" becomes "It books into your {list} list. It can't take payments yet." Where the home shows the card's lines, use the live abilities.

### 9. The time check covers every list that needs it

6's time check only runs on fields ally-be marks, and today only the seeded appointment's slot is marked. Mark them from the definition instead:

- any writable relation to a list that has a date-and-time field (Appointments → Slots, Reservations → Tables, Bookings → Classes, Registrations → Events);
- any writable date-and-time field the agent fills in itself (Site visits' `at`).

Lists made from scratch get the same marking.

**Test:** a Site visits booking at a time the person didn't confirm is refused, and a Bookings create checks the class's time.

### 10. Copy deck §27, "Lists in the dashboard (5b)"

Every owner-facing string from this chunk, in the deck's voice. The ones above are decided; list any you add in the notes.

## Decided

- No board or calendar views, no saved filters, no field permissions for staff roles, no bulk edit.
- Abilities for list tools become owner-editable; `hand_over` stays platform-admin only.
- Ready-made lists live as definitions in ally-be code. Templates (18a) come later.
- Deleting an entry that live entries depend on is refused (§7).

## Out of scope

Views beyond the table. Undo for definition changes. Templates and sharing. The approvals inbox (14a). Erasure of a person's entries (21a).

## Tests

- **ally-be:**
  - the abilities route: an editor sets list-tool keys; it can't touch `hand_over` or another list's keys; a viewer can't;
  - ready-made lists: each installs, a second install is refused, and Book and Change start at Never;
  - repeat: the count, existing times skipped, the cap of 500, rules applied;
  - `in_use` on delete, with the count.
- **ally-web** (unit, as the home's other sections are tested):
  - the empty state and the ready-made flow;
  - the table: search, filter, sort, paging, add, edit, a refusal shown at its field, a version conflict, delete then undo;
  - the field editor, rules as sentences, an offending-entries list, the switches;
  - Try it's "Test only" line; the purpose card's line;
  - the copy against the deck.
- **Playwright** at 1440 and 390 px, light and dark, axe on each, on the dev fixtures and on a local seeded bot (`lists:seed`).
- Full suites, lint and typecheck in ally-web and ally-be.

## Report (`CHUNK-05B-NOTES.md`) <!-- docs-path-lint: planned -->

The code map, the screenshots, the copy added, mismatches with this brief, and anything 6 or 21a should know.

## Done when

- [ ] An owner adds Appointments with Slots from the ready-made lists and fills next week's slots with Repeat weekly until
- [ ] An owner turns on Book, and the assistant books one on the bot page; it appears in the table, marked as made by the assistant
- [ ] Try it books the same way but says "Test only: this wasn't saved", and the table doesn't change
- [ ] Fields, rules and switches can be changed in plain words; refusals show where they belong
- [ ] Playwright at 1440 and 390 px, light and dark, axe clean
- [ ] Copy deck §27; `CHUNK-05B-NOTES.md`; 5b's row in `v2-chunks.md`'s Progress table <!-- docs-path-lint: planned -->

## How Shehbaz tests it

1. **Open a local assistant's home, then Lists.** Start from a ready-made list and choose Appointments.
2. **On Slots,** use Repeat weekly until: weekdays, 10:00 to 17:00, every 60 minutes, until the end of next week.
3. **Under What your assistant can do,** set Add entries to Do it.
4. **On the bot page,** ask "what's free on Thursday?", then book one. Back in Lists, the booking is there, marked as made by your assistant.
5. **Delete that booking's slot:** it's refused, with the reason.
6. **Do the same booking in Try it:** "Test only: this wasn't saved", and the table doesn't change.
7. **Check it on your phone,** or at 390 px wide.
