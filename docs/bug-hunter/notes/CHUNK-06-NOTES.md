# Chunk 06 notes: graph v2 (fix, verify, review, approve)

Branch `feat/bug-hunter-v2`, merged from `origin/master` at chunk start. `make lint` and
`make test` pass (295 offline tests). **No paid run has happened in this chunk** (user
rule: ledger over the daily cap; real runs only with an explicit go). Sections marked
PENDING need one.

## Code map

| Path | What |
|---|---|
| `graph/nodes/risk.py` | `risk_precheck` (suspected files, hypothesis keywords, category security → human-only before fix) and `risk_gate` (re-checks the *final diff's* files and lines against risk paths and the crisis/safety keywords; a hit escalates even after review approved; computes the level shown to the approver) |
| `graph/nodes/fix.py` | Tool loop (fix role): outline-first reads, guarded `edit_file`, `run_repro_test`; finish `submit_fix` / `give_up`. After the loop, in code: diff measured with git, `max_fix_lines_changed` (80), removed tests or added skips → escalate; attempt counter |
| `graph/tools.py` `fix_edit_tool` | `PathPolicy.check_fix_write`: no existing tests, no test/CI configuration (`FIX_DENY_PATTERNS`), no risk paths, never the reproduction files (sha256 from reproduce) |
| `graph/baseline.py` | Baseline per (commit, app, command) under `runs/cache/baseline/`, shared across runs; on a miss the fix's files are stashed so the command sees untouched code |
| `graph/verify.py`, `nodes/verify.py` | Code only: repro passes, no *new* failures vs baseline, lint/typecheck blamed only when the untouched code passed, repro hashes unchanged; ally-web runs only the touched Nx projects (`apps.yaml test_project`); others the full suite |
| `graph/nodes/review.py` | `review` role (Gemini via `GOOGLE_API_KEY`), structured `Review`; the budget builder gives it finding, repro, patch, verification only, never the scratchpad (tested) |
| `graph/nodes/approve.py` | `open_pr`: local branch `bughunter/<app>/<slug>` + conventional commit are real; push and PR go through the GitHub client, **dry-run by default** (`pr-body.md`, `fix.patch`, `pr-branch.txt` in the artefacts, `pr_url = dry-run`); `human_approval`: approvals row + `interrupt()`; on resume approved → mark ready (auto-merge behind `limits.pr.auto_merge`, off), rejected → close |
| `graph/github.py` | `GitHubClient` protocol; `DryRunGitHub`; `UnavailableGitHub` refuses `--push` until the GitHub App exists |
| `graph/approvals.py`, `migrations/0001_approvals.sql` | `ApprovalStore`: in memory (tests) or Postgres `bughunter.approvals`; `bug-hunter db migrate` |
| `graph/output.py` | PR body (§13) and escalation issue body generated from state |
| `graph/routing.py` | after_reproduce → risk_precheck; after_fix; after_verify (fix again below 3 attempts); after_review (request_changes counts as an attempt; reject escalates); after_risk_gate; after_open_pr |
| `cli.py` | `run … [--push]`, `resume <run_id> --approve|--reject --reason`, `db migrate` |
| `evals/agents.py` | `GraphAgent` returns the fix patch (`patch_applied=True`: the graph edited the worktree) so the harness runs the hidden oracle tests without re-applying |
| `prompts/fix.v1.md`, `prompts/review.v1.md` | Drafts, active in `models.yaml`; **not yet approved by the user** for a paid run |

## Decisions

- **Rules live in code, prompts only explain them.** Every "fix may not…" is enforced
  by `check_fix_write` before a byte is written and re-checked on the measured diff
  after the loop; `verify` and `risk_gate` never ask a model.
- **Baseline before blame.** A pre-existing red test or lint error is never pinned on
  the patch; the comparison is by failing-test id, and a run that fails without a
  parsable test name (compile error, crash) on a green baseline is blamed.
- **Nothing leaves the machine in this chunk.** `open_pr` and `escalate` default to the
  dry-run client; `--push` without the GitHub App is a clear refusal, not a silent
  dry run.
- **Approval is a real interrupt.** The run sleeps in the Postgres checkpoint; `resume`
  answers it with `Command(resume=…)`. Tested with `InMemorySaver` end to end
  (approve → `pr_opened`, reject → `rejected`).
- **ally-web verification is partial by design**: only the touched Nx projects run
  locally; the draft PR's CI runs the full suite before anything can merge.

## Tests (offline, `tests/test_graph_chunk06.py`, `tests/test_graph_fix_verify.py`)

Risky suspected files never reach fix (the fix model is never called); `edit_file`
refuses existing tests, the repro file, test/CI config and risk paths; the 80-line cap
and removed/skipped tests escalate; verify failures feed the next attempt and stop at
3; `request_changes` counts as an attempt and `reject` escalates; the reviewer's prompt
contains no scratchpad text; `risk_gate` escalates an approved diff that mentions a
safety keyword; the dry-run PR writes body/patch/branch and `Git.push` is never called
(monkeypatched to fail); branch names follow `bughunter/<app>/<slug>`; baseline cache
hits skip the suite and the baseline sees the untouched code (observed through the
stash).

## Metrics: first graph-v2 eval (issue mode, 2026-11-10)

GitHub run 42767847055, commit `1ec27151`, prompts triage.v3, investigate.v3,
reproduce.v4, fix.v2, review.v2; gpt-5 / gpt-5-mini / gemini-2.5-pro. 19 bug cases (the
two sweep-only cases have no issue text). **Real cost $9.39** (LangSmith); the report
shows $7.14 because four crashed cases reported $0 (fixed). 3 h 23 min.

| Outcome | Count | Cases |
|---|---|---|
| Draft PR (dry-run), review approve | 5 | `99584ee6`, `89d8e055`, `adf36739`, `995242d7`, `87c6ecb8` |
| of which the hidden oracle passes | **1** | `89d8e055` |
| Escalated correctly (risk path) | 3 | `d039e256`, `819f6ccf`, `6083b8d8` |
| Escalated, could not reproduce | 3 | `f35e117d`, `eebbfd01`, `3b3db9b5` (all ally-web) |
| Escalated by precheck on a wrong suspect | 1 | `8c4f9caf` (suspected `config.service.ts`; the real fix is elsewhere) |
| No bug (missed at investigate) | 3 | `b82759ae`, `e5ad37b3`, `83bdf91e` |
| Harness error in verify | 4 | `9299e9aa`, `dd128ff8`, `b680c643`, `1065743a` |

Review verdicts: approve 5, request_changes 0, reject 0. Fix attempts: 1 on every PR.
Escalation correctness 3/4: `87c6ecb8` (expected escalate) reached a PR because the
agent's one-line fix lives in `src/common/constants/`, outside the risk paths, while the
real fix also changed `src/user/`. By the rules the gate was right; the label reflects
the real fix's files.

Why four of five PRs fail their oracle (re-run locally on the agent's patch, no model):
- `995242d7` genuine miss: the agent fixed a different defect (the TTS error-fallback
  flag) than the real one (whitespace-only text reaching Sarvam).
- `99584ee6` genuine miss: the repair retries, but the oracle's blueprint still loses
  items (`toHaveLength(3)` fails).
- `adf36739` implementation-coupled oracle: the agent logs the error as a string, the
  real fix logs the Error object, and the oracle asserts the object.
- `87c6ecb8` API-coupled oracle: it imports `PLATFORM_TIER_ROLES`, a constant the real
  fix introduced; the agent fixed the same behaviour under the existing name.

Fix pass is 1/5 strictly, 3/5 if the two shape-coupled oracles are discounted.

Trace links: fix pass `89d8e055` https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1c43b-5e40-7146-8e3b-d70185eff395?trace_id=01a1c43b-5e40-7146-8e3b-d70185eff395&start_time=2026-11-10T06:53:07.520194 · fix fail `995242d7`
https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1c4af-b041-7107-b1df-109859db272e?trace_id=01a1c4af-b041-7107-b1df-109859db272e&start_time=2026-11-10T09:00:10.689498 · escalation `6083b8d8` https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1c4c9-4309-721f-8f88-abdec12c5c5b?trace_id=01a1c4c9-4309-721f-8f88-abdec12c5c5b&start_time=2026-11-10T09:28:06.665119

### Harness defects this run exposed (fixed in `6512faa47`)

1. Verify crashed on bounced repro files: `files_changed` came from `git status`, which
   lists untracked files, and `git stash push` refuses untracked pathspecs. The fix's
   files are now tracked modified files only; `stash_paths` filters to tracked paths.
2. Repro validity read "no" for every PR case: the harness checked "fails on the buggy
   code" after the graph had applied its fix. It now stashes the applied fix first.
3. Crashed cases lost their cost and bypassed the per-run cap: `GraphAgent` now returns
   the spend from the last checkpoint with the error.

Compared with chunk 05 (issue mode, 10-case subset): detection 6/6 there, 12/19 here
on the full bug set; the misses are 3 at investigate, 4 harness errors, 3 ally-web
reproductions. The printed repro rate (38 %) is wrong for the reason in item 2.

## Open questions

- The real GitHub client (App auth, draft PR, ready/auto-merge, issues) is unwritten:
  the App does not exist. The interface and the dry-run cover everything the graph
  needs; `tools/github.py` from the spec arrives with the App.
- `human_approval` writes `ci_status = dry-run`; with a real PR it should poll checks
  before interrupting (spec §13a step 1).
- Fix diffs are measured on the whole worktree; a repro test written by reproduce is
  excluded by hash, but a second new test file created by the fix loop cannot happen
  (no `write_test_file` in the fix tools) and so is not handled.
