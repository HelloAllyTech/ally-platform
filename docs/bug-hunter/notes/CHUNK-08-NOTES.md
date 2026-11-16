# Chunk 08 notes: signals and schedule

Status: **everything that does not need the VM is done** (2026-11-16). What is left
waits on infra (below). Chunk 09 starts in parallel.

## Decisions (user, 2026-11-14/15)

- **Where daily runs live:** `bug-hunter daily` as a scheduled service (systemd timer)
  on a VM on Ally's private network, next to the bughunter database. It is not GitHub
  Actions. A self-hosted runner is only the fallback. Done when
  `bug-hunter daily --dry-run` runs on the VM.
- **Nothing about findings goes to the public repo** (ally-platform is public): no
  escalation or suggested-fix issues, no comments, no logs, no artifacts. Reports go
  to the bughunter database and to issues in the private repo
  `HelloAllyTech/bug-hunter-reports` (to be created); the feedback reader points there.
- **pr mode, later:** findings in the security, auth, tenant or data-exposure
  categories never become public PRs.
- **Issue signals** only come from issues opened by, or labelled `bug` by, HelloAllyTech
  members. Issue text enters prompts as quoted, scrubbed data, never as instructions.
- **GitHub access:** a GitHub App with minimal permissions (read ally-platform, write
  issues in bug-hunter-reports). A fine-grained token is the fallback only if the App
  is not ready when needed.
- **Spend ledger** moves into the bughunter database.
- **New prompts** (lens ×5, falsifier, the quoted-issue wording) are shown to the user
  before they are activated.

## Evals move to the VM

The eval workflow (`.github/workflows/bug-hunter-evals.yml`) runs on GitHub-hosted
runners in the public repo, so its logs and artifacts are public. On 2026-11-15 all 51
eval artifacts (14 runs) and the logs of all 16 eval runs were deleted, and artifact
retention was set to 1 day. **Once the VM exists, evals move there and the evals
workflow is removed from master** (and from the branch).

## Built so far (offline, fixture tests)

| Path | What |
|---|---|
| `src/bug_hunter/spend.py` | Ledger backends: file (default) or `bughunter.spend` (`BUGHUNTER_SPEND_BACKEND=db`, migration 0003); `record(at=…)` |
| `src/bug_hunter/signals/base.py` | `Candidate`, source priority (CI, issues, logs, sweep) |
| `src/bug_hunter/signals/state.py` | Cursors and the kill switch in `bughunter.signal_state` (migration 0004); `bug-hunter pause` / `unpause` (`resume` already resumes a paused run) |
| `src/bug_hunter/signals/github.py`, `clients.py` | Read-only GitHub interface plus the HTTP reader (token from `BUGHUNTER_GITHUB_TOKEN`: the App's installation token on the VM), CloudWatch Logs Insights (boto3, VM only), git callables |
| `src/bug_hunter/signals/ci_failures.py` | Failed `test-ally-*.yml` runs on master, one per workflow and commit, failing test names (Jest, Vitest, pytest, Flutter), scrubbed excerpt |
| `src/bug_hunter/signals/issues.py` | `bug` label plus an org member as author or labeller (label event actor), scrubbed, app from an `app:` label or words; nothing posted back |
| `src/bug_hunter/signals/error_logs.py` | Signature grouping, app-frame filter, new or spiking against a 7-day baseline, scrubbed example only |
| `src/bug_hunter/signals/commit_sweep.py` | Commits since the last SHA per app; lens and falsifier interfaces (no model calls until the prompts are approved) |
| `src/bug_hunter/signals/dispatcher.py` | Dedupe (batch plus already reported), rollout apps, priority, caps (runs per day, $15 ledger), kill switch, one failing source never stops the others, plan JSON and markdown, private reports |
| `src/bug_hunter/reports/store.py` | `bughunter.reports` (migration 0005); `PrivateReportsRepo` refuses ally-platform and any non-private repo before posting |
| `cli.py` | `bug-hunter daily` (dry run by default; `--live` refused until after the review), `pause`, `unpause` |
| `prompts/lens_*.v1.md`, `falsifier.v1.md`, `triage.v4`, `investigate.v4`, `review.v5` | Drafts, not active; `context.quote_signals` off |

Local smoke test (2026-11-15, local Postgres): migrations 0001–0005 applied. With no
token, `bug-hunter daily` reports the GitHub sources as errors, the log source as
unconfigured, and the sweep as having nothing new, and writes the plan to
`~/.bug-hunter/daily/`.


## Added since (2026-11-15/16)

| Path | What |
|---|---|
| `prompts/lens_*.v1.md`, `falsifier.v2.md`, `triage.v4`, `investigate.v4`, `review.v5` | Active. Falsifier v2: code extracts comments within 5 lines of each cited line, and the model must quote them before "survives" (a comment stating intent means "refuted"). It also sees every commit in the sweep across apps. Commit messages explain intent, never prove it |
| `config/models.yaml` | `lens` = gpt-5-mini; `falsifier` = gemini-2.5-pro (another family) |
| `signals/sweep_models.py` | Model-backed lenses and falsifier; only lens_logic can set `safety` (the other lenses' schema has no such field); cost cap |
| `signals/commit_sweep.py` | Grouping before the falsifier (same primary file, ≥ 2 shared title words, overlap ≥ 0.3; the strongest is kept and the count reported); falsifier cap of 5 per batch (safety findings are always checked and always routed to a human) |
| `signals/sparse.py` | One reusable sparse worktree (the app folder plus root CLAUDE.md/AGENTS.md), removed at the end; stops below 1 GB free |
| `graph/llm.py` | Model calls retry connection errors up to 3 times (2, 8, 30 s); other errors fail at once |
| `signals/runner.py` | `start_run` for live runs: human-only candidates become an escalation report without a graph run; the others run the graph in issue mode at the candidate's commit (sweep, CI) or `origin/master` |
| `graph/approvals.py`, `cli.py` | `bug-hunter approvals expire` (pending approvals past 7 days) |
| `cli.py` | `daily --sources`, `--with-lenses`, `--max-cost-usd`; `--live` is still refused |
| `deploy/` | systemd units: the daily job at 03:30 IST (dry run, lenses, $3 cap, then approval expiry) and a 15-minute poll (CI failures, issues). Both run behind one `flock`, so they never overlap; secrets are in `/etc/bug-hunter/env` |
| `compose.yaml` | Local Postgres logs capped at 3 × 10 MB; restart `no` |

## First paid dry run (2026-11-16, local, $1.02, 15 min)

It swept the last 10 master commits (13 Nov): ally-web (6), ally-be (2), ally-ai (1)
and ally-mobile (2). ally-web and ally-be had no findings. ally-ai had 12: 5 were
falsified and 7 dropped by the cap, most of them sharing one "reader vs agent" rename
theme. ally-mobile had 4. Two survived, and on review both were false alarms:

- the ally-ai `progress_card` "export" is intended (a code comment next to the cited
  line says so);
- the ally-mobile "no client-side permission check" is not a client concern, and the
  security lens also marked it `[safety]` by mistake.

That led to falsifier.v2, logic-only safety and grouping. Three earlier attempts failed
at the first model call when the local network dropped ($0), which is why model calls
now retry.

## Rollout plan

1. **Dry run for 3 days on the VM:** `daily` (lenses on, `--max-cost-usd 3`) and the
   poll, without `--live`. Each day, review the plan files and `sweep-record.json` for
   false alarms, grouping and cost.
2. **ally-be only, live:** set `signals.apps: [ally-be]` and enable `--live` in the daily
   unit. Suggested-fix reports go to the private repo and the database; collect verdicts
   for a week.
3. **All apps, live:** widen `signals.apps` once ally-be's verdicts look healthy.
4. **pr mode:** only after a holdout milestone with ≥ 60% fix pass (CONTEXT.md rule 8),
   and never for security, auth, tenant or data-exposure findings.

## Old bug-hunter files to remove once v2 is trusted

The two root workflows, `bug-hunt-sweep.yml` and `bug-fix-session.yml`, are already
disabled. To remove later:

- `.github/workflows/bug-hunt-sweep.yml` and `.github/workflows/bug-fix-session.yml`,
  plus their copies in `ally-be/`, `ally-web/`, `ally-ai/` and
  `ally-ai-learn/.github/workflows/`
- `ally-be/src/bug-hunter/` (the module, constants, controllers, DTOs, entities, enums,
  repositories, about 67 service files, types and utils) and
  `ally-be/src/prompts/bug_hunter/`
- the old bug-hunter migrations in `ally-be/src/database/migrations/` (14 files). Drop
  the tables only after an export, and never while the data is still needed
- `ally-be/docs/bug-hunter-*.md`, `ally-be/evals/bug-hunter/`,
  `ally-be/scripts/bug-hunter/` and `.claude/workflows/bug-hunt.mjs`
- bug-hunter references in `ally-be/src/analytics/` and `context-library/profiles`
- the old Bug Hunter pages in `ally-web/apps/ally-admin-dashboard/src` (about 81 files),
  which chunk 09's verdict page replaces
- the repo secret `BUG_HUNTER_GH_TOKEN`, the `adminbughunterhelloallyai` account and the
  `ally-bug-hunter` app (see the incident note)

## Waiting on infra

- **The VM** on Ally's private network (about 4 vCPU, 16 GB RAM, 120 GB disk), not on
  metal01's production host, with Docker for the later graph runs and outbound access
  only.
- **The `bughunter` database** on the private network, with pgvector if possible, and
  migrations 0001–0005 applied.
- **The GitHub App** (read ally-platform; write issues in `bug-hunter-reports`), or a
  fine-grained token as the fallback; and the private repo
  `HelloAllyTech/bug-hunter-reports`.
- **Read-only CloudWatch credentials** and the `signals.log_groups` mapping.
- **The `bughunter_dashboard` role** (chunk 09) on the `bughunter` database, with its
  own password. Migration 0007 grants it read on reports, read and insert on
  verdicts, update of `superseded_by`/`superseded_at` only, and update of the approval
  decision columns only. Its credentials go into ally-be's environment
  (`BUGHUNTER_DB_*`).
- **ally-be's network path to the `bughunter` database**, so the admin dashboard's
  ally-be can reach it. The agent's own role must still have no access to ally-be's
  database.
- **Install:** the venv at `/opt/bug-hunter/venv`, the checkout at `/opt/ally-platform`,
  the units in `deploy/` and `/etc/bug-hunter/env` (root-only).
- **Then:** `bug-hunter daily --dry-run` on the VM (the chunk's "done when"), and the
  evals move there and leave GitHub Actions.

## Open (not VM)

- **CI-failure repro reuse:** a CI candidate carries the failing test names, but the
  graph still writes its own reproduction. Reusing the failing test needs its file path
  (Jest output only names the suite) and a way to bypass reproduce. To be designed
  later.
