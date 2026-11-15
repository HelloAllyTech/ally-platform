# Chunk 08 notes: signals and schedule

Status: **in progress** (started 2026-11-15). Building everything that does not need
the VM, with fixture tests.

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

## Remaining for chunk 08

- Activate the lens, falsifier and quoted-signal prompts (after review); the model-backed
  `LensRunner` and `Falsifier`.
- `start_run` for live runs (graph run per candidate, CI-failure repro reuse), approval
  expiry job.
- On the VM: systemd unit and timer (03:30 IST daily, 15-minute polls), the GitHub
  App, read-only CloudWatch credentials, `log_groups`, then 3 days of dry runs.
- The rollout plan (dry run, then ally-be only, then all apps) and the list of old
  bug-hunter files to remove.
