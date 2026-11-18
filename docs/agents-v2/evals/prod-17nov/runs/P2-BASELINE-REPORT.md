# Answers on the local copies: baseline report (18 Nov 2026)

This report gives the answer quality before any Part 2 fix, measured on local copies of the
seven 17 Nov businesses. It builds on `docs/agents-v2/Q3A-DIAGNOSIS.md`, with more cases,
three runs per case, and a meaning judge beside the text patterns.

## What was tested

- **Assistants.**
  - The seven businesses were rebuilt from their public websites through the real setup flow
    (`sites.json`, `onboarding_eval.py --sites`).
  - Nothing came from production.
  - Their own checkups scored 25 to 53%, against 16 to 50% in production on 17 Nov.
- **Cases.** 46 cases from `prod-17nov-answers.json`, each run **3 times** (138 conversations,
  147 graded replies).
  - 30 cases are from the reports: The Souled Store, Cloudnine and Scripbox's round 3, and
    B8, B9, B10, B12, B13 and B31.
  - 16 are new. They come from facts each copy learned, so that Mpower, Indian Accent, Honer
    and Neemrana have 5 to 7 cases each instead of 1 to 3.
- **Grading.**
  1. Every reply was checked by the case's text patterns and by a meaning judge
     (gpt-6-luna, temperature default, eval only). The judge got the question, what a good
     reply must do, and the reply.
  2. The two disagreed on 21 of 147 replies. Each disagreement was read and settled by hand:
     - **The judge was right on 12.** The patterns were too loose: tss-S7 found
       "Machine Wash" inside a decline; tss-S12's last turn passed although it declined;
       cn-C8 passed on vague replies; cn-C6 gave 18 to 20 weeks against an expected 18 to 25.
       Or the patterns were too strict: mp-B12, sb-P2 and tss-S8 were correct in other words.
     - **The judge was wrong on 6.** mp-helpline: the number really is a crisis helpline.
       mp-cancel: the 24-hour charge is in the data. tss-M2: with memory off, "I can't
       remember between chats" is the designed honest reply.
     - **1 is borderline and counted as not passing.** tss-S11 gave the contact but didn't
       say plainly that it doesn't know.
  3. A case passes a run only if every graded turn in that run passes.

## Results

| Business | Cases | Passed run 1 / 2 / 3 | Every run | 2 of 3 or better |
|---|---|---|---|---|
| The Souled Store | 14 | 8 / 9 / 7 | 7 | 8 |
| Cloudnine | 4 | 1 / 2 / 1 | 1 | 1 |
| Scripbox | 4 | 2 / 2 / 2 | 2 | 2 |
| Mpower | 7 | 4 / 3 / 5 | 1 | 5 |
| Indian Accent | 6 | 2 / 4 / 4 | 2 | 4 |
| Honer Homes | 5 | 3 / 4 / 3 | 3 | 3 |
| Neemrana | 6 | 3 / 3 / 5 | 3 | 3 |
| **All** | 46 | 23 / 27 / 27 | 19 | 26 |


- **The rate per run is 50 to 59%,** whichever run you look at: 23, 27 and 27 of 46 cases.
- **Only 19 of 46 (41%) pass every time.** 26 pass at least 2 of the 3 runs.
- **In-data questions** (the fact is on the site) **get the right answer in 68 of 120 runs
  (57%).** The epic's target is 85%.
- **Results vary from run to run.** 12 cases pass only 1 or 2 runs out of 3, so one run alone
  can be off by about 4 cases. Use 3 runs for the before and after comparison.
- **Speed is fine.** Replies took 7.8 s at the median and 13.8 s at the slowest (the first,
  30-case run).

## Every case

| Case | Runs passed | What the expected answer is |
|---|---|---|
| tss-M2 | 1/3 | memory: 'please remember' is confirmed, not declined |
| tss-S1 | 0/3 | in data: Batman high tops ₹4,499 |
| tss-S10 | 3/3 | not in data: shipping to Pune, honest, real contact, no estimate offer |
| tss-S11 | 2/3 | not in data: cash on delivery, honest with contact |
| tss-S12 | 0/3 | multi-turn: Batman gift in budget, no hand-over, returns |
| tss-S16 | 3/3 | order lookup with no order: asks for order number or points to care |
| tss-S2 | 3/3 | in data: Orbit backpack ₹3,299, no cart offer |
| tss-S3 | 0/3 | in data: 30-day returns |
| tss-S4 | 3/3 | in data: prices include taxes |
| tss-S5 | 3/3 | in data: customer care phone and email |
| tss-S6 | 0/3 | in data: oversized fit, size down |
| tss-S7 | 0/3 | in data: machine wash |
| tss-S8 | 3/3 | in data: membership non-refundable mid-way |
| tss-S9 | 3/3 | in data: card details not stored |
| cn-C2 | 0/3 | in data: 3-month antenatal fitness ₹7,990 |
| cn-C3 | 3/3 | in data: Level III NICU |
| cn-C6 | 1/3 | in data (site FAQ): baby movements 18 to 25 weeks, sourced |
| cn-C8 | 0/3 | multi-turn: Apartment package inclusions and ambulance |
| sb-P1 | 0/3 | in data: SEBI RIA number |
| sb-P2 | 3/3 | in data: services |
| sb-P5 | 3/3 | in data: no guaranteed returns |
| sb-P9 | 0/3 | in data: none guaranteed |
| mp-B12 | 1/3 | in data (B12): therapies and the Mumbai centre's address |
| mp-B9 | 3/3 | in data (B9): works with children and adolescents |
| mp-CBT | 2/3 | in data (B12): CBT is offered |
| mp-book-delhi | 2/3 | in data: Delhi booking number |
| mp-cancel | 2/3 | in data: cancel 48 hours ahead |
| mp-helpline | 2/3 | in data (B1 false alarm): the 24x7 helpline number, no crisis reply |
| mp-hours | 0/3 | in data: Mumbai centre 9 am to 8 pm |
| ia-B13-dinner | 0/3 | in data (B13): both Mumbai dinner seatings |
| ia-B8-address | 3/3 | in data (B8): the Delhi address |
| ia-mum-reserve | 2/3 | in data: Mumbai reservations phone or email |
| ia-nyc-dinner | 0/3 | in data: New York dinner hours 5 pm to 10 pm |
| ia-nyc-hold | 2/3 | in data: New York holds a table 15 minutes |
| ia-private | 3/3 | in data: Delhi private dining for 10 to 40 |
| ho-B10 | 0/3 | in data (B10): Aquantis price per sq ft |
| ho-possession | 1/3 | in data: Signatis phase 1 possession Dec 2026 |
| ho-rera | 3/3 | in data: Signatis RERA P02200005923 |
| ho-sizes | 3/3 | in data: Aquantis 3 BHK 1,610 to 1,965 sq ft |
| ho-vaastu | 3/3 | in data (site FAQ): all 3 BHK are 100% Vaastu compliant |
| ne-B31 | 1/3 | in data (B31, as the site now says): advance for weddings |
| ne-address | 3/3 | in data: Neemrana Fort-Palace address |
| ne-checkin | 3/3 | in data: Tijara check-in and check-out |
| ne-glasshouse | 3/3 | in data: Glasshouse on the Ganges check-in 2 PM |
| ne-preshoot | 1/3 | in data: pre-wedding shoot at Tijara 80,000 |
| ne-spa | 0/3 | in data: spa open 8 am to 8 pm |

## Why they fail

These are the same causes as `Q3A-DIAGNOSIS.md`. The new cases fit them.

1. **"I don't have it" when setup learned it.** mp-hours, ne-spa and ho-possession failed every
   run, or nearly. The fact is among the learned facts ("MPOWER - THE CENTRE (MUMBAI) is open
   9:00 am - 8:00 pm", "The Neemrana Spa is open daily from 8.00 am to 8.00 pm"), but the
   assistant only searches page text.
2. **Half an answer when a fact is split across page chunks.** ia-B13 gave only the second
   seating and ia-nyc-dinner only Friday and Saturday. The learned fact has the whole line.
3. **Asking "which one?" instead of answering.** tss-S6, tss-S12, and cn-C8 in some runs.
4. **The wrong passage wins.**
   - tss-S3 answers with the Terms clause about high-return accounts, not the 30-day policy.
   - sb-P1 gives the PMS number and a page label as the contact.
5. **Pack wording.** sb-P9 says "the pages don't state guaranteed products", not "none are
   guaranteed".

**Needs checking:** ne-preshoot answered ₹25,000 where the learned fact says ₹80,000 for Tijara.
The site may list both, a starting price and a per-property price.

## How sure these numbers are

- **The rates are solid to about ±4 cases,** given the run-to-run spread and the hand review
  of disagreements.
- **The per-business rates rest on 4 to 7 cases each.** They show where problems are, not a
  precise score per business.
- **The copies are close to production, not the same:**
  - The Souled Store refused the reader after 22 pages.
  - Two report facts have left the sites.
  - Owner-typed lists (TSS-1001, Honer's listings) aren't in the copies.
- **The judge is not the product's checkup judge.** It's a separate eval-only grader, used
  here only to catch the patterns' mistakes.

## Files

All in this folder:

- `p2-base3-answers.txt`: every reply, all 3 runs.
- `p2-base3-judged.jsonl`: the judge's verdict and reason for each reply.
