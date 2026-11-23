# Chunk 12 notes: fix quality

Chunk 12 improves fix quality first, then finding quality, then cost, measured on the 19
**dev** cases. Holdout cases are never used for prompt examples or failure analysis and
run only at a milestone.

## Round 1 (2026-11-21)

Prompts investigate v5, reproduce v6, review v6. Re-run against the baseline: fix pass
2/8 (baseline 2/7), detection 79% (90%), repro 93% (85%), wrong escalations 2 (5).
Report: `bug-hunter/evals/results/20261121-rerun1-graph-issue-chunk12.md`.

## Round 2 analysis (2026-11-23)

Built from each case's LangSmith trace (finding, repro test, edits, review) and the real
fix commit with its oracle tests. Ten failing dev cases, five patterns:

| Pattern | Cases | What happened |
|---|---|---|
| A. Provider rejects our input = "not our bug" | 8c4f9caf, 995242d7 | Investigate found the mechanism (provider filter, TTS validation) and closed as environmental; the input was ours (a shipped default prompt, whitespace-only text). |
| B. Stopped at the first correct path | dd128ff8, eebbfd01 | One path handled the case (with tests), so no bug; the defect was in another writer of the same field, or in a second copy of a dependency. |
| C. Fix sized to its own weak test | 99584ee6, b82759ae, 9299e9aa | The repro asserted "one step past today's value"; the fix took the smallest number that passed. Real fixes took the value from elsewhere in the codebase, with headroom. |
| D. Fixed one of the variants it listed | 89d8e055 | The repro had two speculative variants; the fix covered one, the real defect was a third. |
| E. Dropped old behaviour / missed the opposite case | 1065743a, f35e117d | The fix lost something the old line did (traceback detail; truly-empty data now reads as withheld). Review approved. |

Oracle shape: b82759ae, 9299e9aa and 99584ee6 pin one exact reasonable value. Whether
they get a human fix-pass review like the other oracle-shape cases is the user's call.

## Round 2 changes (user, 2026-11-23)

investigate v6 (A, B), reproduce v7 (C, D), fix v3 (C, E), review v7 (E). Wording is
generic on purpose: no example comes from an eval case.

Limit found: review counterexamples must fail on the *original* code, so a regression the
fix introduces (pattern E) cannot be sent back as a counterexample. Review v7 writes it
first in `notes` as `regression: <input> — <what changes>`. Sending it back needs a code
change (a regression-test kind that passes on the original and fails with the fix): not
done, proposal only.

Next: re-run the 19 dev cases (about $7–9) when the IST day's ledger allows.
