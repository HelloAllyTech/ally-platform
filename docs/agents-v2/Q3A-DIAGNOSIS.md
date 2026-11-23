# Q3-fast Part 2: why answers fail (Stop 2)

18 Nov 2026. This file explains why the assistants built from real businesses' sites miss
facts those sites contain. It lists the fixes, ranked by how many of the reports' cases each
one fixes. Nothing below is built yet. Stop 2 is to agree the order.

## How this was measured

**Assistants.** The seven businesses from the 17 Nov reports were rebuilt locally from their
public websites. The build ran through the real setup flow: reading the site, learning facts,
the pack, the purpose, the checkup and publishing.

- The script was `ally-ai/scripts/onboarding_eval.py --sites docs/agents-v2/evals/prod-17nov/sites.json`.
- This replaced a production export. Nothing was taken from production.
- The local checkups scored 25 to 53%. Production scored 16 to 50% on 17 Nov, so the copies
  show the same problem.

**Differences from production:**

- The Souled Store refused the reader after 22 pages (95 pages returned an HTTP error).
- Two facts named in the reports are no longer on the sites:
  - Neemrana's 25% room advance;
  - Indian Accent's Delhi hours (on no page the reader could read).

  The cases for those use what the sites say today.
- Lists the owners typed in by hand (Honer's listings, The Souled Store's TSS-1001) aren't in
  the copies. The cases that need them are left out here.

**Cases.**

- The suite is `ally-be/src/chatbot/basics/cases/prod-17nov-answers.json`: 30 cases.
- 22 cases were already there: The Souled Store, Cloudnine and Scripbox.
- 8 cases are new, from the reports:
  - Mpower B9 and B12;
  - Indian Accent B8 and B13;
  - Honer B10;
  - Neemrana B31 and check-in.

**Evidence** is in `evals/prod-17nov/runs/`:

| What was measured | File |
|---|---|
| Every case's reply, run once before any change | `p2-before-answers.txt` |
| Each case's facts and question, run against the assistant's own index, with the rank by meaning and by keyword (`ally-ai/scripts/answers_diagnosis.py`) | `p2-before-search-ranks.txt` |
| Where the setup's learned fact for that case would rank, scored the same way | `p2-before-fact-ranks.txt` |
| The agent's own steps (each search and what it kept, the check) for the failures where search looked fine (new `--trace` flag on the basics runner) | `p2-before-traces.txt` |

## Results before any change

- **15 of 30 cases pass.** Replies may differ from run to run: tss-S2, S11 and sb-P9 passed on
  a second run. The before and after comparison will therefore be 3 runs each.
- **Speed is already inside the target.** The median reply took 7.8 s and the slowest 13.8 s.
  The target is under 12 s and under 20 s, so speed work is not needed (see "Not needed").

## What goes wrong, case by case

| Case | Fact | Rank by meaning (keyword) | What happened |
|---|---|---|---|
| tss-S1 Batman ₹4,499 | in pages | 7 (5) | Cut: only 5 passages are kept. The learned fact would rank **1st** (0.72 against 0.50) |
| tss-S3 30-day returns | in pages | 2 (1) | The agent's own search kept the Terms clause, not the returns line. It answered with "restrict accounts with high returns". The learned fact ranks **1st** |
| tss-S6 size down | not in what was read | – | Asked "which hoodie?" **without searching** |
| tss-S12 Batman gift | in pages | none in 20 | Asked "clothing or accessories?" twice instead of suggesting. Then "what if it doesn't fit?" was sent back, searched again and declined: no returns passage. The learned facts rank **1st** for both turns |
| tss-S11 COD, not in data | – | – | Sometimes asks "which product?" instead of saying plainly it doesn't know, with the contact |
| cn-C2 ₹7,990 plan | in pages | none in 20 | Not found. The learned fact ranks **2nd** (0.59 against the best passage's 0.58) |
| cn-C6 18–25 weeks | in pages | none in 20 | Answered from general knowledge (16–20 weeks), no source. The learned fact ranks **1st** |
| sb-P1 RIA number | in pages | none in 20 | The PMS page (INP…) outranks it. The source label "098862 73164" was given as the contact (C15). The learned fact ranks 1st among facts (0.62) |
| sb-P2 services | in pages | 16 (2) | Partly right. A keyword search finds it at 2 |
| sb-P9 none guaranteed | rule | – | "The pages shown do not state guaranteed products", instead of the pack's "no product is guaranteed" |
| mp-B12 therapies and address | in pages | none in 20 | Two questions in one message: one search, and the Mumbai address never came back |
| ia-B13 both seatings | in pages | 1 | The passage it kept had only the second seating, because the hours are split across two chunks. The learned fact (both seatings in one line) ranks **2nd** |
| ho-B10 ₹8,499/sq ft | in pages | none in 20 | Declined. The learned fact ranks **2nd** |

## Causes, and the fixes ranked by cases fixed

1. **The facts setup learns are never searched.** Setup reads the site into short, sourced
   facts ("Honer Aquantis in Gachibowli… ₹8,499 per sq ft"). The owner checks them, and the
   checkup is written from them, but the assistant only searches the raw pages.
   - **Fix:** index each learned fact (and Owner notes, already a document) as its own short
     passage, with the page it came from as its source, so citations stay real.
   - **Cases it fixes:** tss-S1, S3, S12 (both turns), cn-C2, cn-C6, sb-P1, ia-B13, ho-B10.
     That's **8–9 cases**, and probably most of the checkup's own failures, which are written
     from these facts.
   - **Where:** ally-be, at publish and when a fact changes. The facts go into the
     assistant's knowledge chunks as a "What we learned" document, one chunk per fact.
2. **It asks "which one?" instead of answering what it can, sometimes without searching
   first.**
   - **Fix:** one prompt line: search first; when the information answers in general, answer
     in general and then offer to narrow down; ask only when nothing can be said without
     knowing.
   - **Cases it fixes:** tss-S6, S12, S11 (and the S1/S2/S7 clarifications seen in other
     runs). That's **3 cases**, more counting the flaky runs.
   - This is prompt text, so it goes to Stop 3.
3. **A keyword search beside the meaning search.** Weaviate's `bm25_search` is already in
   `weaviate.py`.
   - **Fix:** merge the two rankings.
   - **Cases it fixes:** sb-P2, and cn-C8's ambulance turn: **1–2 cases** not covered by
     fix 1. It also helps exact names and numbers (TSS-1001, INA…).
   - **Measure first:** do it only if the suite gains after fix 1.
4. **Two questions in one message get one search** (mp-B12).
   - **Fix:** a prompt line ("a message with two questions: search for each").
   - **Cases it fixes:** **1 case.** Stop 3.
5. **The right number, not the label (C15, sb-P1).**
   - **Fix:** a phone number is accepted in a reply only if it appears in the cited passage's
     text, never only in its title or label. This goes in the check (`fixes.py`); the
     milestone 1 `business_contact` covers the contact part.
   - **Cases it fixes:** **1 case** (the number part of sb-P1).
6. **Finance "none are guaranteed" (sb-P9).**
   - The legal and financial pack v2 says it, but a decline reply doesn't carry it.
   - **Fix:** with that pack, a question about guarantees is answered "None of our products
     guarantee returns", never declined.
   - **Cases it fixes:** **1 case.** Pack text, so Stop 3.

**What the fixes add up to:**

- Fixes 1 and 2 together should take the suite from 15/30 to about 26/30.
- That's about 87%, against the epic's target of 85% on in-data cases.
- Fixes 3–6 are worth doing only if they still fail after 1 and 2.

## Not needed, or not now

- **Tuning `TOP_K`, `MAX_PASSAGES` and `DECLINE_SIMILARITY`.**
  - Only tss-S1 is a cut by the 5-passage limit, and fix 1 covers it.
  - No case was declined by the similarity gate. Every search returned 8 hits.
  - So the numbers stay the same unless the after-run shows otherwise.
- **Speed.**
  - Already a median of 7.8 s and a worst of 13.8 s.
  - So `SEARCH_AGAIN` and the forced re-search stay as they are.
  - In tss-S12 the re-search found 0 new passages and then declined. Fix 1 removes that path.
- **Sites that refuse the reader** (The Souled Store after 22 pages). This is cut for now in
  the epic (Q3c).

## Questions for you at this stop

1. Build fix 1 (index the learned facts) and fix 2 (answer before asking) first, then re-run 3
   times before deciding on 3–6?
2. Fix 1 changes what assistants already live know, once they're re-indexed. A one-off
   re-index would go in `LAUNCH-CHECKLIST.md` (the "re-index production" step the plan
   already has). Agree?
