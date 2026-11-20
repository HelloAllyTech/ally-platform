# Chunk 08: Signals and schedule

**Read first:** `CONTEXT.md`, `spec.md` §12, §13 (run report), §15; the existing `test-*.yml` workflows (to know their names and outputs).

## Goal
The agent runs by itself: it picks up new commits, CI failures, production errors and staff/user bug reports, within daily caps, and reports what it did.

## Build
1. `signals/commit_sweep.py`: commits on `master` since the last processed SHA (stored in the store); diff neighbourhood per app; the five lens prompts (`lens_*.v1.md`); the falsifier prompt; dedupe; rank; respect `max_runs_per_day`.
2. `signals/ci_failures.py`: failed `test-*.yml` runs on `master` since last check; failing test names + scrubbed output become a signal whose repro already exists.
3. `signals/error_logs.py`: CloudWatch Logs Insights per service; group by error signature; new or spiking signatures with app-code stack frames become signals.
4. `signals/issues.py`: issues opened or labelled `bug`; the agent comments its outcome on the issue.
5. `signals/dispatcher.py`: collects all signals, dedupes across sources, applies caps and priority (CI failure and staff/user reports first, then logs, then sweep), and starts graph runs.
6. `.github/workflows/bug-hunter-v2.yml`:
   - schedule: daily sweep + logs + feedback job, at a quiet hour IST;
   - `issues: [opened, labeled]` for `bug`;
   - `workflow_run` on `test-*.yml` completion with failure on `master`;
   - `workflow_dispatch` with inputs `run_id`, `decision`, `reason` to resume a run after approval (called by ally-be in chunk 09); a daily job expires approvals older than 7 days.
   - Concurrency group so two runs never work the same bug; secrets from repo secrets; GitHub App token, not `GITHUB_TOKEN`, for PRs.
7. Daily summary comment on a pinned "Bug Hunter v2" tracking issue (candidates, PRs, escalations, cost, current precision).
8. Kill switch: a repo variable `BUGHUNTER_ENABLED` and per-source toggles in `limits.yaml`.

## Done when
- Each signal source has tests with recorded fixtures (no network).
- Dry-run mode (`--dry-run`) runs the full daily job and writes what it *would* do; run it for three days and review the output before enabling PRs.
- The workflow runs successfully on a manual dispatch.
- `CHUNK-08-NOTES.md` written, with the rollout plan: dry-run → `ally-be` only → all apps; and the list of old bug-hunter files to remove once v2 is trusted.

## Not in this chunk
A dashboard UI. The tracking issue and PRs are the UI for now.
