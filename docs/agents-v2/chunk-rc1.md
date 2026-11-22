# Chunk RC1 — Before real customers (ROADMAP block 1.4)

> Brief for Claude Code. Read `CONTEXT.md`, `ROADMAP.md`, `NEXT-STEPS-20NOV.md`, `LAUNCH-CHECKLIST.md`, `CHUNK-06B-NOTES.md` (erasure reaching list entries), `CHUNK-08A-NOTES.md` (memory, Forget), `CHUNK-12-NOTES.md` and `CHUNK-12B-NOTES.md` (contacts, pre-chat questions), `CHUNK-SP1-NOTES.md`, `CHUNK-Q3-FAST-NOTES.md` ("Known, not fixed here"), then this file. Plan briefly. <!-- docs-path-lint: planned -->
> Branch: `feat/agents-v2-rc1` from master **after Q4 light is merged** (decided 20 Nov: one session at a time). Tag commits `[RC1]`. Repos: all three, mostly ally-be and CI. About 2.5 days.
> **Stops:** (1) the plan; (2) any customer-facing text (the consent line, export and erase screens), in one file.

## 1. Tests that actually run (first)

- **Postgres in CI:** add a Postgres service to `.github/workflows/test-ally-be.yml` so the Postgres specs stop skipping (consent before a write, the spend cap, plans and seats, lists, erasure).
- **Fix the eight red ones** listed in `CHUNK-Q3-FAST-NOTES.md` ("Known, not fixed here"), including erasing a contact. Each fix says what was wrong.
- CI must be green with them running before §2 builds on erasure.

## 2. Privacy (21a; India's DPDP Act)

- **Export a person's data:** from the Inbox's person panel ("Download their data") and an owner API: profile and contact details, memory lines, conversations, list entries they made or are named in, files, consent records, as one JSON file plus CSVs. Owners and editors only; logged.
- **Erase a person** end to end: contact, conversations, memory, summaries, list entries they own (or their personal fields blanked where the entry must stay, such as a past booking the business keeps), files, search and vector entries, caches. `usage_events` keep costs but no personal data. A test checks nothing about the person can be found afterwards. A person can ask on WhatsApp or the bot page ("delete my data"); it becomes a request the owner confirms in the Inbox (not automatic).
- **Retention:** per assistant, conversations and memory kept for N days (default 365; health packs 180), erased by a nightly job; shown in How it works.
- **Consent for web contacts:** the bot page and bubble record when a person accepted the disclaimer and which text version (pre-chat consent checkbox where the owner turned it on); WhatsApp opt-in recorded on the contact.

## 3. Seeing problems

- **Error tracking** on ally-be, ally-ai and ally-web (Sentry or the existing equivalent; check what's configured first), with personal data scrubbed (no message text, no phone or email).
- **A daily summary** to Ally (email and Slack) and, per assistant, to its owner (email, opt-out): conversations, fallbacks, failed runs by stage, refusals, hand-overs waiting, crisis replies (counts only), thumbs-down, spend against the cap. Anything unusual first.
- **Owner feedback:** "Tell us what's missing" in the account menu and beside thumbs in Try it and the Inbox, stored and listed for Ally admins.

## 4. Small open fixes

- With hand-over off, the assistant never promises "I'll pass it on".
- The Overview's "Handed to a person" counts hand-overs, not team replies.
- Hand-over summaries: one or two lines, the right channel.
- The 3a hard fail: a joke about a therapist is declined.
- Hindi strings marked "needs review": list them in one file for a native speaker (not changed here).
- **From the NGO baseline (P2, front end):** signing in as a customer in the same browser logs the owner out (keep the two sessions separate); the stale published count ("8 of 20" vs "9 of 20") and "0 messages, last 30 days" on the assistants list after real chats; the bot page logo missing; the footer disclaimer not updated when the pack changes (BHIVE kept the mental-health line after Facts only); "Choose this" clicks in setup sometimes ignored; sources labelled with the page title, not "What we learned, Services and prices…"; setup asks about conflicting phone numbers and emails, not only hours.

## 5. Ready to launch

- **SP1's second onboarding run** (it was 8 of 13); the hold on medical, pharmacy and young-people assistants in `LAUNCH-CHECKLIST.md` lifts only if it passes.
- **A read-only launch check** (`npm run launch:check`): reports each `LAUNCH-CHECKLIST.md` item it can read from the environment and the database (queue URL set, reasoning effort, prompts published and their versions, backfills done, cap amounts, `sharedStoreWrites`, Turnstile keys), so Shehbaz can tick the list against production.
- **Docs a session reads first, brought up to date:** `CONTEXT.md` (flows and campaigns are no longer "don't build"; one run path; consent rule; plans and caps), the Progress table in `v2-chunks.md` (merged chunks marked merged), the docs `README.md`'s branch, and `ROADMAP.md`, `ROUND5-PLAN.md`, `FINAL-PLAN.md` committed (already committed by Q4; check they're current).

## Done when

- [ ] Postgres specs run in CI; the eight red ones fixed; CI green
- [ ] Export and erase a person end to end, retention job, consent recorded
- [ ] Error tracking on three apps; the daily summary; owner feedback
- [ ] The small fixes; SP1's second run; `launch:check`; docs current
- [ ] `CHUNK-RC1-NOTES.md`, `PR-RC1.md`, the Progress row, `LAUNCH-CHECKLIST.md` <!-- docs-path-lint: planned -->
