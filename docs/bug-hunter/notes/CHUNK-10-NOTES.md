# Chunk 10 notes: modes, reported bugs, and the board

Status: **built and tested offline** (2026-11-16). The paid end-to-end check (one
reported bug, ~$0.60) waits for the user's go.

## Decisions (user, 2026-11-16)

- Three modes, as in v1: **off | manual | autonomous** (v1 calls the last one "AI").
- Autonomous: **10 runs a day** at most, plus the $15/day cap.
- Anyone's reported bug (a roadmap item of type "bug") lands in v2 and, in autonomous
  mode, starts by itself.
- Board tabs as in v1: **Needs you, Failed, In progress, Backlog, Done**.
- Rule 8 is unchanged in every mode: suggested fixes until the holdout milestone.

## How it works

```
roadmap "bug" filed ─┐
daily job (signals) ─┴─> bughunter.bugs (backlog) ── worker, by mode ──> run ──> report
                              ▲  Start fix / Retry (admin)          needs_you | failed | done
```

- **Modes:** `bughunter.settings` (a single row, off by default). The worker picks:
  queued bugs in manual and autonomous mode, then backlog bugs in autonomous only. The
  daily job collects nothing when the mode is off. `bug-hunter pause` stops the worker
  in any mode.
- **Caps** (in the worker): `daily_run_limit` (10) runs started since midnight IST, and
  the $15/day ledger. When a cap is hit, the waiting bugs get a reason ("waiting: daily
  run limit (10) reached") and start the next day.
- **Outcomes:** suggested fix, escalation, rejected → **needs_you**; no bug and
  duplicate → **done**; a failed or stopped run → **failed** with the reason. A verdict
  in the dashboard moves needs_you → done in the same transaction.
- **Reported bugs:** `RoadmapOpportunityService.create` (type bug) calls
  `BugHunterBoardService.enqueueReported`. It is best effort and never fails the filing,
  and it does nothing until the `bughunter` schema exists. The app comes from v1's repo
  classifier when that names one of the five apps; otherwise the board asks for one at
  Start fix, and the worker never guesses. The reporter's text runs as an issue-mode
  signal (`reported_by: user`) and goes through the PHI scrubber like every signal.
- **The backfill:** reports filed before the queue got a board row (judged → done,
  waiting → needs_you), with no `started_at`, so they don't count against today's run
  limit.

## v1's history on the board (user, 2026-11-16)

Management reports need the history end to end, so the board shows the old Bug
Hunter's findings too. They are **read live, not copied**: `BOARD_ROWS_SQL` in
`bug-hunter-board.service.ts` is a `UNION ALL` of `bughunter.bugs` and
`public.bug_findings`, run by ally-be (which can read both; the agent's `bughunter`
role still cannot read `public`). Nothing goes stale while v1 keeps running, and there
is no sync job.

- v1's 17 statuses map onto the tabs exactly as v1's board does (`V1_STATUS_TAB`,
  mirroring `lifecycleBucket.ts`). One gap: v1 lifts a `coordinating` plan with an
  attention flag into Needs you; that flag is computed per request, so here it stays
  In progress.
- v1's plan steps (`parent_finding_id`) are left out, as v1's own reports do.
- A bug reported after v2 was set up exists on both sides; the v1 copy is dropped so
  it counts once.
- A v1 row shows v1's status and source labels and a "v1" tag, opens read-only inside v2
  (`/bug-hunter-v2/v1/<id>`: description, evidence, outcome, PR, release, history from
  `bug_hunt_events`), and has no Start fix: v2's worker never touches it.

## Code map

| Where | What |
|---|---|
| `bug-hunter/migrations/0008_bugs_and_settings.sql` | `settings`, `bugs`, the dashboard grants, the backfill |
| `bug-hunter/src/bug_hunter/queue/store.py` | `Bug`, `Settings`, in-memory and Postgres stores, `claimable`, `board_status`; `claim` uses `FOR UPDATE SKIP LOCKED` |
| `bug-hunter/src/bug_hunter/queue/worker.py` | `work_once` (mode, pause, caps, claim, run, report, finish), `work_loop` |
| `bug-hunter/src/bug_hunter/signals/dispatcher.py` | `run_daily(queue=…)`: a live daily run queues instead of running |
| `bug-hunter/src/bug_hunter/cli.py` | `bug-hunter mode [off\|manual\|autonomous]`, `bug-hunter worker [--once]`; `daily --live` now queues |
| `ally-be/src/bug-hunter-approvals/service/bug-hunter-board.service.ts` | settings, mode (audited), board list and counts, start/retry (audited), `enqueueReported` |
| `ally-be/src/bug-hunter-approvals/controller/…` | `GET settings`, `PUT settings/mode`, `GET bugs?tab=`, `POST bugs/:id/start` |
| `ally-be/src/product-roadmap/…` | The hook in `create` (optional dependency) and the module import |
| `ally-web/apps/ally-admin-dashboard/src/pages/BugHunterV2/BugHunterV2Board.tsx` | Mode switch (asks before autonomous), tabs, table, Start fix / Retry with an app picker; it refreshes every 15 s |

## Tests

- **bug-hunter:** `tests/test_queue_worker.py` (18): each mode, pause, the run limit
  and its IST midnight reset, the spend cap, every outcome, a run that raises then a
  retry, a missing app, a reported bug in issue mode, the daily job queueing, the loop.
  The Postgres integration tests now delete what they write. They had left test
  reports, verdicts and spend rows in the developer's database, which I removed.
- **ally-be:** `bug-hunter-board.spec.ts`: the tabs and counts, the audited mode change,
  start/retry, refusals (running, done, unknown), the app picker, the hook (once only,
  unknown app, no schema, never throws), DTO validation. The access test covers all 9
  routes. A verdict closes the bug.
- **ally-web:** the board's tab order and counts, the default tab, the mode switch with
  its autonomous confirmation, Start fix / Retry, the app picker, 503.

## Run it locally

```bash
cd bug-hunter
poetry run bug-hunter db migrate            # 0008
poetry run bug-hunter mode manual           # or set it on the page
poetry run bug-hunter worker                # runs queued bugs (paid, ~$0.50-0.80 each)
```

## Not done / open

- **The paid end-to-end check** (one reported bug, ~$0.60): waits for the user's go.
- **Live step ("investigating", "reproducing") on In progress:** `run_graph` has no hook.
  The board shows "running since". It needs a streaming run, later.
- **Where the worker runs in production:** with the daily job, on the Hetzner runner
  (deploy is postponed by the user).
- **v1 still creates its own finding** for every reported bug. Switch v1 to Off when v2
  takes over, or both work on the same bug.
