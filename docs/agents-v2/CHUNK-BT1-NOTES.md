# Chunk BT1 notes: act by tap

Branch `feat/agents-v2-bt1` from master (after Q4 #373 and SB1 #374). Brief: `chunk-bt1.md`. Built on SB1: taps pass its access, credit and crisis gates like a typed message; the cards live in its Build test pane and Try it.

## Result (local, 24 Nov)

The use-case suite's template conversations and the business bookings and leads, done by taps on the bot page, one run (`evals/usecases/results/2026-11-24-bt1-taps-final.md`, sets in `evals/usecases/sets-taps/`). Run on a local merge of this branch with `fix/agents-v2-crisis-india` (ally-ai's 12,000-character safety block, needed by Medical-pack assistants), ally-ai's image rebuilt.

| Use case | Taps | Saved | Result |
|---|---|---|---|
| O1 Helpline: callback request | 1 | 1 | pass |
| O1 Crisis between taps: the earlier Confirm after a crisis reply | 1 | 0 | pass (no parts on the crisis reply; the card asked again) |
| O2 Services: application | 1 | 1 | pass |
| O3 Volunteers: shift booking | 1 | 1 | pass |
| O3 Donors: ways to give, then a donor enquiry | 1 | 1 | **fail**: "How can I donate?" was answered from Goonj's documents without a lookup, so no card; the enquiry itself was saved by tap |
| O4 Staff onboarding: question for the team | 1 | 1 | pass |
| O5 Robin Hood Army: food-drive registration | 2 | 1 | pass |
| O6 Updates: the latest update as a card | 0 | – | pass |
| Dr Agarwal's: eye check-up | 2 | 1 | pass |
| Cloudnine: appointment | 2 | 1 | pass |
| BHIVE: tour (time, service, Confirm) | 3 | 1 | pass |
| 91Springboard: visit (time, service, Confirm) | 3 | 1 | pass |
| The Souled Store: support ticket | 1 | 1 | pass |
| Scripbox: lead | 1 | 1 | pass |

13 of 14. Every write happened once, on a Confirm tap, with no model call on that step; at most 3 taps. Playwright at 1440 and 390, light, axe clean: `ally-web/apps/ally-admin-dashboard/e2e/actByTap.e2e.ts`, screenshots in `docs/agents-v2/screenshots/bt1/`.

Not run: **WhatsApp live** (production doesn't have BT1; Shehbaz tests on Sukoon after deploy). WhatsApp is covered by unit tests: the list and button payloads against Meta's limits, a tapped row's id, a tapped "Cancel" never read as STOP, the numbered fallback and a typed number.

## How it works

- **Parts, never from text.** After a run, ally-be reads that run's `tool_runs` rows and builds the reply's parts: a write the gateway held for a yes (`needs_confirmation`) becomes a card from H1's stored offer (Confirm and Change; Confirm and Keep it for a cancel); a write it made gets Cancel and Move on the done card where the list allows them (an "update" tool on "Do it", a status with a cancel option, a related dated entry); a lookup becomes chips (each with its day and time) or one entry's card; a booking missing its service gets the services as chips; after an answer, up to 3 starter questions not asked yet. A crisis, blocked, held or fixed reply gets none.
- **Tokens.** A short random id and its HMAC; the claims wait in Redis for 30 minutes, bound to the conversation and the person (the shared contact; Try it's test chat has none). Short enough for a WhatsApp row or button id.
- **A tap is a message.** The page sends `{message: label, action: token}`; the token is redeemed, and what the tap stands for ("Confirmed: Sun 29 Nov 2026, 12:00") is stored as the person's message and answered after every gate a typed message passes (crisis keywords, access, credits, an off chatbot).
- **Confirm writes with no model call.** H1's offer now keeps the tool's input and the card from the dry run. Confirm replays it through the gateway (`AgentGatewayService.confirmOffer`): same tool, list rules, per-person scope, consent (the offer's id) and "Do it" check, as a run keyed by the offer, so a second tap replays the first one's result instead of writing again. Taken in the meantime: "That time was just taken" and fresh chips.
- **A chip keeps what the person already said.** A service chip on a booking that waited for its service carries that booking; tapping it proposes the write in code (`proposeWrite`: no consent, so the gateway stores an offer and the card follows), never re-asked by the model.
- **Every other tap** (a chip from a lookup, Change, Cancel, Move, a starter question) is answered like its words; the agent's write then hits the same consent gate, so it shows a card before anything is saved.
- **Crisis between taps.** A crisis reply drops the pending offer: a Confirm shown before it can't write.
- **WhatsApp.** List messages (up to 10 rows) and reply buttons (up to 3), checked against Meta's limits before sending; cards as text. If the interactive send can't go, the same choices as numbered text, and a typed number counts as the tap.
- **Reach more communities.** English / हिंदी / Hinglish at the start when the assistant speaks English and Hindi (any template, not only that one).

## Code map

| Where | What |
|---|---|
| `ally-be/src/chatbot/actions/action-copy.ts` | Every new fixed text (approved 24 Nov) |
| `ally-be/src/chatbot/actions/action-token.service.ts` | Tokens, the numbered list |
| `ally-be/src/chatbot/actions/action-parts.service.ts` | Parts from a run's tool results |
| `ally-be/src/chatbot/actions/actions.service.ts` | Taps answered in code: Confirm, a filled choice, Keep it, a dead button; `plainReason` |
| `ally-be/src/chatbot/actions/whatsapp-parts.ts` | Parts as a list message, reply buttons or numbered text |
| `ally-be/src/chatbot/agent-tools/agent-gateway.service.ts` | `confirmOffer`, `proposeWrite`, the shared `execute` |
| `ally-be/src/chatbot/agent-tools/list-consent.ts` | The offer's input and card; the booking question names the time once |
| `ally-be/src/chatbot/engine/chatbot-engine.service.ts` | Step 3, a tap, after every gate; a crisis reply drops the offer |
| `ally-be/src/chatbot/bot-page/bot-page-public.service.ts` | `{message, action}`, `final.parts`, `languageChoice` |
| `ally-be/src/chatbot/service/chatbot.service.ts` | Try it and the Build test pane: taps, parts, the done card "Test only" |
| `ally-be/src/whatsapp/provider/meta-whatsapp.provider.ts` | `sendInteractive`, a tap's id |
| `ally-be/src/whatsapp/service/whatsapp-inbound.service.ts` | Taps by id or number; interactive or numbered reply |
| `ally-web/apps/ally-admin-dashboard/src/botPage/components/parts.tsx` | `ReplyPartsView`, `TapButtons`, `PartCardView`, `TestOnly` |
| `evals/usecases/run.mjs`, `evals/usecases/sets-taps/` | Tap turns, the tap conversations |

New reply type `tap` (`WaHandledBy.TAP`): a tap answered in code. No migration.

## Decisions

- Taps reuse H1's consent gate instead of a second write path: the only write by tap is the replay of an offer the gateway stored and the card showed.
- Most taps go to the agent as words; only Confirm, a filled choice and Keep it are answered in code. A chip after a lookup still takes one model call, which turns it into the card.
- Labels come from the server (one copy file); the page renders them.
- Only the latest reply's buttons can be tapped on the page; older tokens still work for 30 minutes on WhatsApp (a row from an earlier list).
- SB1's "quick replies" are keyword auto-replies, not chips; BT1's chips come from the page's starter questions. Crisis and STOP stay locked as before.
- The language choice follows the assistant's enabled languages, not the template.

## How to test

1. Local stack, SB1 set up (`CHUNK-ASSISTANTS-NOTES.md` §3: migrations, credits, budgets). Slots on the eval assistants (owner API, list `slots`).
2. Bot page: `localhost:8081/b/robin-hood-army` → "Which food drives can I join? I'm Priya Test, 9800000011." → a time chip → Confirm → Cancel / Move.
3. Try it on the same assistant: the card says "Test only, not saved"; nothing in Lists.
4. `cd ally-be && npx jest src/chatbot/actions` · `npx playwright test e2e/actByTap.e2e.ts` (ally-web, Node 22) · `node evals/usecases/run.mjs --sets sets-taps --label <x>`.

## For a native speaker (Hindi and Hinglish drafts, approved for the internal launch)

All in `action-copy.ts`: `BUTTONS.hi` and `['hi-latn']` (पक्का करें, बदलें, रद्द करें, समय बदलें, रहने दें, और समय), `TAPPED` (पक्का किया: {title}; the change, cancel and move lines, which use चाहता/चाहती), `DONE_LINE` (ten lines each), `TAP_REPLY` (taken, expired, not yours, already, refused, refusedPlain, kept), `TEST_ONLY`, `WHATSAPP` (चुनें, विकल्प, नंबर लिखकर जवाब दें), and the language choice's कृपया हिंदी में जवाब दें।

## Open questions and later

- O3's "How can I donate?" is answered without a lookup, so no "ways to give" card. A later prompt change could prefer a lookup for a reference list; not built.
- A chip after a lookup takes a model call to become a card; filling it in code (like a service chip) would need the target list and its other required details.
- Parts are not stored with the message: a reload shows the text without its cards (their tokens would be stale anyway).
- WhatsApp: delivery status per message, and interactive sends from the Inbox's team replies, are Phase 2 (`WHATSAPP-GAPS-PLAN.md` Stage A).
- Found on the way, not BT1: Medical-pack assistants fail every run with SB1 unless ally-ai takes the longer safety block (`fix/agents-v2-crisis-india`); deploy ally-ai first.
