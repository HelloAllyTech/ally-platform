# Use-case suite: 2026-11-24-bt1-taps-check2

2026-11-24T09:56:47.303Z · setup `2026-11-22` · 1 run(s) · not graded

| Set | In-data right (x of runs) | PASS · PARTIAL · FAIL | Hard fails | Emergencies right | Slowest emergency | False alarms | Actions complete | Status line (median) | First words (median) | Reply (median) | Conflicting facts |
|---|---|---|---|---|---|---|---|---|---|---|---|
| b2-cloudnine | 0/0 (–) | 0 · 0 · 1 | 2 | 0/0 | 0.0 s | 0/0 | 0/1 | 0.1 s | 4.3 s | 4.7 s | 0 |
| b4-scripbox | 0/0 (–) | 0 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/1 | 0.3 s | 2.4 s | 2.4 s | 0 |
| b3-tss | 0/0 (–) | 1 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 1/1 | 0.0 s | 2.0 s | 4.7 s | 0 |
| b5-91springboard | 0/0 (–) | 0 · 0 · 1 | 1 | 0/0 | 0.0 s | 0/0 | 0/1 | 0.0 s | 3.6 s | 3.7 s | 0 |
| b5-bhive | 0/0 (–) | 0 · 0 · 1 | 1 | 0/0 | 0.0 s | 0/0 | 0/1 | 0.0 s | 4.4 s | 4.8 s | 0 |
| o4-tfi-staff | 0/0 (–) | 1 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 1/1 | 0.0 s | 3.6 s | 4.1 s | 0 |

## b2-cloudnine

**Hard fails**

- b2-t1: none of choices on the reply
- b2-t1: tap: no {"chip":1} on the last reply

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b2-t1 | action | F |  | none of choices on the reply · tap: no {"chip":1} on the last reply |

## b4-scripbox

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b4-t1 | action | P | Done: it has been sent to the team (Leads). | callback_requests: 0 entries (expected 1) |

## b3-tss

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b3-t1 | action | P | Done: your request is sent (Damaged delivery - request for return/exchange). |  |

## b5-91springboard

**Hard fails**

- b5a-t1: tap: no {"chip":1} on the last reply

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b5a-t1 | action | F |  | tap: no {"chip":1} on the last reply |

## b5-bhive

**Hard fails**

- b5b-t1: tap: no {"chip":1} on the last reply

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b5b-t1 | action | F |  | tap: no {"chip":1} on the last reply |

## o4-tfi-staff

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o4-t1 | action | P | Done: it has been sent to the team (Can I carry over unused leave to next year? I'm Nisha Test, nisha@example.com.). |  |
