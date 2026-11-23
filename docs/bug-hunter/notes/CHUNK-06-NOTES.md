# Chunk 06 notes: graph v2 (fix, verify, review, approve)

Branch `feat/bug-hunter-v2`, merged from `origin/master` at chunk start. `make lint` and
`make test` pass (295 offline tests). Paid runs: see Metrics (user
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

## Metrics: graph v2, issue mode, all 19 bug cases (2026-11-10)

Two GitHub runs make up the complete set: run 42767847055 (19 cases, commit `1ec27151`,
$9.39) and run 42831392057 (the 4 cases that crashed in verify, re-run at `f407e405`
after the harness fixes, $1.35). **Total $10.74.** Prompts: triage.v3, investigate.v3,
reproduce.v4, fix.v2, review.v2; gpt-5 / gpt-5-mini / gemini-2.5-pro. The two
sweep-only cases have no issue text. Repro is the graph's own code-verified
reproduction (see "repro column" below).

| Case | Expected | Repro | Review | Fix tries | Ended as | Oracle | Cost |
|---|---|---|---|---|---|---|---|
| `ally-be-89d8e055` | fix | yes | approve | 1 | PR | **pass** | $0.46 |
| `ally-ai-b680c643` (re-run) | fix | yes | request_changes, approve | 2 | PR | **pass** | $0.48 |
| `ally-be-99584ee6` | fix | yes | approve | 1 | PR | fail | $0.54 |
| `ally-be-adf36739` | fix | yes | approve | 1 | PR | fail (oracle_shape; human: fail) | $0.63 |
| `ally-ai-learn-995242d7` | fix | yes | approve | 1 | PR | fail | $0.76 |
| `ally-web-9299e9aa` (re-run) | fix | yes | approve | 1 | PR | fail | $0.29 |
| `ally-ai-learn-1065743a` (re-run) | fix | yes | approve | 1 | PR | fail | $0.24 |
| `ally-be-87c6ecb8` | escalate | yes | approve | 1 | PR | fail (expected escalate) | $0.38 |
| `ally-be-d039e256` | escalate | no | – | 0 | escalated: could not reproduce | – | $0.41 |
| `ally-be-819f6ccf` | escalate | yes | – | 0 | escalated: risk path | – | $0.23 |
| `ally-be-6083b8d8` | escalate | yes | – | 0 | escalated: risk path | – | $0.32 |
| `ally-be-8c4f9caf` | fix | yes | – | 0 | escalated: risk precheck, wrong suspect | – | $0.45 |
| `ally-web-f35e117d` | fix | no | – | 0 | escalated: could not reproduce (path prefix bug) | – | $0.65 |
| `ally-web-eebbfd01` | fix (escalate_acceptable) | no | – | 0 | escalated: could not reproduce | fail: mechanism right, wrong file | $0.80 |
| `ally-web-3b3db9b5` | fix | no | – | 0 | escalated: could not reproduce (setup) | – | $0.75 |
| `ally-be-b82759ae` | fix | – | – | 0 | no bug (missed) | – | $0.52 |
| `ally-web-e5ad37b3` | fix | – | – | 0 | no bug (missed) | – | $0.16 |
| `ally-web-dd128ff8` (re-run) | fix | – | – | 0 | no bug (missed) | – | $0.34 |
| `ally-mobile-83bdf91e` | fix | – | – | 0 | no bug (missed) | – | $0.09 |

| Metric | Value |
|---|---|
| Detection (found or escalated) | 15/19 (79 %) |
| Verified reproduction, of cases that reached reproduce | 11/15 (73 %) |
| Ended as | PR 8, escalated 7, no bug 4 |
| Review verdicts | approve 8, request_changes 1, reject 0 |
| Fix pass, oracle | 2/8 (`89d8e055`, `b680c643`) |
| Fix pass, adjusted (human review for oracle_shape) | 2/8 (`adf36739` human fail; `87c6ecb8` counted as a failure: expected escalate) |
| Escalation correctness | 3/4 (`87c6ecb8` reached a PR) |
| Fix attempts | 1 on every PR except `b680c643` (2, after request_changes) |
| Cost | $10.74 total, $0.57 per case |

Compared with chunk 05 (issue mode, 10-case subset, diagnosis only): detection 6/6 and 4
verified repros there; on the full bug set 15/19 and 11/15 here, and the fix stage is
the new bottleneck: 8 PRs, 2 correct.

Per-PR oracle failures (analysed locally on the agent's patch, no model):
`995242d7` and `99584ee6` are genuine misses (a different defect; items still lost).
`adf36739`: the human verdict is fail: "doesn't fix the reported log detail;
rethrowing QueryFailedError changes the client response and may expose query details."
`87c6ecb8`: oracle-shape-coupled and expected escalate; counted as a failure.
`9299e9aa` and `1065743a` (re-run) are not analysed yet.

Trace links: fix pass `b680c643`
https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1c5f7-a6c0-77a3-9a20-9ada61ac1fed ·
fix fail `995242d7`
https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1c4af-b041-7107-b1df-109859db272e ·
escalation `6083b8d8`
https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1c4c9-4309-721f-8f88-abdec12c5c5b

### The repro column

Both reports print "repro: no" for every PR case. Root cause: `open_pr` commits the fix on
the `bughunter/…` branch before the harness scores the repro, so "set the fix aside"
found nothing to set aside and the repro ran on fixed code. The numbers above come from
the graph's own verified reproduction (scratchpad). Since `fe00b5b11` the harness runs
the repro in a clean checkout of the case's parent commit, which is independent of what
the graph committed.

### Changes after these runs (all offline, tested)

- Risk rules: human-only by topic (tenancy, data exposure, auth, permissions) and when a
  risk-path file calls or imports what the fix changed (`78df267f4`).
- Reviewer gets the scrubbed signal; review.v3 active: drift from the report = reject.
- reproduce.v5 active: neighbour test setup as a template (scrubbed, ≤120 lines / 3k
  tokens); setup failures (missing provider/hook) bounce back; app-prefixed test paths
  fixed (`f35e117d`).
- Baseline and harness repro check in a clean checkout; no stash anywhere.
- Storage in `~/.bug-hunter` (`BUGHUNTER_HOME`); spend ledger rebuilt after the in-repo
  copy was deleted; orphan sweep restricted to `run-*` folders.
- `oracle_shape`, `human_fix_pass`, `escalate_acceptable` (strict file rule) in the cases.

Next: one full 19-case issue-mode eval with these prompts (ask first, with the cost);
its results are the starting point for chunk 07.

## Open questions

- The real GitHub client (App auth, draft PR, ready/auto-merge, issues) is unwritten:
  the App does not exist. The interface and the dry-run cover everything the graph
  needs; `tools/github.py` from the spec arrives with the App.
- `human_approval` writes `ci_status = dry-run`; with a real PR it should poll checks
  before interrupting (spec §13a step 1).
- Fix diffs are measured on the whole worktree; a repro test written by reproduce is
  excluded by hash, but a second new test file created by the fix loop cannot happen
  (no `write_test_file` in the fix tools) and so is not handled.
