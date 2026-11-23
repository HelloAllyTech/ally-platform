# Chunk 04: Eval harness

**Read first:** `CONTEXT.md`, `spec.md` §14.

## Goal
A repeatable benchmark built from Ally's own history, in place before any agent logic, so every later change can be measured.

## Build
1. `evals/mine_cases.py`: scan `master` history (fetch enough depth; a bounded `git fetch --depth` is fine) for:
   - **Real bugs**: `fix:`/`fix(...)` commits touching one app, small source diff (default ≤ 60 lines), that add or change a test. Each case stores: parent SHA, app, files, the fix's test (hidden oracle), the fix diff (hidden), and a short description written from the commit message and PR title, scrubbed.
   - **Clean diffs**: `feat:`/`chore:` commits with no `fix:` to the same lines within 30 days.
2. Human curation step: write candidates to `evals/golden/candidates/`; a person marks accepted cases in `evals/golden/cases.yaml`. Target 20+ real bugs and 20+ clean diffs across all five apps. Mark which real bugs touch risk paths (expected outcome: escalate).
3. `evals/run_evals.py`: for each case, create a worktree at the parent SHA and run a given entry point (`sweep` mode on the diff, or `issue` mode on the description). Until chunk 05 exists, ship a trivial baseline agent ("never finds anything") so the harness runs end to end.
4. `evals/metrics.py`: detection, false-alarm, reproduction, fix pass (oracle test passes with the agent's patch), escalation correctness, cost, time. Output a markdown table and JSON keyed by git SHA + prompt versions + model config.
5. `make eval` and `make eval CASES=ally-be` (filter).

## Done when
- Candidate mining runs and produces candidates for every app (or the notes explain why an app has none).
- `cases.yaml` exists with whatever has been curated so far; the harness runs on it with the baseline agent and produces the report.
- Oracle check is proven: applying a case's real fix diff makes its oracle test pass in the sandbox.
- `CHUNK-04-NOTES.md` written, including the case count per app.

## Not in this chunk
Any LLM logic beyond the baseline.
