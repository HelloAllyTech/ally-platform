# Proposal: review.v4, evidence-only review with counterexample tests

Status: **proposal, not built** (2026-11-13). Supersedes
`PROPOSAL-class-tester-and-conventions.md`: the class tester is replaced by this, and the
convention rule is dropped.

## Why

In the 2026-11-13 dev eval (run 43368994787, 19 cases), review.v3 gave 8 verdicts and
2 of them were right:

| Verdict | Count | Right | What went wrong |
|---|---|---|---|
| approve | 6 | 2 | 4 approved fixes fail the oracle (too narrow / wrong target) |
| request_changes | 2 | 0 | b680c643: called a correct fix a "regression" and got it replaced by one that fails the oracle. 9299e9aa: asked for a named constant with the same value (20); no behaviour change, and the extra attempt cost 16 min and hit the wall clock |
| reject | 0 | – | – |

The reviewer's judgement costs more than it gives. It cannot run anything, so its
objections are opinions, and the fixer obeys them verbatim. v4 makes the reviewer
**prove** an objection with a test that code runs, or leave it as a note.

## The design

The reviewer has three moves:

1. **approve**: nothing to prove.
2. **reject**, only for **drift**: the finding or diff does not address the reported
   symptom (the v3 drift check, unchanged). Escalates as today. No other reason to reject.
3. **counterexamples**: up to **3** concrete tests, each an input the finding says
   should work and the fix does not handle. Each comes with a one-line claim
   ("pageSize 0 still divides by zero").

Any other concern (style, naming, "might regress", "consider X") goes into
`reviewer_notes`. Notes never send the fix back. They are printed in the suggested-fix
report (and the PR body in `pr` mode).

### What code does with counterexamples (the `challenge` step, no model)

For each proposed test, in this order:

1. **Shape checks.** Each test is a new file next to the repro test (same directory and
   framework, so it uses the repro's imports and setup). It must not edit existing tests,
   and it must pass `scrub_code` and the deny paths. A test that fails these is dropped
   with the reason logged.
2. **Run on the buggy code** (the clean checkout at the base commit, as verify's baseline
   does). Keep the test only if it **fails genuinely** (assertion failure, not a setup,
   import or collect failure; `failure.py` decides). A test that passes on the buggy code
   is not about this bug. A test that fails on setup proves nothing. Both are dropped
   into the notes.
3. **Run the kept tests against the fix.**
   - All pass: the fix stands, and the kept tests are attached to the suggested patch
     as extra regression tests.
   - Any fail genuinely: the fix goes back to `fix` with the failing test name, its
     claim and the failure excerpt. **This counts as a fix attempt** (max 3, as
     today). Kept counterexamples are re-run on every later attempt.

Only a failing counterexample can send a fix back, so a wrong objection cannot replace a
correct fix. Under v4, b680c643's first (oracle-passing) fix would have ended as a
suggested fix with a reviewer note.

**Known gap (accepted):** rule 2 drops a test that *passes* on the buggy code. So a pure
regression ("the fix breaks input Y, which worked before") cannot be proven this way; it
becomes a note. That is the intended trade: today's regression objections were the
wrong ones. If notes later show real regressions slipping through, a second test kind
("passes before, fails after") can be added behind its own flag.

### Graph change

`verify → review → [challenge] → risk_gate`:

- `review` returns `{verdict: approve | reject_drift | counterexamples, counterexamples:
  [{path, name, code, claim}] (≤ 3), notes: [str]}`.
- `challenge` is a code node, routed to only when counterexamples were proposed. It
  sends the fix to `fix` (attempt + 1) or on to `risk_gate`.
- A run out of attempts escalates with the failing counterexamples in the escalation.
- `request_changes` disappears from the schema; the eval report's "review verdicts" line
  becomes `approve / reject_drift / counterexamples (kept k, failed f)`.

### Prompt (review.v4.md, draft for your approval)

Same inputs as v3 (context, app, signal, finding, repro test **source**, diff,
verification). Changed sections:

> **Your job is to find evidence, not to give opinions.** You may do exactly one of:
>
> - `approve`: you looked for an input the finding says should work that this diff does
>   not handle, and found none.
> - `reject_drift`: the finding or diff does not fix the symptom the signal reports
>   (rules as before). This is the only reason to reject.
> - `counterexamples`: up to 3 tests, each a concrete input from the class the finding
>   describes that the fix still gets wrong. Write each as a complete test file in the
>   same framework and directory as the reproduction test, reusing its imports and
>   setup. Each must fail on the original code for the reported reason and, by your
>   reading, still fail with this diff. Give each a one-line claim.
>
> Code runs your tests. A test that passes on the original code, or fails on setup, is
> discarded. Only a test that still fails with the fix sends it back. Do not propose
> tests about style, naming, constants or code you would have written differently.
> Those go in `notes`, which reach the engineer but never block the fix.

The examples are rewritten from v3's synthetic ones (pagination pageSize 0, phone
separators, date-parse drift). None come from a golden case, so the leak test still
holds.

## Expected cost per case

Measured today: one review.v3 call is about 6k input and 1.6k output tokens on Gemini
2.5 Pro, about **$0.024**. One fix attempt is about $0.09, plus verify time.

| | review.v3 (today) | review.v4 (estimate) |
|---|---|---|
| Review call | $0.024 | $0.035 (repro source in the input, ≤ 3 test files out: +3k in, +1.5k out) |
| Running counterexamples | – | $0 model; sandbox time: ally-be/python about 1–2 min, ally-web about 3–6 min (one Vitest file, twice) |
| Extra fix attempt when a counterexample fails | – | about 30% of reviewed cases × ($0.09 fix + $0.035 re-review) ≈ $0.04 |
| Request-changes attempts it removes | today 2/8 verdicts | −($0.09 + $0.024) on those cases |
| **Per case that reaches review** | ≈ $0.03 | **≈ $0.06–0.08** |
| **Per case across a 19-case run** (6–8 reach review) | – | **+$0.01–0.03 per case, ≈ +$0.3–0.5 per run** |

Wall clock: +2–6 min per reviewed case, mostly ally-web. That fits the new 75-min
ally-web budget.

## How to test it (when approved)

- Unit tests with fakes: approve → risk_gate; reject_drift → escalate; a counterexample
  that passes on the buggy code is dropped; a setup failure is dropped; a counterexample
  that fails on the fix → fix (attempt + 1) with the failure text; kept tests re-run
  on the next attempt; notes reach the suggested-fix report; ≤ 3 enforced; scrubbed.
- No paid run until you say so. The first paid check is the 6 dev cases that reached
  review today (≈ $3, about 1 h on 2 shards), then the full dev set.

## Results: built 2026-11-13 (1cec611da), first check run 43444467830 ($3.14)

The 7 dev cases that reached review in run 43368994787, re-run with review.v4 and
`output_mode: suggested_fix`:

| Case | Verdicts | ce p/k/f/d | Ended | Oracle | Before (review.v3) |
|---|---|---|---|---|---|
| ally-be-89d8e055 | counterexamples, approve | 1/1/1/0 | suggested fix, 2 attempts | fail | PR, fail |
| ally-web-9299e9aa | approve (note: magic number 20) | – | suggested fix | fail | escalated (wall clock) |
| ally-web-f35e117d | approve | – | suggested fix | fail | PR, fail |
| ally-ai-b680c643 | approve | – | suggested fix | **pass** | PR, fail |
| ally-web-e5ad37b3 | approve | – | suggested fix | pass | PR, pass |
| ally-ai-learn-1065743a | – | – | escalated (repro: collection error) | – | PR, pass |
| ally-be-99584ee6 | – | – | no bug (missed) | – | PR, fail |

- Fix pass among reviewed cases 2/5 (was 2/6). b680c643 flipped to pass, as predicted:
  no opinion could replace its correct first fix.
- The one counterexample was valid for the agent's own hypothesis (fullwidth brackets
  around audio tags) and broadened the fix. But the real bug is zero-width spaces, so
  the hypothesis was wrong and the oracle still fails. Counterexamples cannot correct a
  wrong hypothesis that the report allows.
- No disputes (0 of 5 reviewed runs).
- The two losses (1065743a, 99584ee6) happened before review: reproduce and investigate
  vary between runs.
