# Chunk 10: modes, reported bugs, and the board

Agreed with the user on 2026-11-16. The performance work (fix quality, then finding
quality, then cost) moves to chunk 11.

## What to build

1. **Three modes**, set on the Bug Hunter v2 page and audited, like the old Bug Hunter's
   off / manual / AI:

   | Mode | Bugs collected (reported + daily signals) | Fix runs start |
   |---|---|---|
   | Off | No | Never |
   | Manual | Yes, into Backlog | When an admin presses **Start fix** |
   | Autonomous | Yes | By themselves, one at a time, oldest first |

   Every mode keeps the caps: **10 runs a day** (user, 2026-11-16) and the $15/day spend
   ledger. Past either, bugs wait in Backlog with the reason, and start the next day.
   Rule 8 is unchanged: a finished fix is a suggestion, not a PR, until the holdout
   milestone.
2. **Reported bugs reach v2.** A roadmap item of type "bug" (anyone can file one) also
   goes into v2's queue (`bughunter.bugs`) when it is filed. v1's finding is created as
   before; v1 is not changed. Turn v1 off once v2 is in use, so both don't work on the
   same bug.
3. **A worker** (`bug-hunter worker`) that runs queued bugs according to the mode,
   through the daily job's run path, and files the report. The daily job only collects
   into the queue.
4. **A board like the old one**: Needs you, Failed, In progress, Backlog, Done, with
   counts, a source and an app per row, Start fix / Retry, and a row with a report
   opening it.

## Done when

- Offline tests for the modes, the queue, the worker, the hook and the tabs pass in all
  three apps (no model spend).
- One paid end-to-end check, after the user's go (~$0.60): file a reported bug locally
  and watch it go from Backlog to In progress to Needs you.
