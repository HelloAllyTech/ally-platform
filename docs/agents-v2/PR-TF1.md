# TF1: one complete pass on five non-profits, and the fixes

One pass through the product as five fictional non-profits would use it (owner in the admin UI, people on the bot page and WhatsApp, a stranger), then two rounds of fixes: one issue per commit, each with a test, each re-run on a live local stack. Full list and results: `docs/agents-v2/ISSUES-TF1.md`. Notes, code map and the open questions: `docs/agents-v2/CHUNK-TF1-NOTES.md`. New wording, approved: `docs/agents-v2/TEXTS-TF1.md`.

## What changes for an owner

- **Create → Pick a template** offers the organisation and business templates, applied whole (purpose, safety pack, instructions, languages, lists, checkup).
- **Go live works in the UI**: the checklist reads what the form saved. Going live sets aside a $2 starting budget so the assistant answers people, and says so.
- **The safety pack a template or the owner chose survives Go live.**
- **A template's helpline number** is confirmed in Settings → Safety, next to the crisis reply.
- **The Inbox shows people**: one row per person, named by contact, with their other chats; replies go to the chat they're in.
- **Change by chat** edits the working copy the owner sees and publishes.
- **Checkup**: failed answers never read "Ready for clients".
- **Names**: the name typed in setup is used in Try it, the checkup, the page and the list card.
- **An organisation's own PDF** isn't held for its own contacts; a held file is approved where it was added.
- **Channels** says who can chat in one line; Staff onboarding goes live organisation-only.

## What changes for the people chatting

- **Safety**: a worry about a child gets the organisation's safeguarding procedure with 112 and Childline 1098, not the self-harm reply. A flood, a fire or someone trapped gets "call 112 and ask for rescue"; a collapse, an ambulance. The holding line after an emergency names 112. A paused page shows the crisis information.
- **WhatsApp**: no one is asked for the number they're writing from; a typed yes confirms the card shown; contacts are named.
- **Bookings and requests**: "what did I book?" finds their own entries in a new chat; a template's examples are never offered; a Confirm tap shows the done card with Cancel and Move; a person can withdraw their own open request even while the owner's Change is Never.
- **Memory**: on for Services, Donors and Staff onboarding, with a one-line notice and "say 'forget me' any time" (adults; young people are still asked). A yes to a booking is never taken as a memory answer. **Needs a DPDP legal check before outside users** (notes).
- **Answers**: Hindi questions find English entries; no citation markers; no internal documents named as sources; no "Reply STOP" on the web.

## Risk and roll-back

- **No migrations.** Request lists gain a "withdrawn" status on new installs only.
- **New behaviour** sits behind the existing switches (credits enforcement, the go-live gate, the PII review). Memory's notice is a per-template setting (`memory_notice`).
- **A route moved**: T1's setup apply is now `POST /v1/bot-drafts/:id/use-case` (it shared a path with the library templates and was never reached). The admin app uses the new path.

## Checks

- **ally-be**: typecheck clean; ESLint clean on changed files; jest 20,138 passed, 1 unrelated (passes alone).
- **ally-web admin**: typecheck clean; ESLint clean on changed files; touched tests pass.
- Known failures that aren't from this branch are listed in the notes.
- **Existing specs changed**: three expected the old wording that the approved texts replace (two "Reply STOP" notices, one invite line).

## After merge

- DPDP legal check on the memory notice before outside users.
- ally-ai prompt owner: change by chat's false refusal (F8) and "I've noted…" before consent (F10).
- The "After launch" list in the notes (F7, F18, P4–P12, P14, the withdrawal wording).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
