## BT1: act by tap

People choose, confirm, cancel and move by tapping, on the bot page, the website bubble, Try it, the Build test pane and WhatsApp. Choices come from list lookups, the confirmation card is built in code from the entry, and Confirm writes once through the same list rules and consent as the agent, with no model call.

**Deploy after `fix/agents-v2-crisis-india`** (ally-ai first): Medical-pack assistants can't answer with SB1 until ally-ai takes the longer safety block.

### What people see
- **Chips** from a lookup (times with their day and time, services, centres, shifts, updates), up to 8; one entry as a card.
- **A card to confirm** any add or change (bookings, registrations, callbacks, applications, shift bookings, donor enquiries, questions for the team, support tickets, leads) with **Confirm** and **Change** (**Keep it** for a cancel).
- **Done cards** titled by list ("Registered", "Callback requested"…) with **Cancel** and **Move** where the list allows them, each confirmed.
- **Up to 3 next questions** after an answer; **English / हिंदी / Hinglish** at the start when the assistant speaks both.
- **Try it** and the Build test pane: the same cards, "Test only, not saved".
- **WhatsApp:** list messages and reply buttons; the numbered text when they can't be sent, where a typed number counts.

### Safety
- Signed, single-use tokens (30 minutes, this person, this chat).
- Every tap passes the access, credit and crisis gates a typed message does; a crisis reply carries no chips or cards and drops the pending card.
- No write without a stored offer; a second Confirm replays the first, never writes twice.
- A tapped "Cancel" on WhatsApp is never read as STOP.

### Results
Local, one run of the template conversations and the business bookings and leads by taps: **13 of 14**, each saved once on Confirm, at most 3 taps (`evals/usecases/results/2026-11-24-bt1-taps-final.md`). The miss: Goonj's "How can I donate?" answered without a lookup, so no card. Playwright at 1440 and 390, axe clean. WhatsApp live after deploy (Sukoon).

Screenshots: `docs/agents-v2/screenshots/bt1/`.

### Tests
- ally-be: `src/chatbot/actions/test/` (tokens, parts, Confirm and its replay, a chip keeping earlier answers, plain reasons, WhatsApp payloads and taps), the time named once in `list-consent.spec.ts`; full suite passing.
- ally-web: `ActByTap.test.tsx`, `e2e/actByTap.e2e.ts`.

### Copy
Every new text in `ally-be/src/chatbot/actions/action-copy.ts`, approved 24 Nov. Hindi and Hinglish drafts listed for a native speaker in `CHUNK-BT1-NOTES.md`.

Notes: `docs/agents-v2/CHUNK-BT1-NOTES.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
