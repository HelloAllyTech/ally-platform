# Assistants cutover runbook

Stage 10 of the Assistants build plan. Read the whole page before starting. Rehearse it end to end on a
copy of real data before it is run for real; nothing here has been run against production.

Principles: reversible things first, irreversible things last and only after verification; every step
has an owner, a command, an expected output and a restore path; every risky feature is behind a kill
switch (inventory below) that Ally can flip without a deploy.

Placeholders: `<OWNER-...>` is a named person to fill in before the rehearsal. `<DATE>` is a date to
fill in. Nothing in angle brackets is decided yet.

## 0. Release order

1. **ally-be first**, tag `be-v<x.y.z>` (workflow `production-release-ally-be.yaml`). The migrations run
   as the one-shot migrate before the swap. All new behaviour ships dark or tolerant (see section 7).
2. **Dashboards second**, after the backend is healthy. Both dashboards ship from one workflow,
   `production-release-frontends.yaml`, with one shared tag `frontend-v<x.y.z>`. The workspace
   `CLAUDE.md` still says `admin-v*` / `helpline-v*`: the workflow file is the truth, check it on the day.
3. ally-ai and ally-ai-learn only if their diffs changed (`ai-v*`, `learn-v*`).
4. Master is not live until tagged. The mobile app has no assistants code and is not part of this.
5. A deploy drops requests for a short window; do it outside the busy hours and after the announcement.
6. Never release the dashboard before the backend: the new screens call routes that do not exist yet.

## 1. Kill-switch inventory

All defaults are "on" unless a row says otherwise. Env switches accept `false`, `0` or `off` to turn
off, are read per call (no restart needed for the ones read through `ConfigService`, but ECS env
changes need a task restart in production, so prefer the global setting where one exists).

| Switch                                                                                                                                    | Default                                                            | What it does when OFF                                                                                                                                                                                      | Where checked                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `global_settings` row `assistant_credits`, `enforcement`                                                                                  | OFF in production when the row is missing, ON locally              | Pre-credits limits apply exactly (plans, seats, spend cap); spend is still recorded                                                                                                                        | `LedgerService.switches()` (`src/billing/service/ledger.service.ts`), read by `limits.service.ts`, `credits-state.service.ts` |
| `assistant_credits`, `warningEmails`                                                                                                      | same as above                                                      | 50/80/95% credit warning emails stop                                                                                                                                                                       | `credit-warning.service.ts` via `ledger.switches()`                                                                           |
| `ASSISTANT_CREDITS_BLOCK_ON_FEED_OFF`                                                                                                     | `true` in production, `false` otherwise (unset follows `NODE_ENV`) | A stopped usage feed no longer blocks new spend: work goes ahead with its cost unrecorded, and one warning an hour is logged. Paused work: `POST /v1/staff/billing/credits/resume-paused` (`manage_costs`) | `LedgerService.feedBlocksSpend()` (`src/billing/service/ledger.service.ts`)                                                   |
| `ASSISTANT_ALERT_SENDING_ENABLED`                                                                                                         | on                                                                 | Outbox drain and email/WhatsApp/Slack alert sending stop; rows wait                                                                                                                                        | `crisis-alert.service.ts`                                                                                                     |
| `ASSISTANT_CRISIS_JOB_ENABLED`                                                                                                            | on                                                                 | One-minute job stops: holding and "no one is available" messages, untaken-flag timer                                                                                                                       | `crisis-alert.service.ts`                                                                                                     |
| `ASSISTANT_CRISIS_BACKFILL_ENABLED`                                                                                                       | on                                                                 | Hourly crisis flag backfill stops                                                                                                                                                                          | `crisis-backfill.service.ts`                                                                                                  |
| `ASSISTANT_CRISIS_BACKFILL_DRY_RUN`                                                                                                       | unset                                                              | `true` makes the hourly backfill count and write nothing                                                                                                                                                   | `crisis-backfill.service.ts`                                                                                                  |
| `ASSISTANT_RETENTION_SWEEP_ENABLED`                                                                                                       | on                                                                 | Retention sweep refuses to run (also blocked until the crisis backfill is done)                                                                                                                            | `assistant-retention.service.ts`, `whatsapp-retention.service.ts`                                                             |
| `ASSISTANT_MEMORY_CUTOVER_ENABLED`                                                                                                        | on                                                                 | Memory deletion refuses (a dry run still counts)                                                                                                                                                           | `memory-consent.service.ts`                                                                                                   |
| `ASSISTANT_UNPUBLISH_BACKFILL_ENABLED`                                                                                                    | on                                                                 | The D10 backfill is skipped (even a dry run returns `skipped`)                                                                                                                                             | `go-live-backfill.service.ts`                                                                                                 |
| `ASSISTANT_GO_LIVE_GATE_ENABLED`                                                                                                          | on                                                                 | Go-live gate stops being enforced on publish, status change and page toggle (checklist still reads)                                                                                                        | `go-live-gate.service.ts`                                                                                                     |
| `ASSISTANT_KNOWLEDGE_PII_REVIEW_ENABLED`                                                                                                  | on                                                                 | Uploads are no longer held for personal-data review                                                                                                                                                        | `knowledge-review.service.ts`                                                                                                 |
| `ASSISTANT_GLOBAL_QUICK_REPLY_FALLBACK`                                                                                                   | unset                                                              | `true` makes builders resolve the old global quick replies again (rollback for the per-chatbot copies)                                                                                                     | `chatbot-reply.service.ts`                                                                                                    |
| `STAFF_DENY_GUARD_ENABLED`                                                                                                                | on                                                                 | Staff deny guard on platform routes stops                                                                                                                                                                  | `staff-only.guard.ts`                                                                                                         |
| `RESPONDER_AGREEMENT_ENFORCED`                                                                                                            | on                                                                 | Server no longer requires the responder agreement before take-over, reply or read                                                                                                                          | `responder-agreement.service.ts`                                                                                              |
| `ASSISTANT_STAFF_VIEW_ENABLED`                                                                                                            | on                                                                 | Ally staff's read-only view of any chatbot stops: staff reads answer 404 (owners' grants are kept)                                                                                                         | `chatbot-staff-access.service.ts`                                                                                             |
| `ASSISTANT_PACK_RELEASES_ENABLED`                                                                                                         | on                                                                 | Safety packs are served from the code constants again, not their current release (the cache is cleared)                                                                                                    | `safety-pack-release.service.ts`, `packFor()` in `safety-packs.ts`                                                            |
| `ASSISTANT_MONITOR_ENABLED`                                                                                                               | on                                                                 | All monitoring checks stop                                                                                                                                                                                 | `assistants-monitoring.service.ts`                                                                                            |
| `ASSISTANT_MONITOR_LEDGER_ENABLED`, `_OUTBOX_`, `_UNTAKEN_`, `_COST_RECORDS_`, `_UNPRICED_`, `_FEED_`, `_RETENTION_` (each `..._ENABLED`) | on                                                                 | That one check stops                                                                                                                                                                                       | `assistants-monitoring.service.ts`                                                                                            |
| `ASSISTANT_MONITOR_OUTBOX_MINUTES` (15), `_RETENTION_MAX_ROWS` (100000), `_COOLDOWN_MINUTES` (60)                                         | numbers                                                            | Thresholds, not switches                                                                                                                                                                                   | `assistants-monitoring.service.ts`                                                                                            |

Other `ASSISTANT_*` names in the source (`ASSISTANT_OWNER`, `ASSISTANT_MEMBER`, `ASSISTANT_SCOPE_KEY`,
`ASSISTANT_SPIKE`, `*_PERMISSIONS`) are role, scope and enum constants, not environment variables.

Setting the credits switch (no endpoint exists for it; use the database, with a snapshot taken):

```sql
-- on: enforcement and warning emails
INSERT INTO global_settings (name, value, "createdBy", "updatedBy")
VALUES ('assistant_credits', '{"enforcement": true, "warningEmails": true}', 0, 0)
ON CONFLICT DO NOTHING;
UPDATE global_settings SET value = '{"enforcement": true, "warningEmails": true}', "updatedAt" = now()
 WHERE name = 'assistant_credits';
-- off again (restore path): set both to false. Takes effect within 30 seconds (cache).
```

(`global_settings.name` may not be unique: use the UPDATE when the row exists.)

## 2. The release risk: "responder agreement enforced"

`RESPONDER_AGREEMENT_ENFORCED` defaults to **on**. The backend then refuses a take-over, a reply and
(for responder-only members) a read until the person has accepted the current agreement, answering 403
with `errorCode: responder_agreement_required`. The accept screen lives in the dashboard. If the backend is
released and the dashboard is not yet live, every responder is locked out of replying in the window
between the two releases, and a crisis flag nobody can take over is exactly the failure to avoid.

Mitigation, in order: (1) set `RESPONDER_AGREEMENT_ENFORCED=false` on the backend release, (2) release the
dashboard, (3) verify a test responder can accept and then reply, (4) remove the override so enforcement
is on. Restore path for any later lockout is step (1) again. Owner: `<OWNER-RELEASE>`.

## 3. Cutover steps

Run in this order. Do not skip ahead. Every dry run is safe to repeat. `<ENV>` is the production shell
with the production environment (or the rehearsal copy during the rehearsal).

Run all dry runs at once with the orchestrator (read only, applies nothing, prints one combined report):

```
npx ts-node -r tsconfig-paths/register src/database/scripts/assistants-cutover-dry-run.ts
```

It opens connections read-only (`default_transaction_read_only=on`), forces the sending, crisis job,
backfill, retention, memory and monitor switches off for that process, and stops scheduled jobs. It exits
2 when a step failed or reported that it applied something. The per-step commands below are what each
step runs, for the real run.

### Step 1. Announce

- Owner: `<OWNER-COMMS>`. Command: none. Output: message sent to builders and staff naming the date,
  that conversations from before the cutover lose stored memory (D7), that live chatbots are paused until
  the owner completes the go-live checklist (D10), and that old messages are blanked after 90 days (D11).
- Restore: not applicable; send a correction.

### Step 2. Release the backend and run migrations (section 4)

- Owner: `<OWNER-RELEASE>`. Command: tag `be-v<x.y.z>`; the workflow runs migrations before the swap.
  Responder agreement override per section 2. Expected: health OK, `migrations` table has every id in
  section 4, all new features dark (credits enforcement off in production, no backfill run yet).
- Restore: roll the task definition back to the previous image. The schema is additive and the old code
  keeps working on it (old columns are still written). Do not run `migration:revert` in production.

### Step 3. Database snapshot

- Owner: `<OWNER-DB>`. Command: an RDS snapshot named `pre-assistants-cutover-<DATE>`, taken **after** the
  migrations and **before** any grant or irreversible step, so it holds the final schema and the old data.
  Expected: snapshot status `available`.
- Lifetime: keep until `<DELETE-BY-DATE>` (decide before the rehearsal; the plan says 90 days to cover
  the retention window, D11). Delete on that date; record the deletion in the notes file. The snapshot
  holds customer messages the sweep will erase, so it is itself personal data and must not outlive that date.
- Restore path for the whole cutover: restore the snapshot to a new instance, point a copy at it, and
  copy the needed rows back; a restore of the live instance loses everything written since.
  Decide this with `<OWNER-DB>` before the rehearsal.

### Step 4. Grant credits (billing cutover), dry run first

- Owner: `<OWNER-BILLING>`.
- Dry run: `POST /v1/admin/billing/credits/cutover` body `{"dryRun": true}` (the default when omitted).
  Expected: report listing every builder as `would` (starting credits per `CREDITS.STARTING_CREDITS_MICROS`,
  currently $20.00) and each live chatbot as `would` or `skipped` (budget `STARTING_BUDGET_MICROS`, $2.00).
  Both numbers are safe defaults still waiting for sign-off: change them in
  `src/billing/constants/credits.constants.ts` before the real run.
- Real run: the same call with `{"dryRun": false}`. Idempotent (a builder's grant carries
  `cutover:credits:<userId>`). Expected: `buildersGranted`, `budgetsSet` match the dry run.
- Restore: staff adjustments (`POST /v1/admin/billing/credits/grants`, kind `adjustment`) reverse a
  grant; or restore the snapshot. Enforcement is still off, so nothing is blocked yet.

### Step 5. Dry-run reports

All read only. Owner: `<OWNER-DATA>`. Read each result with a second person.

| Report               | Command                                                                                                                           | Expected output                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Crisis flag backfill | set `ASSISTANT_CRISIS_BACKFILL_DRY_RUN=true`, wait for the hourly tick, read `[CRISIS-BACKFILL]` in logs; or run the orchestrator | `scanned`, `matched`, `updated: 0`                                  |
| Retention report     | `GET /v1/staff/retention/report` or `npx ts-node -r tsconfig-paths/register src/database/scripts/assistants-retention-report.ts`  | counts per store, `blocked: crisis_backfill_not_done` until step 7a |
| Stage 5 migration    | `npx ts-node -r tsconfig-paths/register src/database/scripts/assistants-stage5-migrate.ts --dry-run`                              | JSON report; exit 2 lists chatbots with no owner, fix those first   |
| Unpublish backfill   | `POST /v1/staff/assistants/unpublish-backfill` (dry run is the default)                                                           | `paused` list of live chatbots that fail the gate                   |
| Memory cutover       | `POST /v1/staff/memory-cutover` body `{"dryRun": true}`                                                                           | `entries`, `summaries` counts                                       |
| Credits cutover      | step 4 dry run                                                                                                                    | see step 4                                                          |

Compare the counts with what the announcement promised. A count that is far larger or smaller than
expected stops the cutover until explained. Set `ASSISTANT_MONITOR_RETENTION_MAX_ROWS` from the
retention report so the monitor's range matches reality.

### Step 6. Switch each feature on through its kill switch

One at a time, verifying after each (section 5). Owner: `<OWNER-RELEASE>`.

| Order | Feature                                             | Command                                                                                                             | Restore                                                                                                                        |
| ----- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 6a    | Alert sending and crisis job                        | already on by default; confirm `ASSISTANT_ALERT_SENDING_ENABLED` and `ASSISTANT_CRISIS_JOB_ENABLED` are not `false` | set to `false` (alerts wait in the outbox, nothing is lost)                                                                    |
| 6b    | Monitoring                                          | confirm the `ASSISTANT_MONITOR_*` switches are on; a test breach posts to staff Slack                               | `ASSISTANT_MONITOR_ENABLED=false`                                                                                              |
| 6c    | Stage 5 migration (idempotent, reversible per step) | `assistants-stage5-migrate.ts` (without `--dry-run`)                                                                | per-step rollback in `src/chatbot/privacy/stage5-migration.ts`; `ASSISTANT_GLOBAL_QUICK_REPLY_FALLBACK=true` for quick replies |
| 6d    | Crisis flag backfill                                | leave `ASSISTANT_CRISIS_BACKFILL_ENABLED` on; unset the dry-run flag; the hourly job resumes from its cursor        | switch off; it only writes flag fields, never alerts                                                                           |
| 6e    | Credit enforcement                                  | set `assistant_credits.enforcement` to true (section 1 SQL)                                                         | set to false                                                                                                                   |
| 6f    | Access lists                                        | per chatbot by owners after release; every list starts empty (R7)                                                   | no global switch: pause the chatbot or remove entries                                                                          |
| 6g    | Go-live gate                                        | on by default                                                                                                       | `ASSISTANT_GO_LIVE_GATE_ENABLED=false`                                                                                         |

### Step 7. Verify (section 5), then only then the irreversible steps

Irreversible steps each need: dry run repeated within the last hour, the monitor quiet, a second person's
sign-off in the notes file, and the snapshot of step 3 confirmed `available`. Owner: `<OWNER-DATA>`.

| Step                         | Command                                                                                                  | Expected                                                                       | Restore                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 7a. Crisis backfill finishes | wait for `global_settings` `crisis_flag_backfill.doneAt`                                                 | set                                                                            | none needed; it is a prerequisite of 7c                                                                                                |
| 7b. Memory delete (D7)       | `POST /v1/staff/memory-cutover` body `{"dryRun": false}`                                                 | `entries` and `summaries` equal the last dry run; a second run deletes nothing | **snapshot only** (rows are deleted)                                                                                                   |
| 7c. Retention sweep (D11)    | `assistants-retention-report.ts --apply`, then the daily WhatsApp retention task runs it on its schedule | per-store counts equal the last dry run; flagged conversations kept            | **snapshot only**; keep it until `<DELETE-BY-DATE>`                                                                                    |
| 7d. Unpublish backfill (D10) | `POST /v1/staff/assistants/unpublish-backfill?dryRun=false`                                              | `paused` equals the last dry run                                               | not destructive: each owner goes live again through the gate, which clears the pause; or set the chatbots back to `live` and record it |

Run 7b before 7c is not required, but run 7d last: it is the change customers see.

## 4. Migrations in this release (ids 1986540000000 to 1987600999999 present in `src/database/migrations`)

All additive (expand step). Run by the release workflow, not by hand.

- `1986540000000-ChatbotMemberRoleSets`: `chatbot_members.roles text[]`, backfilled from the old `role`, kept in step by a trigger.
- `1986540000100-CreateChatbotInvitesAndAssistantMember`: invites table and the `ASSISTANT_MEMBER` login role.
- `1986540000200-CreateResponderAgreements`: one row per person and agreement version.
- `1986600000000-AddCrisisFlagsAndAlertOutbox`: crisis flag columns on `chatbot_conversations`, the `crisis` needs-a-person reason, the `alert_outbox` table.
- `1986700000000-CreateCreditsLedger`: billing accounts, grants, chatbot budgets, reservations, end persons, per-person spend, and five nullable columns on `usage_events`.
- `1986800000000-WorkingCopyBlankChatbotsTemplates`: `bot_drafts` becomes the working copy (`live_at` and related), blank chatbots, templates.
- `1986900000000-AssistantsCustomerDataKnowledgeSharing`: `memory_consents`, knowledge review and curated columns, sharing.
- `1987000000000-CreateChatbotSafetyState`: terms accepted, per-language crisis results, gate pause record.
- `1987100000000-CreateChatbotStaffAccess`: owner-granted staff read access and the staff view log.
- `1987200000000-AddOverviewDailyStats`: `people` and `handover_wait_p50` on the overview rollup.

`ls src/database/migrations | grep -E '^198(65|66|67|68|69|70|71|72)'` must show exactly these before tagging.
No migration was added by stage 10 itself.

## 5. Verification (after each step 6 and before step 7)

Owner: `<OWNER-QA>`. Expected results in brackets.

1. Health: `/api/health` ok; no `[METRIC] assistants_*` breach lines in the last 15 minutes.
2. Ledger: every account's free balance is zero or more and equals grants minus set-aside minus spend
   minus reserved [the monitor's `ledger` check reports balanced].
3. A test customer message on a funded chatbot is answered and writes a usage event with a payer and a
   charge; on an unfunded chatbot it shows the fixed crisis notification and no model call.
4. A keyword crisis message on a blocked chatbot flags the conversation and queues the builder alert
   (R1); the alert arrives; an untaken flag raises the staff Slack message after the limit.
5. A responder who accepted the agreement can take over and reply (section 2).
6. A live chatbot that fails the gate is listed by the unpublish dry run and nothing else changed.
7. Playwright and accessibility runs, and screenshots at 1440x900, 1280x720 and a phone width for
   Conversations and Overview, are run by the dashboard owner against the released build.

## 6. Monitoring (what pages whom)

`AssistantsMonitoringService` (`src/chatbot/safety/assistants-monitoring.service.ts`) runs every five
minutes under the scheduler's advisory lock. A breach logs `[METRIC] assistants_<check> breach ...` and posts
one staff Slack message per check per cooldown. Checks: `ledger` (reconciliation, never negative),
`outbox` (failed or stuck alerts older than N minutes), `untaken` (a flag past the limit with no alert
raised; the alert itself comes from `CrisisAlertService`, which logs `[METRIC] crisis_flag_untaken`),
`cost_records` (events with no charge or payer in the last day), `unpriced` (models with no price),
`feed` (usage feed outage), `retention` (last sweep counts above the maximum). Owner: `<OWNER-ONCALL>`.
Slack posting needs the existing Slack bot token and channel to be configured in production.

## 7. Contract steps for a later release

Only after the cutover has been stable for `<N>` weeks and the old code is no longer deployable. Each is a
new migration, with the snapshot of that day, and the code that reads or writes the thing removed first.

- Drop `chatbot_members.role` and its trigger (everything reads `roles`).
- Drop the seat tables (`seats`, `seat_types`) and subscriptions' seat references, and the code that
  counts seats (`1985400000200-CreatePlansAndSeats`).
- Drop the old plan fields and tables (`plans`, subscriptions, plan limits) and the spend-cap table
  (`1985400000300-AddSpendCap`), once credits enforcement has been on and the pre-credits fallback is
  no longer wanted. Removing them removes the credits "off" restore path.
- Drop `chatbots`-level columns that the working copy replaced, and `safety_at` once `safety_first_at`
  is the only reader.
- Remove `ASSISTANT_GLOBAL_QUICK_REPLY_FALLBACK` and the global quick reply resolution.
- Remove the `RESPONDER_AGREEMENT_ENFORCED` override.
