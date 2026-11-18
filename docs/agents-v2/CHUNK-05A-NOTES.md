# Chunk 5a notes: lists core

**Brief:** [chunk-5a.md](./chunk-5a.md). **Branch:** `feat/agents-v2-fast-track`; commits tagged `[5a]`, not pushed. **Baseline:** `c2f925969` (3b's last commit). Plan approved 13 Nov with Shehbaz's changes: field keys follow the list-key slug rule (with a CHECK), every field key is a bind parameter in SQL and sort/filter keys must name live fields, `%`/`_` escaped in contains, CSV export needs an editor, the seed refuses production, and `chunk-6.md` brought up to date with 3b's findings.

> Status: **built, waiting for Shehbaz's review** (14 Nov 2026).

## Report: 5a is done

Owners' lists now have an engine: six tables, typed fields, rules the engine enforces inside one locked transaction, an owner API and CSV. Nobody sees it yet: 5b builds the screens and 6 the agent's tools.

| Done when | Result |
|---|---|
| Slots, Appointments, Classes and Bookings built by the seed, through the engine | ✅ `npm run lists:seed` on a local bot: 35 slots, 3 classes, a Test person; a second run says "already there" and adds nothing |
| A taken slot is refused with a reason and up to 3 free alternatives; two concurrent bookings never both win | ✅ live: `409`, "That slot is already taken.", the next three free slots; Postgres spec: two bookings at once, exactly one row |
| The 21st booking in a class of 20 is refused; transitions hold; the per-person limit holds | ✅ Postgres specs ("Spin is full.", raising seats lets it in; booked → completed refused; the 3rd active booking refused, a cancelled one not counted) |
| The agent's permissions, masked and never_store fields, and per-contact scoping are enforced in the engine | ✅ Postgres specs |
| CSV export and import, with rules applied on import | ✅ live: the booked → completed row is refused in a dry run; specs: round trip, per-row errors, rules across rows |
| Copy deck §26; these notes; the Progress row; the erasure line in `LAUNCH-CHECKLIST.md` | ✅ |

| Commit | What |
|---|---|
| `526ffe1a1` | docs: the brief, `chunk-6.md` (renamed from `chunk6.md`, with 3b's findings), FAST-TRACK, current chunk |
| `51928845a` | migration `1981900950000-AddLists`, six entities, the enums and their CHECK spec rows, `DATA_SCHEMA.md` |
| `ea5203746` | the engine, definitions, CSV, the owner API, unit and Postgres specs |
| `f0beb777c` | `npm run lists:seed` |
| `aaf83d79a` | found live: the app's exception filter dropped the refusal's code and alternatives; now `errorCode: LIST_REFUSED` with the refusal as `details` |
| this one | copy deck §26, these notes, the checklist and the Progress row |

**Checks:** ally-be full jest 1,121 suites passed (12 skipped), 16,552 tests passed (100 skipped: Postgres specs without a test database); `npm run lint` ✅; `npm run build` ✅ (8 GB heap); typecheck ✅. With `CHATBOT_STORE_TEST_DB` on `ally_lists_test`: the 19 lists Postgres tests pass. `migration:run`, `migration:revert`, `migration:run` on the local database: ✅ (then re-seeded).

**Local state:** the draft "Host" bot (`60b6e860…`) has the four seeded lists and one Appointments record (a booking of Mon 16 Nov 10:00 for the Test person, `53ca76ae…`). Sunrise (`abdfd2d1`) has no lists, as 6's unchanged-checkup check needs. A scratch database `ally_lists_test` (a copy of `ally_h0_fresh`, migrated) holds the Postgres specs.

### How Shehbaz tests it

1. **Seed** a local test bot (not Sunrise): `docker exec -w /app ally-be-app-1 npm run lists:seed -- --bot <id>`. It prints each list's id and the Test person's id. Run it again: everything is "already there".
2. **`GET /api/v1/chatbots/:id/lists`** → slots, appointments, classes, bookings, with fields and rules.
3. **Book a slot:** take a slot id from `GET …/lists/slots/records?limit=3` and `POST …/lists/appointments/records` with `{ "data": { "slot": "<slot id>", "client": "<Test person id>" } }` → `201`, status `booked`, title like "Mon 16 Nov 2026, 10:00". **Post the same again** → `409`, `message` "That slot is already taken.", `errorCode` `LIST_REFUSED`, and `details.conflict.alternatives`: three free slots.
4. **CSV:** `GET …/lists/appointments/export.csv` (as an editor), change the row's `booked` to `completed`, then `POST …/lists/appointments/import` with the file as `file` (multipart) → `dry_run: true`, and the row's error: "Appointments can't go from booked to completed." Nothing changes; add `commit=true` to write the rows that pass.
5. Also try: `GET …/lists/slots/records?from.starts_at=<a Tuesday>T00:00:00%2B05:30&to.starts_at=<same day>T23:59:00%2B05:30&sort=-starts_at` (one day's slots, latest first), and `POST …/lists/appointments/records/query` with `{ "aggregate": "count" }`.

## 1. Code map (ally-be)

| File | What |
|---|---|
| `database/migrations/1981900950000-AddLists.ts` | The six tables (§2) |
| `chatbot/entity/collection*.entity.ts`, `record-link.entity.ts`, `record-event.entity.ts` | Entities (in `chatbot/entity/`, the only folder depth the TypeORM glob loads) |
| `chatbot/enum/list.enum.ts` | `ListFieldType`, `ListConstraintKind`, `RecordLinkTargetKind`, `RecordEventOp` (rows in `check-constraints-cover-enums.spec.ts`) |
| `chatbot/lists/list-records.service.ts` | **The engine**: create, update, delete, restore, get, query, views |
| `chatbot/lists/list-definitions.service.ts` | Lists, fields and rules |
| `chatbot/lists/list-csv.service.ts` | Export and import |
| `chatbot/lists/list.controller.ts`, `dto/list.dto.ts` | The owner API (§6) |
| `chatbot/lists/list-fields.ts` | Types: options, value checks and normalising, display, masking |
| `chatbot/lists/list-rules.ts` | `Sql` (bind parameters), `where`, rule configs, existing violations |
| `chatbot/lists/list-locks.ts` | Lock keys and their order (§4) |
| `chatbot/lists/list-store.ts` | `loadList` (with the list row lock), `LoadedList`, `TitleResolver` |
| `chatbot/lists/list-refusals.ts` | Codes, `ListRefusalException`, copy deck §26 (`LIST_COPY`) |
| `chatbot/lists/list-limits.ts`, `list-types.ts`, `list-entities.ts` | Limits, types, the entity list for scripts and specs |
| `chatbot/lists/list-seed.ts`, `database/scripts/seed-lists.ts` | The seed |
| `chatbot/lists/test/` | `lists.pg.spec.ts` (19, real Postgres), `list-fields.spec.ts`, `list-locks.spec.ts` (also §26's wording), `list.controller.spec.ts` (roles for every handler) |
| `exception/error-code.enum.ts` | `LIST_REFUSED` (additive) |

Wired in `chatbot.module.ts` (not a module of its own, so 6's gateway tools in the same module can inject the engine without a cycle); `ListRecordsService` and `ListDefinitionsService` are exported.

## 2. Tables and indexes

- **`collections`:** `key` CHECK `^[a-z0-9_]{1,40}$`; partial unique `(chatbot_id, key) WHERE deleted_at IS NULL`; `settings` `{ title_field, default_sort, person_field }`; `agent_read`, `agent_write` (default off).
- **`collection_fields`:** unique `(collection_id, key)` (archived included, so a key is never reused); key CHECK as above; type CHECK; `options`, `default`, `privacy` jsonb; `agent_read` default on, `agent_write` default off.
- **`collection_constraints`:** kind CHECK; `config` jsonb.
- **`collection_records`:** GIN `(data jsonb_path_ops)` (every equality lookup is `data @> $n::jsonb`); partial `(collection_id) WHERE deleted_at IS NULL`; `(chatbot_id)`; `(contact_id)`. `contact_id` → `chatbot_contacts` **ON DELETE SET NULL** (erasure only blanks contacts today; this keeps a future delete from failing).
- **`record_links`:** `(record_id, field_key)` and `(target_kind, target_id)`.
- **`record_events`:** `(record_id, created_at)`; `run_id` for the agent.
- Every query names the bot: records by `chatbot_id` and `collection_id`, lists by `chatbot_id`, relation targets joined to a list of the same bot.

## 3. The engine's API, for 6

```ts
records.create(chatbotId, listKey, actor, data, opts?)            → { record, dry_run? }
records.update(chatbotId, listKey, actor, id, patch, version?, opts?)
records.delete(chatbotId, listKey, actor, id, opts?)              // soft
records.restore(chatbotId, listKey, actor, id, opts?)
records.get(chatbotId, listKey, actor, id, { contactId? })
records.query(chatbotId, listKey, actor, { filters, sort, cursor, limit, aggregate }, { contactId? })
```

- **`actor`:** `{ kind: 'agent', runId }` | `{ kind: 'user', userId }` | `{ kind: 'import', userId }`.
- **`opts.contactId`:** scopes to one person on a list with a person field. **The agent is always scoped there:** left out counts as `null`, which reads nothing and writes nothing (`not_found`). On a shared list (no person field) nothing is scoped.
- **`opts.dryRun`:** every check and lock runs, the real result comes back with `dry_run: true`, and the transaction rolls back (6's Try it).
- **The agent:** writes only fields with agent write on, on a list with agent write on, never `never_store` and never the person field (`not_writable`); reads only fields with agent read on, on a list with agent read on, minus `never_store`, with `masked` values as `••••1234`; can't filter or sort on a masked field (that would let it guess); a list without agent read is `not_found`. Its writes record `run_id` in `record_events`.
- **A record view:** `{ id, version, title, data, display, contact_id, created_at, updated_at }`. `display` renders each value for people ("Thu 19 Nov 2026, 11:15"; a relation shows its target's title; "Yes"/"No"). `title` is the title field, rendered, or the first field the reader may see whole.
- **A refusal:** `ListRefusalException.refusal` = `{ code, field?, message, conflict? }`. Over HTTP: status 400/404/409, `message` (§26), `errorCode: 'LIST_REFUSED'`, `details` = the refusal.
- **Update without `version`** (CSV import) changes the record as it is now; the API always sends one.
- **Filters:** `eq` (any field), `contains` (text, long text, phone, email, URL), `from`/`to` (number, money, duration, date, date and time). Sort: a field key or `-key`, then the id. `aggregate`: `count` or `sum:<key>` (numeric fields). Cursor pages; `limit` 1–100.

## 4. How locking works

1. **The list row:** a record write takes its list's `collections` row `FOR SHARE`; a definition change (field, rule, settings, delete) takes it `FOR UPDATE`. Writes run side by side; a new rule waits for them, and they wait for it, so a rule never lands between a write's check and its commit.
2. **The record row:** an update, delete or restore takes `SELECT … FOR UPDATE` on the record, then checks `version`.
3. **Advisory locks (`pg_advisory_xact_lock`, released at commit):** for each unique, capacity and limit-per-person rule that applies to the record, a **list-wide key** `lists:<rule id>` taken **shared** and a **value key** `lists:<rule id>:<value>` taken **exclusive**. Then the rule's count runs (READ COMMITTED, so it sees the other write's commit). Two bookings of one slot queue on the value key; bookings of different slots don't wait for each other.
4. **Fixed order:** list-wide keys before value keys, each sorted, one entry per key (`lockOrder`). Row locks always come before advisory locks. So no two writes can each hold what the other waits for.
5. **Import:** takes each rule's list-wide key **exclusive** and no value keys (`lockMode: 'list'`). It holds a handful of locks for the whole file instead of one per row (Postgres's lock table is shared and finite), and keeps every other writer to that list's rules out while it runs.
6. Transitions need no advisory lock: the record's row lock covers them.

## 5. Copy added

Copy deck §26 "Lists (5a)" in `ONBOARDING-COPY.md`: the ten refusal messages as the brief wrote them, plus the `{why}` reasons and the `{limit}` wordings the engine uses. Mid-sentence, a label or list name is lower-cased ("That slot is already taken.", "This person already has 2 appointments.").

## 6. Mismatches with the brief, and decisions

- **`capacity` takes an optional `where`** (same shape as unique's). Without it cancelled bookings would fill a class. Approved at the plan.
- **The seed's slot `practitioner` is text**, not a relation to a contact (`TEMPLATE-DATA-MODEL.md` §3): practitioners aren't chat contacts. Approved.
- **Refused, not in the brief:** changing a list's person field once it has records (it would leave `contact_id` stale); archiving or retyping a field a rule or the settings use, or another list's `max_from` reads. Approved.
- **Allowed:** deleting a slot that live bookings point at (no rule in the brief). The bookings keep its id; a write that sets a relation needs a live target. For 5b to decide.
- **No purge job:** a deleted list is restorable for 30 days, then restore stops working; its rows stay.
- **The 200,000-records limit is a count,** not serialised per bot: two writes at once can go one over.
- **Rules per list: 20** (not in the brief; a bound for the locks and checks). One transitions rule per field.
- **Restoring a deleted list** is `POST …/lists/:listId/restore` by the list's id (a deleted list's key may be taken again).
- **Alternatives** for a unique rule only when it has one field. They come from the target list's live records whose first date or date-and-time field is from now on (all of them if the list has no date field), in its default sort, else that date field; each is re-checked against the same rule. The agent gets none from a list it can't read or a list with a person field.
- **The refusal for a rule that existing records break** is `invalid_value` ("The rule isn't valid: 2 entries already break it.") with the records in `conflict.records` (up to 50).
- **The global exception filter** keeps only `message`, `errorCode` and `details`; the refusal travels as `details` with the new `LIST_REFUSED` code (found live, `aaf83d79a`). The filter logs every refusal at error level with its message; a capacity message names the target record's title.
- **CSV:** the export puts `id` first; text starting with `=`, `+`, `-`, `@`, tab or CR is written with a leading `'` (spreadsheet formula injection), which import drops again, so a round trip is exact. An empty cell clears a field on an update and leaves the default on a create. Unknown columns refuse the whole file. 5 MB a file as well as 5,000 rows.
- **Settings in `PATCH …/lists/:key` replace the whole settings object.**
- **The Context Library MCP isn't connected in this session,** so no product guidance was searched (ally-be's CLAUDE.md asks for it at judgement points such as refusal wording). The wording is the brief's.

## 7. Lines added to `LAUNCH-CHECKLIST.md`

- Migration `1981900950000-AddLists` (additive) runs with ally-be.
- Erasure doesn't reach list records yet (21a): delete a person's records by hand when they ask (by `contact_id`, and any other relation-to-contact value naming them).
- `lists:seed` is for local and staging bots only.

## 8. Open, for later chunks

- **6:** the gateway's tools call `records.*` with `{ kind: 'agent', runId }` and `{ contactId: token.contactId }`, `dryRun` in Preview; the refusal's `details` is what the agent reads. 6's brief now says WhatsApp's token needs the contact (`chunk-6.md` §2).
- **5b:** what happens to bookings when their slot is deleted; showing `display` and `title`; the `{why}` lines are owner-facing too.
- **21a:** erasure and export of a person's records; a purge for lists deleted over 30 days ago.
- **Public wiki (Docs guard at PR time):** the new `v1/chatbots/:id/lists` routes on `repos/ally-be.md`.
