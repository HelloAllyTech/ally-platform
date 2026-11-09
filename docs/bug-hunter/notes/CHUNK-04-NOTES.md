# Chunk 04 notes: eval harness

Branch `feat/bug-hunter-v2`. `make lint` and `make test` pass (204 offline tests).
Results sections marked PENDING are filled in from the oracle and baseline runs.

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

| App | Bug | of which escalate | Clean |
|---|---|---|---|
| ally-be | 6 | 1 | 8 |
| ally-web | 6 | 1 | 8 |
| ally-ai | 2 | 0 | 6 |
| ally-ai-learn | 3 | 0 | 6 |
| ally-mobile | 1 | 0 | 0 |
| **total** | **18** | **2** | **28** |

Bug cases: `ally-be-b82759ae`, `ally-be-99584ee6`, `ally-be-d039e256` (escalate: `src/auth/`),
`ally-be-89d8e055`, `ally-be-adf36739`, `ally-be-8c4f9caf`, `ally-web-9299e9aa`,
`ally-web-e5ad37b3` (escalate, old layout: the same commit also edits
`pages/auth/Login.tsx`, which `**/auth/**` catches; the matcher is right), `ally-web-dd128ff8`,
`ally-web-f35e117d`, `ally-web-eebbfd01`, `ally-web-3b3db9b5`, `ally-ai-b680c643`,
`ally-ai-e9a0e1c3` (sweep only), `ally-ai-learn-1065743a`, `ally-ai-learn-7391ff7e` (sweep only),
`ally-ai-learn-995242d7`, `ally-mobile-83bdf91e`. Proposed but not yet accepted as further
escalate cases (human-authored ally-be fixes on risk paths, not the UnauthorizedException
chain): `ally-be-819f6ccf` (config env string parsed wrongly), `ally-be-6083b8d8`
(rate-limit trusts X-Forwarded-For), `ally-be-87c6ecb8` (tenant user list shows staff).

## Oracle proof (first run, 2026-11-09)

`make eval-oracle` writes `evals/golden/oracle-status.json`; a case is proven when its
oracle tests fail at `parent` and pass once the real fix's source diff is applied in
the sandbox. First run over the 18 bug cases (it also wasted time on the 28 clean
cases, since fixed; and stopped at the disk floor after case 30):

| Result | Cases |
|---|---|
| **Proven** (11) | all 6 ally-be; `ally-ai-b680c643`, `ally-ai-e9a0e1c3`; `ally-ai-learn-1065743a`, `ally-ai-learn-995242d7`; `ally-mobile-83bdf91e` |
| Test passes before the fix too (1) | `ally-ai-learn-7391ff7e`: the fix's test does not fail on the old code, so fix-pass cannot be measured; stays sweep-only, unscored for fixes |
| ally-web: vacuous "pass" (3) | `ally-web-9299e9aa`, `dd128ff8`, `f35e117d`: vitest printed "No test files found, exiting with code 0". The single-test command passed a repo-relative file to vitest, whose cwd is the Nx project dir. **The chunk 02 single-file check for ally-web passed vacuously for the same reason.** Fixed: `{project_file}` placeholder (project-relative path); re-run pending |
| ally-web: fix needs the new lockfile (2) | `ally-web-eebbfd01` (react-router per-app resolution), `ally-web-3b3db9b5`: tests fail before and still fail after the source diff alone. To prove them the fix commit's dependencies must be installed, i.e. a second volume for the fix's lockfile. Re-run pending after the vitest fix; if still failing, mark unproven |
| ally-web: fix diff did not apply (1) | `ally-web-e5ad37b3`: `git apply` of the source diff failed (old layout). Apply errors are now written to `apply-errors.txt`; re-run pending |

Unproven cases are still run in evals, but a patch against them is not scored
(`oracle_proven()` in `run_evals.py`), so fix-pass only counts proven oracles.

Disk during the run: every pre-cutover case has its own lockfile, so the harness
created seven dependency volumes beyond HEAD's (4.7 GB) and the floor stopped it at
4.75 GB free. The harness now removes the volumes a case itself created for a
non-HEAD lockfile when the case ends (`keep_nonhead_volumes=False`); volumes that
existed before, and HEAD's, are never touched.

## Baseline

PENDING — `make eval` (issue mode) and `make eval MODE=sweep` with the baseline agent.

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
- **Dependency volumes are shared by lockfile hash**, so cases from the same lockfile
  era reuse one install; `--dry-run` prints distinct lockfiles per app so the disk
  cost is visible before anything installs.

## How to test

```bash
cd bug-hunter
make lint && make test
poetry run bug-hunter eval mine            # ~6 min; writes candidates/ (needs gh for PR titles)
poetry run bug-hunter eval accept <ids>    # after reviewing SHORTLIST.md / CANDIDATES.md
poetry run bug-hunter eval run --dry-run   # plan + distinct lockfiles per app
make eval-oracle                           # prove the cases (Docker)
make eval                                  # baseline, issue mode
make eval MODE=sweep
```

## Open questions and notes for later chunks

- Issue-mode descriptions are hand-written for the 18 accepted bugs; new accepted
  cases need the same treatment (the `accept` command copies the mined text and marks
  `description_source: commit`).
- Thin apps: consider mining fixes whose test arrived in a *following* commit within a
  few days (same files) to widen the Python and mobile pools.
- Mobile clean candidates appear once the Flutter history is older than 30 days.
- The old-layout cases run against each era's lockfile; each distinct lockfile is one
  more dependency volume (ally-web ≈ 1.3 GB). `cache clean --volumes` removes them.
