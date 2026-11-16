# Chunk 09 notes: verdicts in the admin dashboard

Status: **built and tested locally** (2026-11-16). It waits on infra for production
(the `bughunter` schema set up in ally-be's database, and ally-be's role added to
`bughunter_dashboard`; see CHUNK-08-NOTES).

## Decisions (user, 2026-11-16)

- **Adapted to suggested-fix mode.** The dashboard shows each suggested fix or
  escalation with its finding, repro test and patch. Admins give the two-part verdict
  (diagnosis `correct | wrong | not_a_bug`, fix `worked | needed_edits | wrong | none`)
  plus a reason, written to the existing `bughunter.verdicts` table. Approve and reject
  for PRs stay in the design (routes exist) but answer 403 `PR_MODE_OFF` until pr mode.
- **Access:** `PLATFORM_ADMIN` plus a new feature toggle, `BUG_HUNTER_V2_VERDICTS`
  (`bug_hunter_v2_verdicts`), through `@RequireFeatureToggle`, the current convention.
  `SUPER_DUPER_ADMIN` is deprecated on master ("kept, unreferenced by new code"). The
  toggle is platform-only, has no backfill, and is granted per admin from Admin User
  Management.
- **Verdicts can be amended.** A new verdict becomes the active one. The old row is
  kept with `superseded_by` and `superseded_at` (who decided each, and when, stays on
  each row), and an audit entry is written for both new and amended verdicts. The
  feedback job retracts the memory records created from a superseded verdict before it
  applies the new one: every memory record stores `source_verdicts`.
- **Naming:** everything new in ally-be is `bug-hunter-approvals`; in the dashboard it is
  `BugHunterV2` / `/bug-hunter-v2`. The old `src/bug-hunter` module and its pages are
  untouched.

## Code map

| Where | What |
|---|---|
| `bug-hunter/migrations/0006_verdict_amend_and_report_details.sql` | Verdicts: `report_id`, `superseded_by/at`, `retracted_at`, one active verdict per report (partial unique index). Reports: `finding`, `root_cause`, `repro`, `patch_diff`, `review`, `confidence`, `risk_level`, `stop_reason`, `severity` |
| `bug-hunter/migrations/0007_dashboard_role_grants.sql` | Grants for `bughunter_dashboard` (no-op without the role) |
| `bug-hunter/db/ally-db-setup.sql`, `make ally-db-setup` | (2026-11-16) The agent's role and schema inside ally-be's database; `tests/integration/test_ally_db_isolation.py` |
| `bug-hunter/src/bug_hunter/memory/verdicts.py` | `add` supersedes the active verdict for the same report (or run); `superseded_by`, `mark_retracted` |
| `bug-hunter/src/bug_hunter/memory/feedback.py` | Records carry `source_verdicts`; `retract_verdict` (created records deleted, shared ones decremented, run stats reversed); `run_feedback` retracts predecessors first; human-only reports take a verdict without a run |
| `bug-hunter/src/bug_hunter/signals/runner.py` | `details_from_state`: the dashboard fields from a run's state and artefacts |
| `bug-hunter/deploy/bug-hunter-poll.service` | Also runs `bug-hunter feedback`, so verdicts reach memory within 15 minutes |
| `ally-be/src/bug-hunter-approvals/` | Module, controller (`GET reports`, `GET reports/:id`, `POST reports/:id/verdict`, approve/reject off), service (raw parameterised SQL), `BughunterDbService` (ally-be's own `DataSource`; 503 until the `bughunter` schema exists), DTOs |
| `ally-be/src/authorization/constants/admin-feature-toggle.constants.ts` | The toggle key and registry entry |
| `ally-be/src/audit/constants/audit-event.constants.ts` | `BUG_HUNTER_V2_VERDICT_RECORDED`, `BUG_HUNTER_V2_VERDICT_AMENDED` |
| `ally-be/src/builder/constants/builder-capabilities.constants.ts` | A capability line for the new module (its spec requires one per module) |
| `ally-web/apps/ally-admin-dashboard/src/pages/BugHunterV2/` | List (open / judged / all), detail (finding, evidence, root cause, failing test with source and failure, unified diff, reviewer, stop reason, verdict history), verdict form (two radio groups with help tooltips, required reason; fix locked to "No fix" without a patch; not-a-bug cannot pair with worked or needed edits) |
| `…/api/bugHunterV2.ts`, `types/bugHunterV2.ts`, constants, `routes/RouteLayout.tsx`, `utils/navigation.ts`, sidebar | RTK Query slice; `/bug-hunter-v2` and `/bug-hunter-v2/:id` behind `requiredFeature`; sidebar entry gated by the toggle |

Why there are no entities: ally-be's entity glob
(`dist/*/entity/*.entity.js`) would otherwise treat the bughunter tables as ally-be's own
and the migration generator would try to create them. The schema is owned by
`bug-hunter/migrations/`.

## Tests

- **bug-hunter (pytest):**
  - `tests/test_verdict_amend.py`: amending "not_a_bug" to "correct" removes the false
    alarm from recall; only the old verdict's share is retracted; a chain of amendments;
    a human-only report.
  - Postgres integration for supersession and the JSON report columns.
- **ally-be (jest, `src/bug-hunter-approvals/test`):**
  - 403 without the toggle on all five routes (real `FeatureToggleGuard`, route
    metadata);
  - 400 for a blank reason, unknown values, a fix verdict without a patch, and not a
    bug with worked;
  - 409 on a concurrent insert;
  - amendment keeps and links the old row, with an audit entry for recorded and
    amended verdicts;
  - 503 when not configured;
  - PR routes off.
- **ally-web (vitest):**
  - sidebar shown only with the toggle (and not with the old Bug Hunter's);
  - both routes gated on the toggle;
  - list filters call the right query;
  - 503 shows the "not connected" message;
  - detail renders the failing test and patch;
  - reason required;
  - verdict posts the trimmed body to the report's endpoint;
  - no-patch locks fix to "No fix";
  - amend wording.
- **Local end-to-end:** reports seeded from real run artefacts
  (memory-check run 43622436211) into the local bughunter database; ally-be's real
  service read them; the dashboard rendered them. Auth was stubbed in the browser for
  the screenshots.

## Not done / open

- **Infra (CHUNK-08-NOTES):** run `db/ally-db-setup.sql` in ally-be's database and
  grant `bughunter_dashboard` to ally-be's login role.
- **The verdict history shows the decider as `admin #<id>`.** Resolving names would
  need a lookup in ally-be's users table, which the dashboard role must not read; the
  dashboard could map ids it already knows.
- **pr mode (later):** approve/reject implementations, the poll picking up approval
  decisions, and the branch-protection settings below.

## Branch protection for pr mode (for a person to apply later, not now)

- `master` keeps "Require status checks to pass" with every `test-*` check and "Require
  branches to be up to date".
- A ruleset for `bughunter/*` branches: only the Bug Hunter GitHub App may push.
- PRs from the App to `master` may merge with 0 GitHub reviews, because the human
  approval happens in this dashboard. Every other PR keeps its review rule. With
  rulesets, use a bypass for the App on the "required reviews" rule only, never on
  status checks.
- Auto-merge enabled on the repository. The bug hunter enables it per PR after an
  approval (`pr.auto_merge`, off until then).
- Never for security, auth, tenant or data-exposure findings (CONTEXT.md rule 8 and
  CHUNK-08-NOTES).

## Change 2026-11-16: same database as ally-be

The user chose ally-be's database over a separate `bughunter` database, as the old
Bug Hunter does. The tables were already in their own `bughunter` schema, so the
change only moves where that schema lives:
- bug-hunter: every connection goes through `checkpointer.connect`, which pins
  `search_path=bughunter`. Before this, the store's tables landed in `bughunter` only
  because the role was named `bughunter`. The migrations create the schema only when
  it's missing, because the agent's role has no CREATE on ally-be's database. The
  default URL is the local ally-be Postgres (`localhost:5477/ally_local`).
- ally-be: the second `DataSource` and the `BUGHUNTER_DB_*` settings are gone.
  `BughunterDbService` returns ally-be's own connection once `bughunter.reports`
  exists, and answers 503 before that.
- Local data: copied from the old bughunter-pg container (all tables except the
  pgvector index, which ally-be's Postgres lacks); row counts matched. bughunter-pg
  and its volume are untouched.
