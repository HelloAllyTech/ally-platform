# Chunk WA-A — WhatsApp reply parity (ROADMAP Phase 2, Stage A)

> Brief for Claude Code. Read `CONTEXT.md`, `ROADMAP.md`, `WHATSAPP-GAPS-PLAN.md` (Stage A), `CHUNK-BT1-NOTES.md` (the interactive sends BT1 added to the Meta provider), `CHUNK-ASSISTANTS-NOTES.md` (SB1: the WhatsApp window, credits, access and crisis gates), `CHUNK-11A-NOTES.md` (the Inbox), then this file. Plan briefly. <!-- docs-path-lint: planned -->
> Branch: `feat/agents-v2-wa-a` from master (TF1 round 2 merged and released 26 Nov). Tag commits `[WA-A]`. **Runs in parallel with WA-B and WA-C** (decided 25 Nov): WA-A owns inbound media, transcription, the status webhooks and the Inbox ticks, the typing indicator and business-scoped IDs, and one new method `sendMedia` on the Meta provider. Don't touch `ally-be/src/whatsapp/outbound/` (WA-B) or `ally-be/src/whatsapp/campaigns/` (WA-C). Store each status by Meta message id so WA-C can read delivered/read later. Only one session uses the live Docker stack at a time. Merge order: WA-A first. Repos: ally-be (most), ally-web (Inbox), ally-ai (transcripts go through the same run as text).
> **Speed over polish** for the internal launch; crisis handling and "no write without a yes" are never relaxed. **One stop:** every new fixed text, in one file. About 1.5 days.

## Why

Today WhatsApp answers only typed text: a voice note or a photo gets "I can only read text messages", nothing but plain text and BT1's buttons can be sent, and the team can't see whether a reply was delivered or read. In India many people send voice notes first. Stage A closes the reply side before outbound (Stage B) starts.

## 0. First, two fixes carried over from TF1 (one commit and a test each)

1. **A late crisis verdict still flags and alerts.** When the crisis check answers after its wait and the verdict is at risk, the chat is flagged "May be at risk" and the crisis alert goes out, even though the reply has already been sent; it's logged. Today (production) the person gets a decline with 112 and 14416, but the team isn't told. Test with the check delayed past its wait. (TF1 "Still open".)
2. **On WhatsApp, the name the person gives in chat wins** over their WhatsApp profile name ("I'm Bilal" beats a profile name "B.").

## 1. Voice notes, answered

- An incoming voice note is downloaded from Meta, transcribed with the monorepo's existing Indian speech providers (Hindi, Hinglish, English first; Marathi, Tamil, Bengali where the provider supports them), and run exactly like a typed message: **the crisis check on the transcript first**, then the agent.
- The reply is text. The Inbox shows the voice note (playable for the team) and its transcript.
- If transcription fails or the note is over 2 minutes: one fixed line asking them to type it, in their language. A failed transcription never drops the message silently.
- Audio is kept only as long as conversations are (SB1's retention), and never sent to the model, only the transcript.

## 2. Images and documents, in and out

- **In:** an image or PDF is accepted and shown in the Inbox. Where a list field takes a file, the agent can attach it to the entry (with the usual consent question); otherwise the reply says politely that it can't read files yet and asks what they need. No image is sent to the model in this block.
- **Out:** a send for images and documents in the Meta provider (beside BT1's interactive sends), validated against Meta's limits (type, size). First uses: the team attaches a file from the Inbox; the agent can send a document that is one of the assistant's own sources when asked ("send me the form").

## 3. Delivery status and the Inbox

- Meta's status webhooks (sent, delivered, read, failed with its reason) are stored per outgoing message, not only for cost, and shown in the Inbox as ticks; a failed send shows its reason in plain words.
- Team replies from the Inbox can use BT1's buttons and the new file send.

## 4. Small WhatsApp pieces

- **Typing indicator** while a reply is being written (Q4 D24), shown on every turn longer than about 1 s.
- **Business-scoped user IDs** (from RC1 §4b): a webhook that carries Meta's business-scoped ID instead of a phone number is stored, matched and answered, never dropped; a test with a recorded webhook.
- **The invite-only refusal** on a customer assistant says "This assistant is by invitation. Please contact <organisation> at <contact>." instead of the old staff-bot text (from RC1 §4), after the crisis check as today.

## Tests

- Recorded webhooks for a voice note (Hindi and English), an image, a PDF, each status, a failed send, and a business-scoped ID.
- A voice note saying an at-risk sentence gets the crisis reply; one saying a booking request goes into BT1's flow.
- A transcription failure gets the fixed line; nothing is lost.
- Send payloads validated against Meta's limits.
- Live check on the Sukoon number after deploy (Shehbaz): a Hindi voice note answered, a photo declined politely, ticks in the Inbox.

## Done when

- [ ] The two TF1 carry-overs: a late at-risk verdict flags and alerts; the given name wins on WhatsApp
- [ ] Voice notes transcribed and answered, crisis-checked first; images and documents accepted and sent; delivery status in the Inbox
- [ ] Typing indicator; business-scoped IDs; the invite-only refusal text
- [ ] Texts approved; `CHUNK-WA-A-NOTES.md`, `PR-WA-A.md`, the Progress row <!-- docs-path-lint: planned -->
