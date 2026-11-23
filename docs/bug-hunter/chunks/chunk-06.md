# Chunk 06: Graph v2 — fix, verify, review, approve

**Read first:** `CONTEXT.md`, `spec.md` §5, §6 (GitHub), §9, §10 (review model), §13.

## Goal
From a reproduced bug to a verified, independently reviewed, human-approved **draft PR**, or a clear escalation.

## Build
1. Nodes: `risk_precheck`, `fix` (tool loop: read tools + `edit_file` + run the single repro test), `verify`, `review`, `risk_gate`, `human_approval`, `open_pr`.
2. `fix` rules in the prompt and enforced in code: smallest diff; may not edit existing tests, test config, CI files or deny/risk paths; max lines changed from `limits.yaml` (default 80) or it escalates.
3. `verify` is code only: repro test, full app suite, lint, typecheck. Compare against a baseline run on the untouched worktree so pre-existing failures are not blamed on the patch; any **new** failure fails verification.
4. Retry loop: verify failure feeds the failing output back to `fix`; max 3 attempts, then escalate with everything tried.
5. `review` uses the `review` role (a different model family). Inputs: finding, root cause, repro test, diff, verification only. `request_changes` goes back to `fix` (counts as an attempt); `reject` escalates.
6. `risk_gate`: rules from the spec; the risk level is shown to the approver.
7. `open_pr` runs before approval (draft PR, wait for CI). Then `human_approval` writes the pending row to the `approvals` table (spec §13a; create it with a migration in `bug-hunter/`) and calls `interrupt()`. Resume for now with `bug-hunter resume <run_id> --approve|--reject --reason "..."`; the UI comes in chunk 09. Approved: mark ready + enable auto-merge behind a config flag (default off until chunk 09). Rejected: close the PR.
8. `tools/github.py` with GitHub App auth; `open_pr` pushes `bughunter/<app>/<slug>` and opens a **draft** PR with the template, generated from state. `escalate` now creates/updates GitHub issues labelled `bug-hunter`.
9. Prompts `fix.v1.md`, `review.v1.md`.

## Done when
- Tests prove: risky paths never reach `fix`; existing tests can't be edited; verification uses the baseline; attempts stop at 3; nothing is pushed without approval; PRs are always drafts; branch names follow the pattern.
- `make eval` adds fix pass rate (oracle tests) and escalation correctness. Record all metrics and cost in the notes, compared with chunk 05.
- One end-to-end dry run on a real recent bug with `--no-push` produces the PR body file for a human to read.
- `CHUNK-06-NOTES.md` written.

## Not in this chunk
Long-term memory, automatic signal sources, scheduling.
