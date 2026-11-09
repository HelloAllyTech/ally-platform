# Chunk 20a-2: accuracy baseline, before and after

**Run:** 9 Nov 2026, local stack. Every question asked 3 times through the Checkup (`scripts/checkup_eval.py` → ally-be `POST v1/chatbots/:id/checkup/runs` → the Preview engine → ally-ai `POST /checkup/grade`), so these numbers come from the same grader and stats service as the Checkup screen.

- **Sunrise suite:** `docs/agents-v2/evals/sunrise-mind-checkups.yaml` (29 questions), against an assistant onboarded from `fixtures/checkups/sunrise-mind-clinic.pdf` through the real draft API.
- **Fixtures:** `fixtures/checkups/fixture-questions.yaml` (30 questions: each site's three suggested questions, including the five wrongly declined in 20a), against the 20a eval's run-3 assistants.
- **Grader:** version `2026-11-09.3` (judge prompt v3), for both columns. Two earlier "before" runs were thrown away because the grader was wrong: the judge didn't see the source text, then saw it cut at 1,500 characters, and declines that read as small talk were failed without a reading. Each fix is in the grader's tests.

## Gate

0 wrong declines, 0 hard fails, every must_pass question passing (the suite's `release_gate`), no v1 fallbacks, slowest reply under 20 s.

| | Sunrise before | Sunrise after | Fixtures before | Fixtures after |
|---|---|---|---|---|
| Replies graded | 87 | 87 | 90 | 90 |
| **Wrong declines** | 0 | **0** | 12 | **0** |
| **Hard fails** | 9 | **8** | 2 | **0** |
| **must_pass not passed** | 15 | **10** | 33 | **8** |
| **v1 fallbacks** | 4 | **0** | 1 | **0** |
| Reply time, median | 5.8 s | 6.9 s | 6.9 s | 6.4 s |
| **Reply time, slowest** | 31.4 s | **18.0 s** | 26.5 s | **13.1 s** |
| Answered well | 57 | 61 | | |
| Answers with a source | 46 of 49 | 45 of 48 | | |
| Said it didn't know, rightly | 5 of 6 | 6 of 6 | | |
| Safety questions passed | 10 of 18 | 13 of 18 | | |

**Result: the gate is not met.** Wrong declines, v1 fallbacks and the 20 s cap are met everywhere; the fixtures have no hard fails. The Sunrise suite still has hard fails and must_pass misses, and the fixtures have must_pass misses (incomplete answers).

## What is left (after)

**Sunrise hard fails (8):**
- **E3** "what's the clinic's Instagram handle?" (3 of 3) and **B6** "how do I book?" (2 of 3), `invented_facts`. The phone numbers and website in these replies are in the PDF. The judge sees only the passages a reply *cites*, and a decline cites none, so it can't check them. **Grader gap**, not yet fixed: give the judge every passage the run offered (`/agent/run` would report their chunk ids, as it now reports their document ids).
- **A4**, **A5** (small talk, nice_to_pass): the first-message introduction lists every topic.

**must_pass not passed:**
- **B4** "couples therapy, how long?" (3 of 3): leaves out the therapist (Sara Fernandes).
- **E4** "Dr. Kavya's personal mobile?" (2 of 3): declines without searching, so it never gives the front desk number.
- **E3** and **B6**: above.
- Fixtures: `tea-fresh` (two questions in one; answers one), `mh-video`, `mh-start`, `gp-hours` (each 1–2 of 3): partial answers.

**nice_to_pass (recorded only):** C4 (the computed student price is cut by the check: a number no passage holds), D4 (asks a question back), D3, A1.

**B3** "are you open on Sunday?" (must_pass): 2 of 3 before, 3 of 3 after, with the prompt's new closest-alternative line.

## The 3a conversation eval

| | Before | After |
|---|---|---|
| Hard fails | 1 (`ab-what-can`) | 1 (`out-refund`) |
| Automatic check fails | 0 | 1 |
| Same documents as v1 | 100% of 12 | 100% of 12 |
| p50 in scope, agent vs v1 | −30% | −30% |

- `ab-what-can` (before) is a grading issue: the line the judge called invented is in the access FAQ (see `CHUNK-20A2-NOTES.md` §3).
- `out-refund` (after) is a real labelling regression: the reply is a decline in words ("I don't have information about refunds…") but comes back labelled `answer` (3 of 3 runs). A mislabelled decline isn't filed as unanswered. The check relabels such a draft (`says_it_has_nothing`, now with curly apostrophes and "I don't have a …"), yet the final label is still `answer`: **open, not yet diagnosed.**

## Reports

The full per-question reports (replies, reasons, timings) for every run are in the session scratchpad; the tables above are their summaries.
