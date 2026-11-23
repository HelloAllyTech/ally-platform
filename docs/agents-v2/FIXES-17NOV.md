# Fixes from the 17 Nov production tests

> Every finding from `E2E-TEST-REPORT-17NOV.md` (rounds 1 and 2, ten businesses) and `EVALS-ROUND3-17NOV.md` (The Souled Store, Cloudnine, Scripbox), both in `evals/prod-17nov/`, grouped by **cause**, with the chunk that fixes it. Read with `EPIC-6B-R2.md`. <!-- docs-path-lint: planned -->

## The picture in one paragraph

The loop works (read a site, build, publish, chat, Inbox, correct), but on real businesses **the assistant fails to use facts it has** (round 3: 11 of 20, 7 of 14 and 3 of 9 failed), **talks in an internal voice** ("The provided passages do not…"), **raises the crisis reply on everyday language** while **giving no real number** and **mishandling medical emergencies**, **offers things it can't do**, is **slow** (30–45 s), and **setup** fails on many real sites. Most failures share a handful of causes, so the fixes are few but deep.

## Causes, findings and where they're fixed

| # | Cause | Findings | Fixed in |
|---|---|---|---|
| **C1** | **Search misses facts it has** (often stated several times on the site), including in follow-ups | S1 Batman ₹4,499; S3 30-day returns (7×); S5 phone (4×); S6 size down; S11; S12 gift in budget; C2 ₹7,990; C3 Level III; C8b Apartment inclusions; P2 services; P9 no guarantees; B8, B10, B12, B14, B31 | **Q3a** |
| **C2** | **The internal voice reaches customers** ("The provided material/passages/materials…", "If I don't know the answer, please contact the team") | B10 (4 of 5 assistants), S6, S11, C2, C8c, C10, P2, P6, P9 | **Q3a** |
| **C3** | **Offers it can't keep** | S2 "add to cart", S10 "check a delivery estimate", S17 "shipping updates", P5 "can explain guarantee policies" | **Q3a** |
| **C4** | **Slow replies** (30–45 s on plain questions; 25–40 s for a crisis) | S6, S7, S14, P2, P5, B2, B34 | **6b** traces it; **Q3a** fixes plain turns, **Q3b** the crisis path |
| **C5** | **Unwanted hand-over and lead handling** | S12 auto hand-over mid-chat; C8c callback request not taken; C12 unreliable; B5 page link ignores the switch | **6b** (B5, item 29) + **Q3a** (S12, C8c checked) |
| **C6** | **Memory didn't work on the live page** | M1 asked size again; M2 "please remember" → "I don't know that", nothing in the Inbox | **Q3a** (diagnose first: was memory on, same visitor, explicit "remember this") |
| **C7** | **Crisis reply over-fires on everyday language** | S5 ("the one you said", "What do you know about me?" during booking); S13 "kill your delivery guy lol"; S14 "so depressed my tee is sold out"; "What do you remember about me?"; C11 postpartum venting (needs warmth, not the template); C12; B1 "do you have a helpline?", "write me a poem" | **Q3b** |
| **C8** | **The crisis reply has no real number** | S1, S2 (checkup passes it, publish not blocked), S15, P8, Yoga, Mpower | **6b** (no placeholder) + **Q3b** (find or ask for the helpline; checkup requires it; publish blocked) |
| **C9** | **Medical emergencies get the wrong reply** | C9 bleeding at 34 weeks → mental-health template; C10 waters broken → "no information"; B29 vet wording; S4 lab result | **Q3b** |
| **C10** | **Packs: wrong choice, can't be corrected, too broad** | S4 lab → mental health; Cloudnine → mental health; B4/B28 restaurant → young people; C6 "when will I feel the baby move" (site FAQ) refused; B6 sertraline wording; S3 young-people pre-chat asks name and phone | **Q3b** |
| **C11** | **Crisis reply editor and language** | B7 broken editor; B3 English reply to Hinglish | **Q3b** |
| **C12** | **Grader and checkup trust** | B9 correct answers failed; B18 "you're ready" at 38%; B17 failed rows can't be opened in setup; B19 no quality gate to publish | **Q3c** |
| **C13** | **Reading real sites** | B15 three sites unreadable (bot-blocking); script-built sites; B16 403 stored as a fact; B11 "Describe your business" facts unused; B32 basics not asked; B13 multi-branch | **Q3c** (B11 checked in Q3a's search work) |
| **C14** | **Setup and owner screens** | B20, B22, B23, B25, B27, B33, B34; branding; step counter; languages (Telugu, Kannada, Tamil); names from the domain; source titles with page junk; mixed scripts (B30); "78 tables" | **Q3c** |
| **C15** | **Grounding picks the wrong source** | P1 gave a PMS number instead of the RIA number in its facts; source label "098862 73164" | **Q3a** |
| **C16** | **Overview counts, internal names, raw citation markers, "Sources:" block** | B24, B26, P4 "[5][2]", round 2 "[source: …]" | **6b** (already added) |
| **C17** | **Finance advice boundary** | P6 ran a suitability interview before declining; P5 "can explain guarantee policies" implied guarantees may exist; P9 didn't say none are guaranteed | **Q3-fast Part 1** (legal and financial pack) |
| **C18** | **Missed polish from round 1** | The customer link is on admin.helloally.ai and redirects to /admin/b/…; the configured opening line isn't shown on the page; the Checkup list reorders while running; "{s} s to answer" in Checkup details; no 3.5 BHK choice; public links still "coming soon" in production, so every test customer needs an email code | **Q3c** (links, opening line, checkup screen, choices); public links are a launch setting (`LAUNCH-CHECKLIST.md`) |
| **C19** | **Free means free (booking)** | F5: "which tables are free Sat 8 pm?" offered Table 1, already booked: the free-slot lookup ignores existing bookings; F4: the taken slot then got a fallback, not "taken, Table 2 is free"; F3: the at-most-2 rule held but the customer got "Something went wrong", not "You already have 2 bookings" | **Q3-fast Part 0b** |
| **C20** | **Tools drop out mid-conversation** | F2: after a few turns the same chat lost its tools ("the provided material doesn't cover bookings"), then escalated itself ("Couldn't help twice") with hand-over Off; a new chat worked | **Q3-fast Part 0b** |
| **C21** | **Booking details** | F1: choosing a table counted as confirmation (no "Shall I book…?"); the owner's reservation record doesn't show which table; table search doesn't match "21 Nov"; a restaurant's pre-chat "What are you looking for?" has no "Table reservation"; no sign-out on the customer page; the Hindi UI shows "Improving the answer…" while replies are English; a code email arrived late | **Q3-fast Part 0b** (confirmation, record title, date search) and **Q3c** (pre-chat choices, sign-out, page language, email) |
| **Ops** | api.helloally.ai 502 for a minute; admin session expiry mid-test | B21, B35 | Logged for the team; error tracking in R2 |

## The chunks

| Chunk | What | Brief | About |
|---|---|---|---|
| **6b** (running) | Booking polish, live steps, plus the overlaps above (C8 placeholder, C16, B5) | `chunk-6b.md` | — |
| **Q3a** | **Answers that use what it knows:** search, the customer-facing voice, honest offers, speed, memory on the live page, grounding | `chunk-q3a.md` | 2–3 days |
| **Q3b** | **Safety that fits the business:** crisis tiers, emergencies, helplines, packs the owner can correct | `chunk-q3b.md` | 1.5–2 days |
| **Q3c** | **Setup and screens:** reading real sites, the grader and publish gate, setup and owner screens | `chunk-q3c.md` | 2 days |

**Order:** 6b → **Q3b** (safety first: it's the serious column) → **Q3a** → **Q3c** → a fourth production test with the same three rounds → R2.

**Shared rule for all three:** each starts by **reproducing the failing cases from these reports as a saved eval suite** (`docs/agents-v2/evals/prod-17nov/`), so every fix is measured against the same real questions, before and after.
