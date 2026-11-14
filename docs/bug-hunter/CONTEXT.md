# Bug Hunter v2: Context for Claude Code

Read this file, then `spec.md`, then the current chunk brief, before any Bug Hunter v2 work.

**Current chunk: 08 — `docs/bug-hunter/chunks/chunk-08.md`** (01–07 done: `notes/CHUNK-0N-NOTES.md`; chunk 07's first follow-up, recall defects, is open in its notes)

## What we are building

A LangGraph agent, living in `bug-hunter/` at the root of `ally-platform`, that finds and fixes bugs in the five apps of this monorepo (`ally-be`, `ally-web`, `ally-ai`, `ally-ai-learn`, `ally-mobile`).

It takes bugs from four places: new commits on `master`, CI failures, production error logs, and reports from staff or users (GitHub issues labelled `bug`). Every bug goes through the same pipeline: triage, investigate, reproduce with a failing test, fix, verify, independent review, risk gate, human approval, draft PR.

Success is measured by **precision**, not volume: PRs merged without rework ÷ PRs opened. Five correct PRs a week beat twenty that staff learn to ignore.

## The non-negotiable rules (the agent's behaviour)

These are product requirements. Every chunk must keep them true, and tests must prove them.

1. **No reproduction, no fix.** The agent must produce a test that fails on the current code because of the bug before it may edit source code. If it cannot reproduce, it escalates its findings instead of guessing.
2. **The agent never touches production or `master` on its own.** It works on a throwaway git worktree inside a sandbox container, pushes only to branches named `bughunter/<app>/<slug>`, and opens **draft** PRs. A PR reaches `master` only after a super duper admin approves it in the admin dashboard **and** every CI check passes (GitHub auto-merge). It never deploys and never edits `.github/workflows/`.
3. **Risky areas are human-only.** If a fix would touch a path in `risk_paths` (see `spec.md` §9), the agent stops after diagnosis and escalates. It does not write the patch.
4. **No PHI reaches a model.** Ally is HIPAA-regulated. Every log line, issue body, test output and stack trace passes through the PHI scrubber before it enters any prompt. The agent never reads `.env*`, `env/`, `docker.env`, secrets, or `/infra/`.
5. **"No bug" is a correct answer.** Every prompt says so. The agent is never rewarded for finding something.
6. **Never change the app's tests to make a fix pass.** The agent may add tests. It may not delete, skip, or loosen existing ones.
7. **Bounded work.** Max 3 fix attempts per bug, a token and wall-clock budget per run, and a cap on PRs opened per day (default 3).
8. **Suggested fixes until the holdout says otherwise.** `pr.output_mode` in `config/limits.yaml` is `suggested_fix` (the default) or `pr`. In `suggested_fix` a successful run ends with a report (root cause, the verified failing test, the suggested patch, reviewer notes) and never creates a branch, a PR or an approval request; `run --push` refuses. **Switching to `pr` requires a holdout milestone run with at least 60% fix pass** (oracle, on the holdout split, reported in the milestone results), and the user's explicit go-ahead. Dev-set numbers never qualify. (User, 2026-11-13.)

## How to work (rules for Claude Code building this)

- Work only on the current chunk. If you notice something for a later chunk, write it in the chunk notes; don't build it.
- Read the real code before you design. The agent must match how this repo actually runs: use the **Verified commands** section of the root `CLAUDE.md` for every app's test, lint and typecheck commands.
- Follow the Python conventions of `ally-ai` and `ally-ai-learn`: Python 3.12, Poetry, pytest + pytest-asyncio, Black (88), isort, flake8. Match their LangGraph and LangChain versions (`ally-ai` pins `langgraph ^1.2` and `langgraph-checkpoint-postgres ^3.2`).
- Don't touch anything outside `bug-hunter/`, `docs/bug-hunter/` and the new workflow file named in the chunk. Chunk 09 is the one exception: it adds the approvals module to `ally-be` and the approvals page to `ally-admin-dashboard`, following those apps' own `AGENTS.md`. Don't modify or delete the existing bug-hunt workflows or `ally-be/src/bug-hunter`; they will be removed separately once v2 is live.
- Don't add or upgrade dependencies in other apps.
- Every external call (LLM, GitHub, CloudWatch, Docker) goes through an interface that tests can fake. Unit tests never hit the network or a real model.
- Run `make test` and `make lint` in `bug-hunter/` before saying anything is done. Commit after each milestone with conventional commits (`feat(bug-hunter): …`).
- All chunks are built on one branch, `feat/bug-hunter-v2`, and merged to `master` once, after local testing. Commit at the end of each chunk (`feat(bug-hunter): chunk NN …`) so the history reads chunk by chunk. Merge `origin/master` into the branch at the start of each chunk (never rebase: the branch is shared and must not be force-pushed); stop and report if the merge conflicts outside `bug-hunter/` and `docs/bug-hunter/`. Never push to `master` without the user's explicit go-ahead.
- End each chunk with `docs/bug-hunter/notes/CHUNK-NN-NOTES.md`: code map, decisions made, how to test it, open questions. Then update the "Current chunk" line at the top of this file.

## Chunk order

| # | Chunk | Outcome |
|---|-------|---------|
| 01 | Scaffold, config, model factory | Package runs; models swap by config |
| 02 | Sandbox and tools | Safe file-system, git and test tools, PHI scrubber |
| 03 | Context engine | Repo map, app context, scratchpad, budgets |
| 04 | Eval harness | Golden set from real Ally bugs; baseline numbers |
| 05 | Graph v1: diagnose | Triage → investigate → reproduce → escalate |
| 06 | Graph v2: fix | Fix → verify → review → risk gate → human → draft PR |
| 07 | Long-term memory | Learns from PR outcomes; dedupes; avoids repeat false alarms |
| 08 | Signals and schedule | Commit sweep, CI, logs, issues; runs in GitHub Actions |
| 09 | Approvals in the admin dashboard | Super duper admins approve or reject fixes in the Ally UI |

Evals (04) come before the agent's logic on purpose: every later chunk must report its effect on the eval numbers.
