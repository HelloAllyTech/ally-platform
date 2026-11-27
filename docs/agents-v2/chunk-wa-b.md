# Chunk WA-B — WhatsApp outbound foundation (ROADMAP Phase 2, Stage B)

> Brief for Claude Code. Read `CONTEXT.md`, `ROADMAP.md`, `WHATSAPP-GAPS-PLAN.md` (Stage B), `CHUNK-ASSISTANTS-NOTES.md` (SB1: credits, the WhatsApp window, end persons, quick replies with STOP locked), `CHUNK-BT1-NOTES.md`, `CHUNK-TF1-NOTES.md`, then this file. Plan briefly. <!-- docs-path-lint: planned -->
> Branch: `feat/agents-v2-wa-b` from master. Tag commits `[WA-B]`. **Runs in parallel with WA-A and WA-C** (decided 25 Nov): see "Boundaries".
> **Speed over polish** for the internal launch; safety, opt-out and "no message without the right to send it" are never relaxed. **One stop:** every new fixed text, in one file. About 3 days alone; aim for 1.5 with the parallel plan.

## Why

Every pilot asks for reminders first. Today Ally can only reply inside the 24-hour window. Stage B lets Ally message people first, safely: approved templates, contacts with consent, one send engine that respects the window, opt-outs and quiet hours.

## Boundaries (three sessions in parallel)

- **WA-B owns:** a new module `ally-be/src/whatsapp/outbound/` (templates, send engine, scheduler jobs), contacts' new fields and tags, the opt-in ledger, their migrations, the admin screens **Templates** and **Contacts** under Channels → WhatsApp, and one new method `sendTemplate` on the Meta provider.
- **WA-A owns:** inbound media, transcription, status webhooks and Inbox ticks, the typing indicator, business-scoped IDs. **WA-C owns:** `ally-be/src/whatsapp/campaigns/` and the Campaigns screen.
- **First commit, within the first hour, pushed at once:** `ally-be/src/whatsapp/outbound/outbound.types.ts`, the interfaces WA-C builds against: `OutboundSender.send(request): SendResult`, `SendRequest` (chatbot, contact, template or free text, variables, purpose: `reminder | confirmation | follow_up | campaign`, idempotency key, not-before time), `SendResult` (sent, skipped with a reason, failed with a reason, cost estimate), `ContactQuery` / `Segment` (by list entries, tags, last chat, opt-in), and `TemplateRef`. Change them later only additively. <!-- docs-path-lint: planned -->
- Only one session uses the live Docker stack at a time; otherwise unit tests and recorded webhooks.
- Merge order: WA-A, WA-B, WA-C. Rebase on master before the PR.

## 1. Templates in Ally

- **Sync** existing templates and their status from Meta (the six submitted by hand: appointment_reminder, booking_confirmed, callback_followup, event_update, optin_confirmation, application_received).
- **Create, submit, edit and resubmit** from Ally: name, category (Utility by default; Marketing only on purpose), language versions, body with `{{n}}` variables and sample values, quick-reply buttons. Status from the template-status webhook (pending, approved, rejected with Meta's reason).
- Variables map to fields Ally knows (the person's name, the assistant's name, an entry's date, time, place).

## 2. Contacts and consent

- Contacts get **name, tags, custom fields**, the channel and the source; **CSV import** with a preview and a column mapping; segments from list entries ("booked for tomorrow"), tags and last chat.
- **Opt-in ledger:** when, how (in chat, a form, imported with the owner's statement of how they agreed), for what purpose, and opt-outs. Import requires the owner to state how the contacts agreed (the opt-in policy decision is the owner's).
- STOP (any language the assistant reads) opts out at once; SB1's locked STOP quick reply stays the source of truth.

## 3. One send engine

- Every business-initiated message goes through `OutboundSender`: inside the 24-hour window free text is allowed; outside it an **approved template** is required. Checks at send time: opt-in for the purpose, not opted out, **quiet hours** (default 9 pm–8 am in the assistant's time zone), not in an at-risk conversation (crisis wins: no reminder to someone flagged in the last 24 hours), credits (SB1), the number's daily limit. Each skip is recorded with its reason.
- Idempotency key per message; retries only on transient errors, with backoff; pacing to the daily limit.
- Health reminders say only the time and place, never the reason for the appointment.
- Without a Meta payment method, sends outside the window fail at Meta: show that reason plainly.

## 4. First uses (each a switch per assistant, off by default)

- **Booking confirmation** right after a booking (inside the window: free text; otherwise `booking_confirmed`).
- **Reminder the day before** an appointment, shift or registration (`appointment_reminder`, with Confirm / Change / Cancel buttons handled like BT1 taps).
- **Callback follow-up** if a callback request is still open after its time (`callback_followup`).

## Tests

- The engine: window, template required, opt-out, quiet hours, at-risk skip, credits, idempotency (a retry never sends twice), pacing; each skip reason.
- Template sync and status updates from recorded webhooks; payloads validated against Meta's limits.
- CSV import with a bad row; STOP in English, Hindi and Hinglish.
- The reminder job: one reminder per entry, the day before, in the assistant's time zone; a reminder's button tap goes through BT1's action path.
- Live (after deploy, once the payment method is in): a reminder reaches Person B's phone the day before, outside 24 hours, once.

## Done when

- [ ] Templates synced, created and tracked; contacts with tags, CSV import, opt-in ledger
- [ ] The send engine with every check, used by confirmations, reminders and follow-ups
- [ ] Texts approved; `CHUNK-WA-B-NOTES.md`, `PR-WA-B.md`, the Progress row <!-- docs-path-lint: planned -->
