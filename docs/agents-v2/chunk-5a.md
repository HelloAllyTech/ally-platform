# Chunk 5a — Lists core

> Brief for Claude Code. Read `CONTEXT.md`, `TEMPLATE-DATA-MODEL.md` (§2 Lists, §4, §6, §8), `BUILDING-BLOCKS.md` (Lists, Generated agent tools), `FAST-TRACK.md` (5a and 6) and `CHUNK-03B-NOTES.md` (the gateway), then this file. Plan first, as usual. <!-- docs-path-lint: planned --> Branch: `feat/agents-v2-fast-track`. Tag commits `[5a]`. Repo: ally-be only. You're the only session on the branch. Start after 3b's last commit. In your first docs commit, commit this brief, `chunk-6.md`, and `FAST-TRACK.md` if it shows as changed (all written outside a session), and set the root `CLAUDE.md`'s current-chunk line to 5a (`chunk-5a.md`). **No stop is planned.** Owners see nothing yet: 5b builds the screens, and 6 gives the agent its tools. Stop only for a destructive migration, a new dependency, or something here that can't be built as written.

## Why

Owners need their own lists (bookings, slots, leads, orders, classes) with rules the assistant can't break: "only one booking per slot", "at most 20 in a class". 5a is the engine underneath: the tables, typed fields, rules enforced in code inside one transaction, and an owner API. 6 then generates the agent's tools from these definitions, and 5b builds the screens on the same API. Nothing is coded per template: a list is rows in a few fixed tables (`TEMPLATE-DATA-MODEL.md` §1).

## Scope

### 1\. Tables

One additive migration, after the newest on the branch (3b's).

* **`collections`:** id, chatbot id, `key` (a slug: lower case, digits and `_`, at most 40 characters, unique per bot among lists not deleted), name, `settings` (jsonb: the title field, the default sort, the person field), agent read and agent write (list-wide switches), `deleted_at`, timestamps.
* **`collection_fields`:**
    * id, collection id, `key` (unique per list), label, `type`, `options` (jsonb), required, `default` (jsonb), `privacy` (jsonb: `never_store`, `masked`);
    * agent read and agent write, per field;
    * position and `archived_at`.
* **`collection_constraints`:** id, collection id, `kind`, `config` (jsonb).
* **`collection_records`:**
    * id, chatbot id, collection id, `data` (jsonb), `contact_id` (the person it belongs to, if any);
    * `created_by` (jsonb: a user, an agent run, an import), `version`, `deleted_at`, timestamps.
    * A GIN index on `data` (`jsonb_path_ops`), and an index on the collection for live records.
* **`record_links`:** record id, field key, target kind (`record` or `contact`), target id. Indexed both ways, so "which bookings point at this slot" is one lookup.
* **`record_events`:** record id, `op` (create, update, delete, restore), before, after, actor (jsonb), run id, created at.

Check constraints for every enum, as the repo's `check-constraints-cover-enums` spec requires. No `status` column: a status is an ordinary select field, so transitions work on any select. Every query is scoped by chatbot id.

### 2\. Field types

text, long text, number, money (a number, with `options.currency`, INR by default), date, date and time, duration (minutes), select (`options.values`), yes/no, phone, email, URL, and relation.

* **A relation** points at a contact (`{ to: 'contact' }`) or at another list of the same bot (`{ to: '<list key>' }`). A relation to a list in another bot is refused.
* **Dates and times** are stored as ISO 8601 with their offset.
* **Validation in code:** types, required fields, select values, the formats of phone, email and URL, and that relation targets exist and are live.

### 3\. Rules \(constraints\)

Enforced in code, inside the write's transaction, after taking advisory locks on the rule's keys. Lock in a fixed order, so two writes can't deadlock.

| Kind | Config | Example |
| ---- | ------ | ------- |
| `unique` | `{ fields: [...], where? }` | One live booking per slot: `{ fields: ['slot'], where: { field: 'status', not_in: ['cancelled'] } }` |
| `capacity` | `{ field, max }` or `{ field, max_from }` (a number field on the target record) | At most `class.seats` bookings per class |
| `limit_per_person` | `{ field, max, where? }` | At most 2 active bookings per client |
| `transitions` | `{ field, initial: [...], allowed: { from: [to, …] } }` | booked → confirmed or cancelled |

* `where` is structured (`{ field, in | not_in }`), never a string to parse.
* **Transitions:** a new record starts in an `initial` value. On an update, a move not in `allowed` is refused.
* **Adding a rule** first checks the list's existing records. If any break it, they're returned and the rule isn't added.
* Waitlists, ranges, rules tables, rollups and formulas wait.

### 4\. The write and read engine

One service that the owner API, CSV import and 6's tools all use.

* **Write** (`create`, `update`, `delete`, `restore`) for an **actor**: a user (owner or editor), an import, or the agent with a run id.
    1. Validate, including which fields this actor may write:
        * the agent writes only fields with agent write on, on a list with agent write on, and never a `never_store` field;
        * the person field is set by the caller, never from the agent's input (see §5).
    2. In one transaction: take the locks, check the rules, then write the record, its links and an event, bumping `version`.
    3. An update carries the version it read. A stale one gets a `version_conflict`.
* **A refusal** is `{ code, field?, message, conflict? }`:
    * codes: `required_missing`, `invalid_value`, `not_writable`, `unique_taken`, `capacity_full`, `limit_reached`, `transition_not_allowed`, `not_found`, `version_conflict`, `limit_exceeded`;
    * `message` is plain words from copy deck §26 (below);
    * for `unique_taken` and `capacity_full` on a relation, `alternatives` lists up to 3 target records that would pass. Take them in the target list's default sort, from now onwards, from records whose dates are in the future. Only fields the actor may read are included.
* **Read:**
    * filters: equals, contains (text), and ranges (number, money, date, date and time, duration);
    * sort, a cursor, limit, and count or sum over the matching records;
    * for the agent: only readable fields; `masked` values keep their last 4 characters; `never_store` fields are never returned;
    * the record's title, from `settings.title_field`, rendered for display. A relation shows its target's title.

### 5\. Lists that belong to a person

* `settings.person_field` names a relation-to-contact field (Appointments' `client`). Its value is mirrored into `collection_records.contact_id`.
* 6 relies on this to keep one person's records from another. The engine offers an option that scopes a read or write to one contact: a read sees only that contact's records, and a write sets the person field to that contact and can't change it.
* A list without a person field (Slots, Products, Listings) is shared reference data.

### 6\. The owner API

Under `v1/chatbots/:id/lists`, with the same access checks as the bot's settings: viewers read, editors write.

* **Lists:** list, create, read, update (name, settings, agent switches), delete (soft; restore within 30 days).
* **Fields:** add, update (label, options, required, default, privacy, agent switches, position) and archive.
    * A type change is refused while any record has a value for the field, with a plain reason. A background conversion waits.
* **Rules:** add (checked against existing records first) and remove.
* **Records:** query (the read engine), create, update, delete and restore.
* **CSV:**
    * **Export:** a header of field keys; dates in ISO; a relation as its target's id.
    * **Import:** a dry run returns errors per row; a commit writes the valid rows through the same engine, so every rule applies. At most 5,000 rows a file. A relation column takes the target's id, or its title when exactly one record matches.
* **Limits:** 50 lists per bot, 100 fields per list, 200,000 records per bot, 32 KB of `data` per record. Each is refused with `limit_exceeded`.

### 7\. A seed for building and testing

A small dev script, `npm run lists:seed -- --bot <id>` (ally-be). It creates **Slots** and **Appointments** as in `TEMPLATE-DATA-MODEL.md` §3, and a **Classes** list with `seats` and a Bookings list with a capacity rule.

* No recurrence; no `options_from`, so `service` has fixed values.
* It fills next week's slots (weekdays, 10:00 to 17:00, every 60 minutes, in Asia/Kolkata).
* It adds one contact, "Test person", for trying bookings, and prints its id.
* Running it again changes nothing.
* 6 and its evals use it; 5b turns the same definitions into ready-made lists.

### 8\. Copy deck §26 \(new\): the refusal messages

Add to `ONBOARDING-COPY.md` as §26, "Lists (5a)". The owner's screens (5b) and the agent (6) both show these.

* required\_missing: {field} is needed.
* invalid\_value: {field} isn't valid: {why}.
* not\_writable: {field} can't be changed here.
* unique\_taken: That {field} is already taken.
* capacity\_full: {target} is full.
* limit\_reached: This person already has {max} {list}.
* transition\_not\_allowed: {list} can't go from {from} to {to}.
* not\_found: That entry doesn't exist any more.
* version\_conflict: Someone changed this entry just now. Reload and try again.
* limit\_exceeded: This would go over the limit of {limit}.

## Decided

* **No recurrence engine.** 5b's "Repeat weekly until" creates the records.
* **No views table.** 5b shows a table; board and calendar views wait.
* **`never_store`** means the field is never written from a conversation: the agent can't write it and can't read it. Staff can still fill it in. **`masked`** means the agent sees the last 4 characters; the owner sees and exports the whole value.
* **Erasure doesn't reach list records yet** (21a, next sprint). Records are business data and have no retention sweep. Until 21a, a person's records are deleted by hand when they ask. Put this line in `LAUNCH-CHECKLIST.md`.
* **The engine owns every rule.** No rule is ever checked only in a prompt or only in the UI.

## Out of scope

The agent's tools (6). Screens (5b). Recurrence, waitlists, rules tables, rollups, formulas, file fields, views. Templates, versioned definitions and Undo for definition changes. Erasure and export of a person's records (21a).

## Tests (real Postgres for the engine, as in `ally-be/src/whatsapp/shared-store/test/erasure.pg.spec.ts`)

* **Booking:**
    * two concurrent bookings of the same slot: exactly one wins, and the other gets `unique_taken` with alternatives;
    * cancelling frees the slot for the next booking.
* **Classes:** the 21st booking in a class of 20 gets `capacity_full`. With `max_from`, raising the class's seats lets it in.
* **Per person:** a third active booking gets `limit_reached`; a cancelled one doesn't count.
* **Transitions:** booked → completed is refused; booked → confirmed → completed passes; a create outside `initial` is refused.
* **The agent as actor:**
    * it can't write a field with agent write off, a `never_store` field or the person field;
    * it reads masked values masked, and never a `never_store` field;
    * a read scoped to one contact sees only their records.
* **Tenancy:** a relation to another bot's record is refused; no query crosses bots.
* **Rules:** adding one that existing records break is refused, and the offending records are listed.
* **Changing fields:** a type change with values is refused; an archived field is hidden and keeps its values.
* **CSV:** export then import round-trips; a dry run reports errors per row; an import can't get past a rule.
* **Limits:** each one, and a stale version on an update.
* **API:** access by role; a viewer can't write; another bot's ids get 404.
* **The seed** runs twice and the second run changes nothing.
* Full suite, lint, typecheck and build. `migration:run`, revert, then run again.

## Report (`CHUNK-05A-NOTES.md`) <!-- docs-path-lint: planned -->

The code map, the tables and indexes, the engine's API for 6, how locking works, the copy added, mismatches with this brief, and the lines added to `LAUNCH-CHECKLIST.md`.

## Done when

* [ ] Slots, Appointments, Classes and Bookings built by the seed, through the API
* [ ] A taken slot is refused with a reason and up to 3 free alternatives; two concurrent bookings never both win
* [ ] The 21st booking in a class of 20 is refused; transitions hold; the per-person limit holds
* [ ] The agent's permissions, masked and `never_store` fields, and per-contact scoping are enforced in the engine
* [ ] CSV export and import, with rules applied on import
* [ ] Copy deck §26; `CHUNK-05A-NOTES.md`; 5a's row in `v2-chunks.md`'s Progress table; the erasure line in `LAUNCH-CHECKLIST.md` <!-- docs-path-lint: planned -->

## How Shehbaz tests it

1. `npm run lists:seed -- --bot <a local test bot's id>` in ally-be.
2. `GET /api/v1/chatbots/:id/lists`: Slots, Appointments, Classes and Bookings.
3. Book a slot: `POST …/lists/appointments/records` with a slot id from `GET …/lists/slots/records` and the Test person's id from the seed. Post the same slot again: you get "That slot is already taken." and three free slots.
4. Export Appointments as CSV, change a row's status from booked to completed, and import it as a dry run. The row is refused: booked can't go to completed.