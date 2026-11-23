# Chunk 04 notes: eval harness

Branch `feat/bug-hunter-v2`. `make lint` and `make test` pass (222 offline tests).
Full eval runs happen in the manual GitHub workflow (`.github/workflows/bug-hunter-evals.yml`);
locally only single cases are run.

## Code map

| Path | What |
|---|---|
| `bug-hunter/evals/schema.py` | `Case` / `CaseFile` (Pydantic, `extra="forbid"`): kind, app, parent, commit, expected, layout, modes, risk, description, src_files, oracle_tests; `load_cases`, `save_cases`, `select(filter)`, `for_mode` |
| `bug-hunter/evals/mine_cases.py` | `Repo` (git helpers incl. `subtree_heads`), `Source` (monorepo path or pre-cutover subtree head), `mine_bugs`, `mine_clean` (blame-based), `later_fixed_shas`, `issue_description`, `write_candidates` (CANDIDATES.md, candidates.json, `<id>.patch`), `shortlist` / `write_shortlist` |
| `bug-hunter/evals/agents.py` | `CaseInput`, `AgentResult`, `Agent` protocol, `BaselineAgent` (never finds anything), `load_agent("module:Class")` |
| `bug-hunter/evals/run_evals.py` | `run_evals` / `run_case`: one case per `Run`, `DiskGuard`, `StopHarness`, patch scoring (`git apply` + hidden oracle tests in the sandbox), repro validity, escalation scoring, `--oracle-check`, `plan` (dry run), report writer |
| `bug-hunter/evals/metrics.py` | `CaseResult`, `Metrics`, `aggregate` (per app + total), `render_markdown` |
| `bug-hunter/evals/golden/cases.yaml` | The curated golden set (human-accepted) |
| `bug-hunter/evals/golden/candidates/` | Mining output for review: `CANDIDATES.md`, `SHORTLIST.md`, `candidates.json`, one `.patch` per bug candidate, `pr-cache.json` |
| `bug-hunter/evals/golden/oracle-status.json` | Per case: did the real fix make the oracle pass (fail before, pass after) |
| `bug-hunter/evals/results/` | Reports: `<timestamp>-<agent>-<mode>-<sha>.json` + `.md` |
| `bug-hunter/src/bug_hunter/cli.py` | `eval mine [apps] [--no-gh]`, `eval accept <ids>`, `eval modes <id> <modes>`, `eval run [--cases] [--agent] [--mode] [--oracle-check] [--dry-run] [--min-free-gb]` |
| `bug-hunter/src/bug_hunter/runs.py` | `owner.json` per live run; `clean_orphans` skips runs whose owner PID is alive |
| `bug-hunter/src/bug_hunter/tools/sandbox.py` | `app_root`: a pre-cutover worktree (app at the root) is mounted at `/work/<app>` |
| `bug-hunter/src/bug_hunter/tools/runner.py` | `no_tests_ran()`: a test run in which zero tests ran is a failure for every app (`RunResult.no_tests`) |
| `.github/workflows/bug-hunter-evals.yml` | Manual (`workflow_dispatch`) oracle check + baseline on `ubuntu-latest`: frees runner disk, Docker sandbox, uploads `evals/results/`, `oracle-status.json` and `runs/artefacts/` as artifacts. Inputs: `cases` filter, `what` (all/oracle/baseline). No secrets (the baseline calls no model) |

`limits.yaml` gained `evals` (`min_free_gb: 5`, `since_months: 12`, `max_src_lines: 60`,
`max_src_lines_thin_apps: 120`, `clean_window_days: 30`, clean line bounds). Makefile:
`make eval [CASES=…] [AGENT=…] [MODE=…]`, `make eval-mine`, `make eval-oracle`.

## What the history turned out to be

- **The monorepo starts on 2026-10-23.** Each app came in by `git subtree` ("Merge
  'ally-be/' from commit '<sha>'"), so `git log -- ally-be` sees 17 days. The older
  history is reachable through the merge's second parent, with root-relative paths
  (`src/…`, not `ally-be/src/…`). Mining follows both: `Source(layout="monorepo")`
  and `Source(layout="root")`. The newest subtree merge per app is used; its history
  contains the earlier syncs. ally-mobile's own subtree is the deleted React Native
  app; its Flutter history is the `ally-mobile-flutter` subtree.
- **Old-layout cases run in the sandbox** by mounting the worktree itself at
  `/work/<app>` (`Sandbox(app_root=worktree)`); patches and oracle paths are
  root-relative for them (`Case.layout`).
- **Pool after mining both histories**: 538 bug candidates (ally-be 280, ally-web 248,
  ally-ai 4, ally-ai-learn 5, ally-mobile 1) and 859 clean (ally-be 404, ally-web 378,
  ally-ai 13, ally-ai-learn 64, ally-mobile 0). The Python apps and mobile are thin
  because their fixes rarely include a test in the same commit, which the oracle
  needs; mobile has no clean candidates because its Flutter history is under 30 days
  old, so no commit can yet be judged "not fixed within 30 days".
- **Clean means "no later fix blamed its lines within 30 days"**, computed with
  `git blame` on the lines each fix removed, not file overlap. Candidates newer than
  30 days are excluded as unknowable.
- **Descriptions.** The mined text is the fix commit's message, and for Bug Hunter v1
  PRs the *commit subject* is the original symptom while the *PR title* states the
  fix. Neither is safe to hand an agent in issue mode, so every accepted bug case got
  a hand-written, symptom-only description (`description_source: hand`); the user
  checked that none gives away the fix. Two cases have no user-visible symptom and are
  `modes: [sweep]` only.

## The golden set (cases.yaml)

| App | Bug | of which escalate | Clean | Bug cases |
|---|---|---|---|---|
| ally-be | 9 | 4 | 8 | `b82759ae`, `99584ee6`, `d039e256` (escalate, `src/auth/`), `89d8e055`, `adf36739`, `8c4f9caf`, `819f6ccf` (escalate, `src/config/`), `6083b8d8` (escalate, `src/rate-limit/`), `87c6ecb8` (escalate, `src/user/`) |
| ally-web | 6 | 0 | 8 | `9299e9aa`, `e5ad37b3`, `dd128ff8`, `f35e117d`, `eebbfd01`, `3b3db9b5` |
| ally-ai | 2 | 0 | 6 | `b680c643`, `e9a0e1c3` (sweep only) |
| ally-ai-learn | 3 | 0 | 6 | `1065743a`, `7391ff7e` (sweep only), `995242d7` |
| ally-mobile | 1 | 0 | 0 | `83bdf91e` |
| **total** | **21** | **4** | **28** | |

Ids are `<app>-<first 8 of the fix sha>`. All 21 bug descriptions are hand-written,
symptom-only (`description_source: hand`), checked by the user. The four escalate cases
are human-authored ally-be fixes on risk paths (not the UnauthorizedException chain, not
Bug Hunter v1 PRs); their fix commits are old-layout (`layout: root`), so each brings
its own `package-lock.json` era. `ally-web-e5ad37b3` was first flagged risky because
the same commit also adds seven lines to `pages/auth/Login.tsx`; a correct fix does not
need that file, so the case expects `fix` and lists only `AutoTerminationRuleField.tsx`
as source (the oracle applies only the listed source files).

## Zero tests ran is a failure

Found by the first oracle run: the ally-web single-test command passed vitest a
repo-relative path, vitest's cwd is the Nx project directory, so it printed
"No test files found, exiting with code 0" and three cases "passed" vacuously. **The
chunk 02 ally-web single-file check passed the same hollow way.** Two fixes:

- `apps.yaml` ally-web `test_one` uses `{project_file}` (project-relative path).
- `Runner` treats a test run in which no test ran as failed, for every app: Jest
  "No tests found" / `Tests: 0 total`, Vitest "No test files found" / "No test suite
  found" / `no tests` summary, pytest exit code 5 (also "no tests ran", "0 selected"),
  Flutter "No tests match" / "No tests were found" / `+0: All tests passed!`. One
  offline test per framework in `tests/test_runner.py`. The harness uses it twice: a
  repro test is valid only if it *ran and failed*, and the oracle's "fails before" needs
  the same (`genuinely_failed`); `no_tests_ran=True` appears in the oracle detail.

Re-check of the chunk 02 result: `ally-web-9299e9aa` run locally with the new command
and rule, oracle test fails at a real assertion (`ChatbotTestTab.test.tsx:154`) before
the fix and `Test Files 1 passed` after; 12.7 s of sandbox time, 226 s wall-clock
including the fresh `npm ci`.

## Oracle proof

`eval run --oracle-check` proves a case when its oracle tests *run and fail* at
`parent` and pass once the real fix's source diff is applied in the sandbox. Status per
case lives in `evals/golden/oracle-status.json`; unproven cases still run in evals,
but a patch against them is not scored (`oracle_proven()`), so fix-pass counts proven
oracles only.

Full run on GitHub (run 42597232444, 2026-11-09, 21 bug cases, 20 min, no disk stop;
runner had 118 GB free after the cleanup step, 109 GB after: 4 images 3.6 GB, 5
dependency volumes 3.5 GB) plus two local single-case re-runs after fixes:

| Case | Expected | Oracle | Note |
|---|---|---|---|
| `ally-be-b82759ae` | fix | proven | |
| `ally-be-99584ee6` | fix | proven | |
| `ally-be-d039e256` | escalate | proven | `src/auth/` |
| `ally-be-89d8e055` | fix | proven | |
| `ally-be-adf36739` | fix | proven | |
| `ally-be-8c4f9caf` | fix | proven | |
| `ally-be-819f6ccf` | escalate | proven | old layout, `src/config/` |
| `ally-be-6083b8d8` | escalate | proven (local re-run) | old layout, `src/rate-limit/`; GitHub run: "app directory absent" because the layout probe looked for the first source file, which this fix *adds*; probe now also accepts the lockfile |
| `ally-be-87c6ecb8` | escalate | proven (local re-run) | old layout, `src/user/`; GitHub run: unproven because the oracle spec fails to *compile* before the fix (imports `PLATFORM_TIER_ROLES`, Jest prints `Tests: 0 total`, exit 1) and the zero-tests rule read that as "no tests ran"; rule narrowed (see below) |
| `ally-web-9299e9aa` | fix | proven | first run vacuous (vitest filter), see above |
| `ally-web-e5ad37b3` | fix | proven | old layout; first run could not apply the fix because the oracle check used monorepo paths for a root-layout case |
| `ally-web-dd128ff8` | fix | proven | first run vacuous |
| `ally-web-f35e117d` | fix | proven | first run vacuous |
| `ally-web-eebbfd01` | fix | proven | first-run theory "needs the fix's lockfile" was wrong: the helpline project's vitest exits 1 on an empty filter ("No test files found, exiting with code 1"), so before *and* after failed vacuously |
| `ally-web-3b3db9b5` | fix | proven | same as above |
| `ally-ai-b680c643` | fix | proven | |
| `ally-ai-e9a0e1c3` | fix (sweep only) | proven | |
| `ally-ai-learn-1065743a` | fix | proven | |
| `ally-ai-learn-7391ff7e` | fix (sweep only) | **unproven** | the fix's test passes on the old code too (the bare `except` it replaces never fired in the test), so fix-pass cannot be measured; kept as a sweep detection case, fixes unscored |
| `ally-ai-learn-995242d7` | fix | proven | |
| `ally-mobile-83bdf91e` | fix | proven | the full Flutter image built and ran on the amd64 runner too |

Proven: 20 of 21. The zero-tests rule was narrowed after the 87c6ecb8 miss:
explicit messages ("No tests found", "No test files found", "No test suite found",
pytest exit 5 / "no tests ran", Flutter "No tests match") count whatever the exit
code; the summary-count patterns (Jest `Tests: 0 total`, Vitest `no tests`, Flutter
`+0: All tests passed!`) count only on exit 0, because a suite that fails to run also
prints a zero count, and that is a real failure.

## Baseline

The `baseline` agent never finds anything, never escalates, never patches. It fixes the
floor every later chunk is measured against, and proves the harness scores a
do-nothing agent as it should (0 % detection, 0 % false alarms). GitHub run
42597232444, commit `f235c312f`:

| Mode | Cases run | Bugs | Clean | Detection | False alarm | Escalation correct | Errors |
|---|---|---|---|---|---|---|---|
| issue | 47 (2 sweep-only skipped) | 19 | 28 | 0 % | 0 % | 0 % | 1 (`ally-be-6083b8d8`, layout probe, fixed) |
| sweep | 49 | 21 | 28 | 0 % | 0 % | 0 % | 1 (same) |

Repro, fix-pass, tokens and cost are blank for the baseline (no model, no sandbox).
Reports: `evals/results/20261109-1021*-f235c312.{json,md}` (oracle), `…-102245-baseline-issue-…`,
`…-102348-baseline-sweep-…`. Chunk 05 must beat 0 % detection on the 19 issue-mode bug
cases while keeping false alarms at 0 % on the 28 clean cases, and chunk 06 adds
fix-pass over the 20 proven oracles.

## Decisions

- **One case per `Run`.** The worktree is removed after every case; artefacts
  (`case.json`, `agent-result.json`, `agent.patch`, `oracle-before.md`,
  `oracle-after.md`, `result.json`) are kept under `runs/artefacts/<run_id>/`.
- **Disk guard.** Free space is checked before each case and after each dependency
  install; below `min_free_gb` the harness finishes the current run, writes the
  partial report with `stopped_reason`, and exits with code 2.
- **Live runs are never swept by another process.** A run writes `owner.json` with its
  PID; `clean_orphans` skips directories whose owner is alive. (Found the hard way:
  the unit tests' harness runs swept a live oracle run's worktree mid-checkout.)
- **Scoring is code.** Detection = the agent said "found" (or escalated); a patch is
  applied with `git apply` and the hidden oracle tests run; a repro test is valid only
  if it fails on the buggy code; escalation is correct only when the case expects it.
- **Sweep input for a bug case is the parent commit's own diff**, not the bug's
  introducing commit (unknown); issue input is the description. Clean cases check out
  the clean commit itself and sweep its diff.
- **Full evals run on GitHub, single cases locally.** The runner has the disk and
  nobody's dev databases; `jlumbroso/free-disk-space` buys ~25 GB before Docker
  starts. `workflow_dispatch` only, `contents: read`, no secrets until chunk 05 needs
  model keys.
- **Zero tests ran = failed run**, everywhere (see above). A green exit code is not
  evidence unless something ran.
- **Dependency volumes are shared by lockfile hash**, so cases from the same lockfile
  era reuse one install; `--dry-run` prints distinct lockfiles per app so the disk
  cost is visible before anything installs.

## How to test

```bash
cd bug-hunter
make lint && make test
poetry run bug-hunter eval mine                 # ~6 min; writes candidates/ (needs gh for PR titles)
poetry run bug-hunter eval accept <ids>         # after reviewing SHORTLIST.md / CANDIDATES.md
poetry run bug-hunter eval run --dry-run        # plan + distinct lockfiles per app
make eval-oracle CASES=<id>                     # prove ONE case locally (Docker)
make eval CASES=<id> [MODE=sweep]               # ONE case against the baseline locally
```

Full runs: GitHub → Actions → "Bug Hunter v2 evals" → Run workflow, branch
`feat/bug-hunter-v2`, optional `cases` filter, `what` = all / oracle / baseline. Or
`gh workflow run bug-hunter-evals.yml --ref feat/bug-hunter-v2 -f what=all`. Download
the `bug-hunter-eval-results-<n>` artifact and copy `oracle-status.json` and the two
report files into `evals/golden/` and `evals/results/` to commit them. The workflow
file alone also lives on `master` (commit `a63af6b6f`): GitHub only dispatches
workflows that exist on the default branch; `--ref` picks the branch's harness.

Locally the rule is single cases only: every pre-cutover case installs its own
dependency volume (ally-web 1.3 GB, ally-be 1 GB) and the harness stops below 5 GB
free. The harness removes the volumes a case created for a non-HEAD lockfile when the
case ends, so a single local case leaves only HEAD's volume behind.

## Open questions and notes for later chunks

- `ally-ai-learn-7391ff7e` has no provable oracle; either find a test that fails on the
  old code (chunk 06 could ask the agent for one) or drop it from fix scoring for good.
- New accepted cases need a hand-written, symptom-only description (`eval accept`
  copies the mined text and marks `description_source: commit`).
- Thin apps: consider mining fixes whose test arrived in a *following* commit within a
  few days (same files) to widen the Python and mobile pools. Mobile clean candidates
  appear once the Flutter history is older than 30 days.
- The oracle "before" run for the escalate cases often fails by *compilation* (the
  spec imports a symbol the fix adds). That is a valid failure for the oracle, but
  chunk 05's reproduce node should prefer runtime failures: a repro that fails only
  because an import is missing says nothing about the bug.
- Runs on GitHub keep nothing between runs: every run rebuilds the four images (~5
  min) and installs every lockfile era. If the full set grows, cache the images in
  GHCR or the dependency volumes as tarballs.
- The workflow file also sits on `master` (`a63af6b6f`), ahead of the chunks merge,
  because GitHub dispatches only workflows that exist on the default branch. When
  `feat/bug-hunter-v2` merges, the two copies become one.
- Chunk 05 reports: detection on the 19 issue-mode bug cases, false alarms on the 28
  clean cases, escalation on the 4 risk cases, versus this baseline's zeros.
