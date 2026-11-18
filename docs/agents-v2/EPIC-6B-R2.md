# Epic: 6b + R2 — reliable booking you can watch, then a clean core

> What's next after A1 and SP1 (merged into master, 17 Nov). Two briefs, one session each, in order: `chunk-6b.md`, then `chunk-r2.md`. <!-- docs-path-lint: planned -->

## Where things stand

- **On master:** everything through the fast track (8a), plus A1 (owners only, login only, assistants at `/assistants`, custom logins) and SP1 (clean declines on the health and minors packs).
- **Since A1:** access is members-only, so any eval or checkup token must belong to a user on the assistant's team.
- **Still due from SP1, before lifting the publish hold:** a second onboarding run and five probes per pack. 6b fixes several of the fails behind it (section F), so run them after 6b.

## 1. 6b — booking polish and live steps (`chunk-6b.md`, about 2 days)

After 6b, bookings and lead-taking can go on for pilots, and people can see the assistant working.
- **A. Booking:** "Nothing's free in the evening, the latest is 16:00"; no failed runs; median under 13 s; the same booking rules for every purpose that can book; a time confirmed a few turns back; "at 4" means 16:00; one retry after a bad id; no asking twice; no stray phrases; the `in_use` race; a time zone per assistant.
- **B. Hand-over:** no "I'll pass it on" when it's off; short summaries; the Overview's count.
- **C. Data:** erasure reaches list entries; tool searches logged.
- **D. Housekeeping:** the lint error, Host's decline, the wiki.
- **E. Live steps on the bot page and bubble:** step lines while it works, a "what I did" line and a confirmation card after, nothing during a crisis reply. WhatsApp unchanged.
- **F. From A1 and SP1's evals:** generic out-of-scope declines; a crisis reply that fits the assistant (112 / 108 on medical and pharmacy, never "supervisor"); the "Rs." cut-off; memory not announcing what it won't store; pharmacy's stock list; **taking a lead when it can't answer** (item 29); **example choices never reach visitors** (item 30).

**One stop:** every changed prompt and tool-description text in one Markdown file, plus screenshots of the live steps at 1440 and 390.

## 2. R2 — review and refactor (`chunk-r2.md`, about 2 days)

No behaviour change; every eval, checkup and prompt the same before and after.
- **A.** LangGraph used well (graph, state, the checkpointer decision, streaming, interrupts ready for 14a, tools, limits, tracing, upgrades).
- **B.** Readable code (boundaries, size, duplication, dead code, names and types, prompt assembly, tests).
- **C.** Easy to extend (a new tool, purpose, prompt section, approval pause, channel).
- **D.** **No repeated or unwanted API calls,** counted before and after for every common action.
- **E.** **Error tracking** in ally-ai and ally-be, with no personal data.
- **Part 3:** `ARCHITECTURE.md`, docstrings, a "where things live" table.

**One stop:** `R2-REVIEW.md` (findings and proposed changes, with the request counts) before refactoring.

## Rules

- One session at a time, each on its own branch from master; a PR after each. Never `--no-verify`. Never live evals alongside Docker Playwright.
- If another session has uncommitted work in the same checkout, don't touch it; run checks in a clean copy.

## After this epic

4a Workspace light → 16c the assistant map → 7a Roles light → 18a Templates light → 9a voice notes → 20e landing page and showcase. Before self-serve sign-up: 21a (privacy and caps), closing custom logins' extra routes, retiring the WhatsApp number system.
