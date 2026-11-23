# Like for like: 2026-11-22-baseline-1-regraded → 2026-11-23-after-A-1

The 11 assistants with replies in both runs. Before: 1 run(s); after: 1 run(s). In-data right counts each in-data question once per run (x of questions × runs).

| | Before | After |
|---|---|---|
| PASS · PARTIAL · FAIL | 141 · 96 · 9 | 144 · 95 · 7 |
| In-data right | 54/94 (57%) | 54/94 (57%) |
| Emergencies right | 26/26 | 26/26 |
| Conversations with a hard fail | 4 | 4 |
| Answers a hand-over replaced | 14 | 0 |

## Per assistant

| Assistant | Template | PASS · PARTIAL · FAIL before | after | In-data right before | after | Emergencies before | after | Hand-over replaced before | after |
|---|---|---|---|---|---|---|---|---|---|
| B3 The Souled Store | store | 15 · 11 · 0 | 16 · 10 · 0 | 6/10 (60%) | 6/10 (60%) | 2/2 | 2/2 | 1 | 0 |
| B2 Cloudnine Hospitals | clinic | 15 · 10 · 1 | 16 · 8 · 2 | 7/10 (70%) | 8/10 (80%) | 4/4 | 4/4 | 0 | 0 |
| B1 Dr Agarwal's Eye Hospital | clinic | 13 · 13 · 0 | 15 · 11 · 0 | 4/10 (40%) | 4/10 (40%) | 4/4 | 4/4 | 1 | 0 |
| B5b BHIVE Workspace | salon | 5 · 5 · 1 | 6 · 4 · 1 | 4/5 (80%) | 4/5 (80%) | 0/0 | 0/0 | 0 | 0 |
| B5a 91springboard | salon | 14 · 9 · 0 | 13 · 10 · 0 | 7/10 (70%) | 8/10 (80%) | 2/2 | 2/2 | 0 | 0 |
| O1 iCall | helpline | 19 · 8 · 1 | 19 · 8 · 1 | 5/10 (50%) | 5/10 (50%) | 4/4 | 4/4 | 1 | 0 |
| O2 CanSupport | services | 17 · 9 · 1 | 18 · 8 · 1 | 6/10 (60%) | 6/10 (60%) | 3/3 | 3/3 | 2 | 0 |
| O3 Goonj | supporters | 20 · 7 · 0 | 21 · 6 · 0 | 7/10 (70%) | 8/10 (80%) | 2/2 | 2/2 | 3 | 0 |
| O5 Robin Hood Army | languages | 11 · 13 · 2 | 11 · 14 · 1 | 3/10 (30%) | 3/10 (30%) | 3/3 | 3/3 | 2 | 0 |
| O6 Goonj updates | updates | 7 · 7 · 0 | 6 · 7 · 1 | 1/2 (50%) | 0/2 (0%) | 1/1 | 1/1 | 1 | 0 |
| O5 Robin Hood Army: rha set | languages | 5 · 4 · 3 | 3 · 9 · 0 | 4/7 (57%) | 2/7 (29%) | 1/1 | 1/1 | 3 | 0 |

## In-data right per template

| Template | Assistants | Before | After |
|---|---|---|---|
| store | B3 The Souled Store | 6/10 (60%) | 6/10 (60%) |
| clinic | B2 Cloudnine Hospitals, B1 Dr Agarwal's Eye Hospital | 11/20 (55%) | 12/20 (60%) |
| salon | B5b BHIVE Workspace, B5a 91springboard | 11/15 (73%) | 12/15 (80%) |
| helpline | O1 iCall | 5/10 (50%) | 5/10 (50%) |
| services | O2 CanSupport | 6/10 (60%) | 6/10 (60%) |
| supporters | O3 Goonj | 7/10 (70%) | 8/10 (80%) |
| languages | O5 Robin Hood Army, O5 Robin Hood Army: rha set | 7/17 (41%) | 5/17 (29%) |
| updates | O6 Goonj updates | 1/2 (50%) | 0/2 (0%) |

## New baselines (no replies in the before run)

| Assistant | Template | PASS · PARTIAL · FAIL | In-data right | Emergencies right | Hand-over replaced |
|---|---|---|---|---|---|
| B4 Scripbox | finance_legal | 15 · 10 · 0 | 4/10 (40%) | 2/2 | 1 |
| O4 Teach For India staff | training | 23 · 1 · 2 | 10/10 (100%) | 0/2 | 0 |
