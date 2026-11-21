# Chunk 11 notes: PR actions, like the old Bug Hunter

Status: **built and tested offline** (2026-11-21). Not yet tried end to end: a real
Open PR / auto-PR push needs the user's go (public repo).

## Decisions (user, 2026-11-21)

- Rule 8 replaced: Bug Hunter opens a **draft PR on its own** only through the
  **strict gate**, otherwise it asks (Needs you, with the reasons and Open PR).
  Merge and Release are always a person's click; `auto_merge` stays off.
- Buttons as in v1: Put me on it, Dismiss (reason), Open PR, View PR, Merge, Release,
  bulk Put me on / Dismiss.
- Verdicts come from buttons where they can: Merge = correct / worked; Dismiss as
  "not a bug" = not_a_bug / none, "wrong diagnosis" = wrong / wrong. Duplicate and
  won't fix teach nothing.

## The strict gate (`graph/pr_gate.py`)

All of: the failing test passes with the fix; verify green (tests, lint, typecheck);
review approves with no open counterexample and no dispute; confidence high; risk
low; diff at most `run.max_fix_lines_changed` (80); not a security finding; fewer
than `sweep.max_prs_per_day` (3) PRs opened today. The risk gate records the failed
conditions in `pr_gate_blockers`; routing opens a PR only when there are none. The
worker shows them on the bug ("asks you before a PR: …").

`pr.output_mode` is `auto` in `config/limits.yaml`; `BUGHUNTER_PR_OUTPUT_MODE=
suggested_fix` switches auto-PRs off without editing it.

## How it works

```
run --(strict gate open)--> draft PR (agent) ---------------------\
run --(gate closed)-------> Needs you: Open PR --> bughunter.actions --> worker --> draft PR (admin)
                                                                         |
PR open (In progress) --Merge (ally-be, v1 GithubActionsService)--> merged (Done) --Release--> released
```

- **GitHub client** (`graph/github.py`, `GhCliGitHub`): `gh`, authenticated by
  `BUGHUNTER_GITHUB_TOKEN` (the App's token on the VM) or the developer's own `gh`
  login. Draft PRs against master only; pushes through `Git.push`, which refuses
  anything but `bughunter/` branches. It never files anything public about a finding:
  escalations stay in the run's artefacts and the private reports repo.
- **Open PR** (`queue/actions.py`): the worker rebuilds the fix on a fresh checkout of
  origin/master (patch + failing test), commits, pushes and opens the draft. Refuses
  security / auth / tenant / data findings (same topic check as the risk gate), and a
  patch that no longer applies. The result (PR link or reason) is on the action row
  and shown on the board.
- **Merge / Release** (ally-be `BugHunterBoardService`): reuse v1's
  `GithubActionsService.mergePullRequest` (squash, never forced) and
  `ProductionReleaseService` with `resolveReleaseTarget` (won't guess an ally-web
  frontend). Locally both say "GITHUB_TOKEN is not configured", as v1 does.
- **Board**: `pr_open` is under In progress (as on v1's board), `merged` and
  `released` under Done.

## Code map

| Where | What |
|---|---|
| `bug-hunter/migrations/0009_pr_actions.sql` | PR columns, statuses, `bughunter.actions`, grants |
| `bug-hunter/src/bug_hunter/graph/pr_gate.py` | the strict gate |
| `bug-hunter/src/bug_hunter/graph/github.py` | `GhCliGitHub`, `gh_ready`, client choice |
| `bug-hunter/src/bug_hunter/queue/actions.py` | Open PR from a report; never-public check |
| `bug-hunter/src/bug_hunter/queue/worker.py` | `do_actions`, `pr_open` after a gate-opened run |
| `bug-hunter/src/bug_hunter/signals/runner.py` | worker runs push in auto mode; PR count for the cap |
| `ally-be/src/bug-hunter-approvals/…` | dismiss, bulk, open-pr, merge, release routes (audited) |
| `ally-web/…/BugHunterV2/BugHunterV2Board.tsx` | row actions by state, bulk bar, dismiss form |

## Tests

- bug-hunter `tests/test_pr_actions.py` (25): every gate condition, routing, the gh
  client (draft, base, token, refusals, no public escalation), Open PR (paths,
  branch, refusals for security / tenant / auth), actions, worker outcomes, env switch.
- ally-be `bug-hunter-board.spec.ts`: dismiss (+ verdicts), bulk, open-pr, merge
  (+ GitHub's refusal), release (+ ambiguous frontend); access test covers 14 routes.
- ally-web: Open PR, pending / failed request, View PR + Merge, Release + tag, Dismiss
  form, bulk select.

## Not done / open

- **A real push**: the first auto-PR or Open PR goes to the public repo, from the
  developer's `gh` login locally (the App later). Needs the user's go.
- **Merge and Release locally** need ally-be's GITHUB_TOKEN (v1's credential).
- A PR merged or closed in GitHub directly is not noticed yet (v1 has a reconcile
  pass); later.
