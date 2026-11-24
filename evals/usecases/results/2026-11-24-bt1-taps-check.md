# Use-case suite: 2026-11-24-bt1-taps-check

2026-11-24T09:51:01.002Z · setup `2026-11-22` · 1 run(s) · not graded

| Set | In-data right (x of runs) | PASS · PARTIAL · FAIL | Hard fails | Emergencies right | Slowest emergency | False alarms | Actions complete | Status line (median) | First words (median) | Reply (median) | Conflicting facts |
|---|---|---|---|---|---|---|---|---|---|---|---|
| b3-tss | 0/0 (–) | 0 · 0 · 1 | 2 | 0/0 | 0.0 s | 0/0 | 0/1 | 0.0 s | 4.4 s | 10.7 s | 0 |
| b4-scripbox | 0/0 (–) | 0 · 1 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 0/1 | 0.0 s | 2.2 s | 2.2 s | 0 |
| b5-91springboard | 0/0 (–) | 0 · 0 · 1 | 2 | 0/0 | 0.0 s | 0/0 | 0/1 | 0.0 s | 3.3 s | 3.9 s | 0 |
| b2-cloudnine | 0/0 (–) | 0 · 0 · 1 | 2 | 0/0 | 0.0 s | 0/0 | 0/1 | 0.0 s | 7.6 s | 13.2 s | 0 |
| b5-bhive | 0/0 (–) | 0 · 0 · 1 | 2 | 0/0 | 0.0 s | 0/0 | 0/1 | 0.0 s | 3.5 s | 4.0 s | 0 |
| o1-icall | 0/0 (–) | 2 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 2/2 | 0.0 s | 0.0 s | 0.0 s | 0 |
| o2-cansupport | 0/0 (–) | 1 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 1/1 | 0.0 s | 4.4 s | 5.8 s | 0 |
| o3-goonj | 0/0 (–) | 0 · 0 · 2 | 14 | 0/0 | 0.0 s | 0/0 | 0/2 | 0.0 s | 1.4 s | 1.4 s | 0 |
| o4-tfi-staff | 0/0 (–) | 0 · 0 · 1 | 1 | 0/0 | 0.0 s | 0/0 | 0/1 | 0.0 s | 2.1 s | 2.8 s | 0 |
| o6-updates | 0/0 (–) | 0 · 0 · 1 | 3 | 0/0 | 0.0 s | 0/0 | 0/1 | 0.0 s | 1.3 s | 1.3 s | 0 |
| o5-rha | 0/0 (–) | 1 · 0 · 0 | 0 | 0/0 | 0.0 s | 0/0 | 1/1 | 0.0 s | 6.0 s | 8.4 s | 0 |

## b3-tss

**Hard fails**

- b3-t1: none of offer on the reply
- b3-t1: tap: no "confirm" on the last reply

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b3-t1 | action | F |  | none of offer on the reply · tap: no "confirm" on the last reply |

## b4-scripbox

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b4-t1 | action | P | Done: you've asked for a callback (Interested in starting a SIP). | leads: 0 entries (expected 1) |

## b5-91springboard

**Hard fails**

- b5a-t1: none of choices on the reply
- b5a-t1: tap: no {"chip":1} on the last reply

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b5a-t1 | action | F |  | none of choices on the reply · tap: no {"chip":1} on the last reply |

## b2-cloudnine

**Hard fails**

- b2-t1: none of offer on the reply
- b2-t1: tap: no "confirm" on the last reply

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b2-t1 | action | F |  | none of offer on the reply · tap: no "confirm" on the last reply |

## b5-bhive

**Hard fails**

- b5b-t1: none of choices on the reply
- b5b-t1: tap: no {"chip":1} on the last reply

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| b5b-t1 | action | F |  | none of choices on the reply · tap: no {"chip":1} on the last reply |

## o1-icall

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o1-t1 | action | P | Done: you've asked for a callback (9800000007). |  |
| o1-t2 | action | P | Shall I request a callback for Ravi Test about 9800000017, any time? |  |

## o2-cansupport

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o2-t1 | action | P | Done: your application is sent (Ravi Test). |  |

## o3-goonj

**Hard fails**

- o3-t1: fallback reply
- o3-t1: not answered: error
- o3-t1: none of entry, choices on the reply
- o3-t1: none of offer on the reply
- o3-t1: tap: no "confirm" on the last reply
- o3-t2: fallback reply
- o3-t2: not answered: error
- o3-t2: none of entry, choices, suggestions on the reply
- o3-t2: none of offer on the reply
- o3-t2: tap: no "confirm" on the last reply

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o3-t1 | action | F |  | fallback reply · not answered: error · none of entry, choices on the reply · none of offer on the reply · tap: no "confirm" on the last reply |
| o3-t2 | action | F |  | fallback reply · not answered: error · none of entry, choices, suggestions on the reply · none of offer on the reply · tap: no "confirm" on the last reply |

## o4-tfi-staff

**Hard fails**

- o4-t1: none of offer on the reply

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o4-t1 | action | F | Done: it has been sent to the team (Can I carry over unused leave to next year? I'm Nisha Test, nisha@example.com.). | none of offer on the reply |

## o6-updates

**Hard fails**

- o6-t1: fallback reply
- o6-t1: not answered: error
- o6-t1: none of entry, choices on the reply

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o6-t1 | action | F | Sorry, I couldn't answer that just now. Please try again, or contact Goonj: 39999163028 / priyanka@goonj.org. You are chatting with an AI assistant. The AI and people at Goonj may read this chat. This is an automated ass | fallback reply · not answered: error · none of entry, choices on the reply |

## o5-rha

| Case | Kind | Runs | Last reply | Problems |
|---|---|---|---|---|
| o5-t1 | action | P | Done: you're registered for Sun 29 Nov 2026, 12:00, Bandra West station, skywalk exit. |  |
