# Chunk 05: Graph v1 — diagnose

**Read first:** `CONTEXT.md`, `spec.md` §2, §4, §5, §8 (short-term only), §11, §13 (escalation). Look at how `ally-ai` and `ally-ai-learn` structure their LangGraph code and match it where sensible.

## Goal
A graph that takes one bug signal and ends with either "not a bug", "duplicate", or an escalation report containing a verified failing test. No source edits yet.

## Build
1. `graph/state.py`: `BugState` and sub-models from the spec.
2. Nodes: `intake`, `triage`, `investigate` (tool loop), `reproduce` (tool loop limited to `write_test_file` + `run_tests`), `escalate`, `report`. Routing in `graph/routing.py` as pure functions.
3. `reproduce` must check the test fails **for the hypothesised reason**: the failure message/assertion relates to the finding, not import errors, missing fixtures or timeouts. A setup failure counts as "could not reproduce".
4. Prompts `triage.v1.md`, `investigate.v1.md`, `reproduce.v1.md` per §11, including the "no bug is a valid answer" rule, the confidence rubric and good/bad examples drawn from Ally code.
5. Short-term memory: `PostgresSaver` checkpointer (local pgvector container via `bug-hunter/compose.yaml`); `bug-hunter replay <run_id>` resumes or inspects a run.
6. Budgets: token and wall-clock budget per run, enforced; the run escalates with "budget exceeded" rather than looping.
7. LangSmith tracing in project `ally-bug-hunter` (spec §14); scrubbed text only.
8. Escalation output is written to the artefact folder in this chunk (GitHub comes in 06).
9. CLI: `bug-hunter run --issue-text "..." --app ally-be [--ref <sha>]` and `bug-hunter run --commit <sha>`.

## Done when
- Routing unit tests cover every edge with fake model responses.
- `make eval` reports detection, false-alarm and reproduction rates on the golden set. Record them, and the cost per case, in the notes.
- A run can be killed mid-investigation and resumed from the checkpoint.
- No source file outside test locations is ever modified (assert in tests via the worktree diff).
- `CHUNK-05-NOTES.md` written.

## Not in this chunk
Fixing, review, PRs, long-term memory, signal sources other than the CLI.
