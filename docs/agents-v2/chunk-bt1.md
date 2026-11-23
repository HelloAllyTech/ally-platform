# Chunk BT1 — Book by tap

> Brief for Claude Code. Read `CONTEXT.md`, `ROADMAP.md`, `chunk-ui1.md` (§2 structured replies), `CHUNK-06B-NOTES.md` (live steps, confirmation cards), `CHUNK-H1-NOTES.md` (consent in the gateway, the confirm path), `CHUNK-Q4-NOTES.md` (G5: the consent question and cards), `FIXES-22NOV.md` (R5), then this file. Plan briefly. <!-- docs-path-lint: planned -->
> Branch: `feat/agents-v2-bt1` from master **after Q4 light is merged**. Tag commits `[BT1]`. Repos: ally-be (most), ally-web (bot page, bubble, Try it), ally-ai (the parts the agent returns).
> **Two stops:** (1) a design pass: screenshots at 1440 and 390 of slot chips, the confirmation card, a done card with Cancel and Move, and the WhatsApp list and buttons (as a mock), before building it all; (2) every new fixed text (button labels, card lines, the WhatsApp fallback), in one file. About 2.5 days.

## Why

Every booking failure in rounds 5–8 was the model turning free text into a write: "Shall I book 0 on…", asking for a yes twice, the wrong free slots, "1pm then" taken as a yes, "for Try it" in the question, the name or date dropped. Tapping takes the model out of those steps: the choices come from the list, the confirmation is built in code from the entry, and the yes is a tap tied to exactly that entry. Typing still works as today (Q4 fixed that path); taps are the main path on the bot page, the bubble and WhatsApp.

## 1. What the visitor sees (bot page, bubble, Try it)

- **Slot chips.** When the assistant offers times (any `find_*` on a list people book into: slots, shifts, event places), the reply carries chips built **from the tool result, never from the reply text**: "Sun 29 Nov · 10:00", "11:00"… with the venue once above them. Up to 8, then "More times". Full slots never appear.
- **The confirmation card.** Tapping a chip (or the agent offering one exact entry) shows a card built in code from the entry: what, when (day, date, time), where, how many ("1 place"), for whom (the person's name, or the other person's for someone else), and the list ("Bandra Sunday food drive"). Buttons: **Confirm** and **Change**. No zero or default values, no "Try it", no field keys.
- **Confirm** writes it through the gateway and list rules, with the tap as the consent (no model call), then shows the done card and one fixed line in the person's language ("Done: you're registered for Sun 29 Nov at 11:00, Bandra West station."). **Change** shows the chips again.
- **Done cards** (the 6b cards, titled by list kind from Q4 G5: "Booked", "Registered", "Callback requested", "Application received") show date, time and venue, and carry **Cancel** and **Move** where the list allows them. Cancel shows its own confirmation card ("Cancel your registration for Sun 29 Nov at 11:00?" → Confirm / Keep it); Move shows chips, then a confirmation card naming both times.
- **Details lists** (callbacks, applications, volunteer sign-ups): when the agent has the details, it offers the card ("Callback request: Asha Test, Mon 23 Nov, evening, 98000 00007" → Confirm / Change). Change lets the person correct a field inline or by typing.
- **Try it:** the same cards, marked "Test, not saved".
- **Suggested next questions:** up to 3 chips after an answer, from the starter questions and what the assistant can do (small; drop if it slows the block).

## 2. How it works (no model in the write)

- **The agent returns structured parts** beside its reply (as UI1 §2 describes): `slots` from find results, `offer` from the consent offer (`list-consent.ts` `offerFor`: its key, its question, the entry's display values). ally-be builds the cards from these, never from the reply text, and drops any part it can't trace to a tool result.
- **A tap sends an action, not words:** `{choose: recordId}`, `{confirm: offerId}`, `{change: offerId}`, `{cancel: entryId}`, `{move: entryId}`. Each action carries a token signed for this conversation and this person, valid for 30 minutes, single-use.
- **Confirm** checks the token and the stored offer (same key, same person, entry still valid: the slot still free, the limit not reached), writes through the same list engine and gateway as the agent (rules, per-person scoping, idempotency key = offer id), stores the consent record, and returns the done card. A second tap returns the same result, never a second write. A slot taken in the meantime returns "That time was just taken" and fresh chips.
- **The conversation keeps it:** each tap is stored as the visitor's message ("Confirmed: Sun 29 Nov 11:00") so the agent sees it in history next turn, and memory can use it.
- **Safety stays first:** a typed message between taps goes through the crisis check as always; a crisis reply never carries chips or cards.

## 3. WhatsApp

- **Slots as a list message** (up to 10 rows), **Confirm / Change as reply buttons** (up to 3), done cards as text with Cancel and Move as buttons. Button and list replies carry the action ids; ally-be handles them exactly like bot-page taps.
- **Inside the 24-hour window only** (interactive messages are free-form replies); outside it, or if sending fails, the same content as numbered text ("Reply 1, 2 or 3"), and a typed number counts as the choice.
- Typing still works.

## 4. Lists it covers

Every list people book into or leave details in: slots and appointments, shifts and shift bookings, events with places (registrations), tables, classes, site visits, callbacks, applications, volunteer sign-ups, leads. One mechanism, not per-list code.

## Tests

- Tap path: chips match the free entries exactly; Confirm writes once with consent (a replayed or double tap writes nothing more); another person's or an expired token is refused; a taken slot returns fresh chips; Cancel and Move each need their own Confirm.
- No write ever happens from a tap without a stored offer; no card shows a value the entry doesn't have.
- The RHA registration, Vandrevala callback, Akshaya Patra shift and BHIVE tour from rounds 6–8 done by taps on the bot page: each in at most 3 taps, the saved entry has the name, date, time and venue, and no model call on the Confirm step.
- WhatsApp: the list and button payloads (built and validated against Meta's limits), a button reply handled like a tap, the numbered-text fallback.
- Crisis between taps: the crisis reply, no chips.
- Playwright at 1440 and 390, light, axe clean: chips, the card, done cards with Cancel and Move, Try it's "Test, not saved".
- The use-case suite's booking and details conversations, typed and tapped: no worse typed, and every tapped one passes.

## Done when

- [ ] Slot chips, confirmation cards with Confirm / Change, done cards with Cancel / Move on the bot page, bubble and Try it
- [ ] Writes from taps go through the same rules and consent, once, with no model call
- [ ] WhatsApp list messages and reply buttons, with the numbered-text fallback
- [ ] Texts approved; `CHUNK-BT1-NOTES.md`, `PR-BT1.md`, the Progress row <!-- docs-path-lint: planned -->
