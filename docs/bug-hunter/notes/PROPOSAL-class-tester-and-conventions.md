# Proposal (not built): class tester node, and a convention-first fix rule

**Superseded 2026-11-13 by `PROPOSAL-review-v4-counterexamples.md`** (the class tester is
replaced by reviewer counterexamples; the convention rule is dropped). Kept for history.

Status: proposal for after the 2026-11-11 dev eval. Nothing here is implemented.
Motivation: of six failed fixes so far, two were too narrow (handled the repro's exact
input or exception, not the class: `1065743a`, `99584ee6`) and one picked a plausible
value instead of the system's own (`9299e9aa`: 20 instead of ally-be's 10). Prompt rules
alone (fix.v2 "handle the class", reproduce.v4/v5 "cover the class") did not stop it.

## 1. Class tester node

**Where:** between `verify` (passed) and `review`.

**Input, and nothing else:** the scrubbed signal (report or commit), the finding's
hypothesis, and the reproduction test file. Not the diff, not the fixer's reasoning,
not the scratchpad. A different model from the fixer (the review role's family, Gemini)
so it does not share the fixer's blind spot.

**Job:** name the class of inputs the bug is about and write 2–3 extra test cases from
that class in the repro test's own style, prioritising the most common real-world member
and the boundaries the repro did not cover. Output is a new test file (create-only, in
the app's test location, through the existing `write_test_file` rules).

**Validity is code, not judgement:** each extra case must fail on the untouched code
(run in the clean checkout, as the baseline does). Cases that pass on the buggy code or
fail for a setup reason are dropped, not shown to anyone. If none survive, the node
records "no class cases" and the run continues as today.

**Use:** verify runs the surviving cases against the fix. A failure goes back to `fix`
as a normal failed attempt, with the failing case's output (as with any test failure).
The extra cases are kept in the PR as additional regression tests.

**Guard rails:** the fixer never edits these files (protected by hash, like the repro);
max 3 cases; the node runs once per run, not per attempt.

**Expected cost per case:** one model call of about 4–7k tokens in and 1.5k out on
gemini-2.5-pro ≈ **$0.02–0.03**, plus sandbox time (two short test runs: one in the
clean checkout, one on the fix). When a class case fails and triggers another fix
attempt, add one fix attempt (≈ $0.10–0.15 at the last run's fix-node costs) and one
verify. Averaged over the dev set (about 8 of 19 cases reach verify): **≈ +$0.04–0.07
per case**, ≈ +$1 per 19-case eval.

## 2. Convention-first fix rule

**Rule (fix prompt):** before introducing any number, limit, size, timeout, format
string, regex or enum value, search for an existing one: constants and config in the
same app (`grep`, `find_symbol`), and the cross-app contracts from the repo map
(chunk 03 `contracts.py`: ally-be ↔ ally-ai / ally-ai-learn literals). Reuse it, or
say why a new value is right.

**Enforced in code, not only in the prompt:**
- `submit_fix` gains a required `value_sources` list: for every new literal in the diff,
  either `file:line` of the existing constant it mirrors, or `new: <reason>`.
- After the loop, a diff scan finds added numeric literals, quoted format strings and
  regexes; any that is not listed in `value_sources` bounces back to the fix loop once
  ("cite where this value comes from").
- `review.v3` already sees the diff; the PR body lists `value_sources` so the reviewer
  and the human approver see the choice explicitly.

**Expected cost per case:** two to four extra read-only tool turns on fix-reaching
cases (≈ 1–3k cached-heavy tokens each) ≈ **$0.01–0.03 per fix case**, ≈ +$0.01 per
case over the dev set. A bounce adds one fix-loop turn (≈ $0.02).

## Measuring them

Both target the "too narrow" and "ignores a convention" patterns. Success on the next
dev eval: fix-pass on PR cases up from 2/8, with no drop in detection; the holdout
milestone confirms it without tuning on those cases.
