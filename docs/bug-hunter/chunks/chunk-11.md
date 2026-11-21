# Chunk 11: PR actions, like the old Bug Hunter

Agreed with the user on 2026-11-21. The performance work moves to chunk 12; its dev
baseline (GitHub run 44871753414) runs meanwhile.

## Decisions (user, 2026-11-21)

- Bug Hunter opens a **draft PR on its own** when the strict gate holds (CONTEXT.md rule
  8), and otherwise asks: the bug lands in Needs you with **Open PR**.
- Buttons as in v1: **Put me on it** (was Start fix / Retry), **Dismiss** with a reason,
  **Open PR**, **View PR**, **Merge**, **Release**, and **bulk** Put me on / Dismiss.
- Merge and Release are always a person's click, never automatic.
- The verdict comes from the buttons where it can: Merge records "diagnosis correct, fix
  worked"; Dismiss records "not a bug" (or wrong, by reason). The verdict form stays for
  "needed edits" and anything else.

## What to build

1. **The strict gate** (`pr.output_mode: auto`): after the risk gate, a run goes to
   `open_pr` only when every condition holds; else `suggest_fix`. The default stays
   `suggested_fix` until the user switches it.
2. **A GitHub client that works locally**: `gh` CLI, authenticated by
   `BUGHUNTER_GITHUB_TOKEN` (the App's token on the VM) or the developer's `gh` login.
   Branches `bug-hunter/<app>-<run>`; draft PRs with a short body; never `master`.
3. **Actions the worker performs**: `bughunter.actions` (open_pr), written by ally-be,
   taken by the worker before it claims a bug. Open PR rebuilds the branch from the
   report's base commit, patch and failing test.
4. **ally-be**: dismiss, bulk start/dismiss, open-pr (queues the action), merge and
   release (reusing v1's `GithubActionsService.mergePullRequest` and
   `ProductionReleaseService`), all audited and behind the v2 toggle.
5. **The board**: statuses `pr_open` (In progress, as in v1), `merged` and `released`
   (Done); row actions by state; checkboxes and a bulk bar; Dismiss with a reason.

## Done when

- Offline tests for the gate, the client (faked `gh`), the actions, the endpoints and the
  board pass in all three apps.
- One local check: Open PR on bug #10's suggested fix opens a draft PR (the user's go on
  the push, as it is a public repo).
