# Part 2, fix 1: the learned facts are searched (before and after, 18 Nov 2026)

**Fix 1** (from `docs/agents-v2/Q3A-DIAGNOSIS.md`):

- Publishing now writes the facts setup learned into a "What we learned" document, one short
  passage per fact.
- It's written with the Owner notes: before the setup checkup and at publish.
- It follows every later change to the facts.

Fix 2 (answer before asking "which one?") was skipped, as decided at Stop 2.

**Method.** The same as `P2-BASELINE-REPORT.md`:

- the same 46 cases on the same seven local copies, 3 runs each;
- every reply checked by the patterns and by the meaning judge;
- the judge's disagreements settled by hand.

The same hand rulings apply to both runs, so the comparison is like for like:

- **Patterns used, the judge misread the data:** mp-helpline, mp-cancel, ho-sizes (1,785 sq ft
  is real) and tss-M2 (memory off by design).
- **tss-S3:** "no questions asked" is in the data.
- **tss-S12, turn 1:** graded on its own turn.

## Results

| Business | Cases | Runs passed, before → after | Every run, before → after |
|---|---|---|---|
| The Souled Store | 14 | 24/42 → 30/42 | 7 → 9 |
| Cloudnine | 4 | 4/12 → 9/12 | 1 → 3 |
| Scripbox | 4 | 6/12 → 7/12 | 2 → 2 |
| Mpower | 7 | 12/21 → 17/21 | 1 → 5 |
| Indian Accent | 6 | 10/18 → 13/18 | 2 → 3 |
| Honer Homes | 5 | 10/15 → 9/15 | 3 → 3 |
| Neemrana | 6 | 11/18 → 15/18 | 3 → 5 |
| **All** | 46 | 77/138 (56%) → 100/138 (72%) | 19 → 30 |


- **Overall: from 56% to 72% of runs,** and from 19 to 30 cases passing every run.
- **In-data questions: from 57% to 72% of runs** (87 of 120). The epic's target is 85%.
- **The biggest gains** were the cases the diagnosis named:
  - Mpower: hours, B12, CBT and the booking number;
  - Cloudnine: C2 and C6;
  - The Souled Store: S1 (Batman ₹4,499), S3 (30-day returns) and S12 (now suggests the
    ₹4,499 high-tops in budget);
  - Neemrana: the spa hours and the pre-wedding shoot;
  - Indian Accent: both dinner seatings.

## What got worse, and why

- | tss-S2 | 3/3 | 2/3 ▼ |
- | tss-S4 | 3/3 | 0/3 ▼ |
- | tss-S5 | 3/3 | 0/3 ▼ |
- | mp-B12 | 1/3 | 0/3 ▼ |
- | ho-possession | 1/3 | 0/3 ▼ |
- | ne-B31 | 1/3 | 0/3 ▼ |

**One cause: crowding.**

- The agent keeps only 5 passages per search. Similar facts now take slots the right page
  used to get.
- **tss-S5:** two privacy-policy contact facts push out the page with the phone number, so it
  gives only emails.
- **tss-S4:** the membership "inclusive of GST" fact wins over "prices incl. of all taxes".
- **ho-possession and ne-B31:** they now decline. The right passage exists but isn't among the
  5 kept.

**Next, to measure the same way:**

- Keep 8 passages instead of 5 (`MAX_PASSAGES`). The diagnosis held this back until needed;
  it now is.
- Then fixes 3 to 6 as planned:
  - keyword search;
  - two questions in one message;
  - the right number (C15);
  - the finance "none guaranteed" wording.

## Every case

| Case | Before | After |
|---|---|---|
| tss-M2 | 1/3 | 1/3 |
| tss-S1 | 0/3 | 3/3 ▲ |
| tss-S10 | 3/3 | 3/3 |
| tss-S11 | 2/3 | 3/3 ▲ |
| tss-S12 | 0/3 | 3/3 ▲ |
| tss-S16 | 3/3 | 3/3 |
| tss-S2 | 3/3 | 2/3 ▼ |
| tss-S3 | 0/3 | 3/3 ▲ |
| tss-S4 | 3/3 | 0/3 ▼ |
| tss-S5 | 3/3 | 0/3 ▼ |
| tss-S6 | 0/3 | 0/3 |
| tss-S7 | 0/3 | 3/3 ▲ |
| tss-S8 | 3/3 | 3/3 |
| tss-S9 | 3/3 | 3/3 |
| cn-C2 | 0/3 | 3/3 ▲ |
| cn-C3 | 3/3 | 3/3 |
| cn-C6 | 1/3 | 3/3 ▲ |
| cn-C8 | 0/3 | 0/3 |
| sb-P1 | 0/3 | 0/3 |
| sb-P2 | 3/3 | 3/3 |
| sb-P5 | 3/3 | 3/3 |
| sb-P9 | 0/3 | 1/3 ▲ |
| mp-B12 | 1/3 | 0/3 ▼ |
| mp-B9 | 3/3 | 3/3 |
| mp-CBT | 2/3 | 3/3 ▲ |
| mp-book-delhi | 2/3 | 3/3 ▲ |
| mp-cancel | 2/3 | 2/3 |
| mp-helpline | 2/3 | 3/3 ▲ |
| mp-hours | 0/3 | 3/3 ▲ |
| ia-B13-dinner | 0/3 | 3/3 ▲ |
| ia-B8-address | 3/3 | 3/3 |
| ia-mum-reserve | 2/3 | 2/3 |
| ia-nyc-dinner | 0/3 | 0/3 |
| ia-nyc-hold | 2/3 | 2/3 |
| ia-private | 3/3 | 3/3 |
| ho-B10 | 0/3 | 0/3 |
| ho-possession | 1/3 | 0/3 ▼ |
| ho-rera | 3/3 | 3/3 |
| ho-sizes | 3/3 | 3/3 |
| ho-vaastu | 3/3 | 3/3 |
| ne-B31 | 1/3 | 0/3 ▼ |
| ne-address | 3/3 | 3/3 |
| ne-checkin | 3/3 | 3/3 |
| ne-glasshouse | 3/3 | 3/3 |
| ne-preshoot | 1/3 | 3/3 ▲ |
| ne-spa | 0/3 | 3/3 ▲ |

## Notes

- **A bug found while measuring, now fixed.** A new pasted document's content hash is stored
  only by its first ingest. Updating it in that window started a second, concurrent re-index
  of the same text. On 4 of the 7 copies that left the document marked failed, or with
  duplicate passages.
  - `KnowledgeBaseService.updateForChatbot` now never re-indexes identical text.
  - Owner notes had the same latent risk.
  - The 4 affected local documents were repaired by hand before this measurement.
- **Live assistants aren't changed.** They get the document only when published again.
  Production assistants will be recreated (decided at Stop 2), so there's no re-index step.
- **Files:** `p2-fix1-answers.txt` (every reply) and `p2-fix1-judged.jsonl` (the judge's
  verdicts).
