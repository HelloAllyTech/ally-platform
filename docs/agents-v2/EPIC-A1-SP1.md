# Epic: A1 + SP1 — owners only, login only, and safe declines

> What's next, and the only work in this session. Two briefs, built in order in one Claude Code session: `chunk-a1.md`, then `chunk-sp1.md`. Fast mode: finish tonight (16 Nov). <!-- docs-path-lint: planned -->

## Where things stand

- **On master:** everything up to and including the fast track (Slice 1, Stage 1, H0, 15a, 3b, 5a, 6, 5b, 8a), merged before A1.
- **This epic** starts from master, on a new branch `feat/agents-v2-sprint-1`.

## 1. A1 — four items from Sandeep (`chunk-a1.md`, about 6 h)

1. **Every assistant has owners; only owners and the team they invite can view or manage it.** No view of all assistants anywhere, platform admins included; settings only platform admins could change move to owners.
2. **The WhatsApp number system** (Ally admin → Users → Platform admins): understand it and write `WA-NUMBERS-REPORT.md` with a deprecation plan. Nothing hidden or removed yet.
3. **Not logged in:** the login screen, no sign-up, then back to the link.
4. **Chatbots out of Ally admin's navigation;** Ally admin can create **Chatbots only** logins, who see nothing else.

No stops in A1.

## 2. SP1 — safety packs, clean declines (`chunk-sp1.md`, about 3 h)

On the medical, pharmacy and minors packs, a decline is short and stops: no symptom lists, no explaining a test or medicine, no services list, no continuing a minor's sign-up. The onboarding eval goes from 9 of 13 to 13 of 13. Also the 3a joke case.

**One stop:** the new pack lines, sent to Shehbaz while building continues.

## Rules for the session

- One session, A1 then SP1. Never `--no-verify`. Never run live evals alongside Docker Playwright.
- If something will clearly push past tonight, say which part and stop it there rather than rushing.

## Not in this epic

Share by mobile number (dropped for now). Hiding the WhatsApp number system (after the report). After this: 6b booking polish and live steps, then R2 review and refactor (briefs kept in the project, not in this session).

## Done when

- [ ] A1's and SP1's "Done when" lists are ticked
- [ ] `CHUNK-A1-NOTES.md`, `CHUNK-SP1-NOTES.md`, their Progress rows <!-- docs-path-lint: planned -->
