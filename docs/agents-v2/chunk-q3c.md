# Chunk Q3c — Setup and screens that hold up on real businesses

> Brief for Claude Code. Read `CONTEXT.md`, `FIXES-17NOV.md` (causes C12–C14), the reports in `docs/agents-v2/evals/prod-17nov/`, `CHUNK-20A-NOTES.md` and `CHUNK-20A2-NOTES.md` (the reader, setup, checkups, the judge), `CHUNK-12B-NOTES.md` (the bot page), then this file. Plan first. <!-- docs-path-lint: planned -->
> Branch: `feat/agents-v2-q3c` from master after Q3a is merged. Tag commits `[Q3c]`. Repos: all three.
> **Stops:** (1) the plan; (2) the judge's prompt changes and screenshots of the changed setup and screens at 1440 and 390. About 2 days.
> **Being built now through `EPIC-Q3-FAST.md`:** build only the items that epic keeps; use this brief for their detail. The rest stays here for later.


## 1. Reading real sites (C13)

- **Sites that block bots or need a browser:** apollodental.in, careerpoint.ac.in, motion.ac.in (403) and script-built sites load in a browser. Read them with a real browser fetch (the stack's Playwright) when the plain fetch fails or returns little text; respect robots.txt and a polite rate.
- **Never store an error page as a fact** (B16): 4xx, 5xx, "Forbidden", captcha and empty pages are detected and skipped, with "We couldn't read these pages" shown.
- **"Describe your business" and "Skip, I'll answer questions"** (B11, B32): ask the basics first (what the business is, where, what it offers, hours, contact), and every answer becomes an owner fact the assistant uses (checked against Q3a's search fix).
- **Multi-branch (B13):** when the owner says "only this branch", the others' facts are removed from what it knows (shown, with Undo), and setup stops asking about them.

## 2. The grader and the publish gate (C12)

- **False fails (B9):** an answer that contains everything the case asks for, with sources, passes; review the judge's rubric on the reports' cases and fix it (prompt change at the stop).
- **The message matches the score (B18):** "You're ready" only above the gate; otherwise "X of Y need a fix", with the list.
- **Failed rows open during setup (B17):** the answer, why it failed, and how to fix it (Answer it, Edit the expectation).
- **A quality gate to publish (B19):** at least 70% of non-safety questions passing and every safety question passing (Q3b's number rule included), or the owner confirms "Publish anyway" with the score shown.

## 3. Setup screens (C14)

- B20 retry automatically once on "Something went wrong" during design; B33 the name never becomes "unchanged"; B34 "Add it now" opens at once (no model round-trip); the step counter is stable (counts known steps only).
- **Branding:** "found your logo" only when one was used; never a raw file name; no wrong colours guessed from a single page.
- **Names:** from the business's name on the site, never the domain ("Indianaccent", "Lalpathlabs").
- **Languages:** add Telugu, Kannada, Tamil, Bengali, Gujarati, Punjabi and Malayalam to the reply languages; the language "OK" explains it needs a tick.
- **Topics typed in "Anything it shouldn't talk about?"** are saved.
- **Lists:** Site visits without listings offers "Add a listing" there and offers the projects the reader found as listings (B22); "This adds 78 time slots"; From after Until warns; restaurant defaults (evenings, all week); Make it yours isn't skipped.

## 4. Owner and customer screens (C14)

- **A team reply is never lost (B23):** after New chat, the page shows "You have a reply from the team" with a link to the earlier chat; the Inbox thread shows the reply at once.
- **Page language (B25):** the page's own language is a setting (default English); reply languages only change replies.
- **Try it opens ready (B27)** from the Tools wizard and the header.
- **Source titles** without page junk ("Close", "&amp;", payment-logo strings).
- **Deep links:** `?section=inbox` opens the Inbox.
- **The Overview** names only connected channels.
- **Mixed scripts (B30):** a reply in Tamil or Hindi never contains another script's words; a check flags and retries once.

## Tests

- The reader on the reports' sites (with permission and politely) and saved fixtures of a blocked and a script-built site; error pages never stored.
- The judge on the reports' cases: B9's correct answers pass; real fails still fail; the onboarding eval re-run.
- Unit and Playwright tests for every screen change at 1440 and 390, axe clean.

## Done when

- [ ] The three unreadable sites and a script-built site read; no error page stored
- [ ] The grader passes correct answers; the message matches the score; failed rows open in setup; the publish gate works
- [ ] The setup and screen items above, each with a test
- [ ] `CHUNK-Q3C-NOTES.md`, `PR-Q3C.md`, the Progress row <!-- docs-path-lint: planned -->
