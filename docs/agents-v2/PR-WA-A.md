## WA-A: WhatsApp reply parity

WhatsApp now answers voice notes, keeps photos and documents, and sends files. The team sees whether each reply was delivered or read, and the two carry-overs from TF1 are fixed. Brief: `docs/agents-v2/chunk-wa-a.md`. Notes: `docs/agents-v2/CHUNK-WA-A-NOTES.md`. Texts approved 26 Nov: `docs/agents-v2/TEXTS-WA-A.md`.

**Merge before WA-B and WA-C.** Nothing under `ally-be/src/whatsapp/outbound/` or `ally-be/src/whatsapp/campaigns/` is touched.

**Deploy order:**
1. ally-ai first: the new `/api/v1/voice-notes/transcribe` route and the `send_source_file` tool.
2. Then ally-be: three migrations, all additive.
3. Then ally-web.

### What people see
- **Voice notes are answered.**
  - The note is transcribed (Sarvam, with Whisper as fallback), covering Hindi, Hinglish, English, Marathi, Tamil, Bengali and other Indian languages.
  - The transcript is answered like a typed message, with the crisis check first.
  - If a note can't be transcribed, or is over 2 minutes, one line asks the person to type it, in the language of their earlier turns. The note is never lost.
- **Photos and documents are kept for the team.** With a caption, the caption is answered. Without one, a polite "I can't read files yet". No image goes to a model.
- **"Send me the form."** An assistant that opts in can send one of its own uploaded documents after its reply.
- **The invite-only refusal says who to ask:** "This assistant is by invitation. Please contact {organisation} at {contact}.", then the crisis information as before.
- **Typing dots** stay up on long turns and while a voice note is transcribed.
- **Usernames.** People Meta identifies by a business-scoped ID instead of a phone number are answered, never dropped.

### What the team sees in the Inbox
- Ticks on every WhatsApp reply: sent, delivered, read. A failed send says "Not delivered" and why, in plain words.
- Voice notes playable, with the transcript; photos as thumbnails; documents as links.
- A WhatsApp reply can attach a file (JPEG or PNG up to 5 MB, PDF or Office document up to 25 MB) or add up to 3 reply buttons.

### Fixed from TF1
- **A late crisis verdict now counts.** When the check answers after its 6 s wait and the person is at risk:
  - the chat is flagged "May be at risk";
  - the crisis emails and the Slack alert go out;
  - it's logged.
  - The reply that already went keeps 112 and 14416.
- **On WhatsApp, the name the person gives** ("I'm Bilal") replaces their profile name ("B."), never the other way round.

### Safety
- Crisis first on every new path: a transcript and a caption go through the same keyword check and classifier as typed text.
- Audio never reaches a language model.
- No write without a yes: `send_source_file` writes nothing, and a team button is plain words, never a BT1 token or STOP.
- Files are kept in the private bucket under `wa-media/` and deleted by retention and erasure with their messages.
- Every file sent is checked against Meta's limits first.
- Ally staff can't send files (the staff matrix lists the new route).

### For WA-C
`wa_message_statuses` is keyed by Meta's message id: sent, delivered, read, failed, and the reason. Any sender can read delivered and read without writing a `wa_messages` row.

### Data
Three migrations, all additive:
- `chatbot_contacts.display_name_source`;
- the new table `wa_message_statuses`;
- `wa_contacts.bsuid`, with `phone_e164` made nullable and a CHECK for a phone or an ID.

`DATA_SCHEMA.md` is updated.

### Tests
- **ally-be:** the full suite passes. New specs cover:
  - the late verdict;
  - the name source;
  - media parsing, `downloadMedia` and `sendMedia` against Meta's limits;
  - voice notes through the real inbound pipeline: a Hindi note answered, an at-risk note getting the crisis reply, a booking request reaching the agent, the failure paths, and a Hinglish chat getting the Hinglish line;
  - statuses from recorded webhooks;
  - the Inbox thread, team files and buttons;
  - business-scoped IDs, plus a phone-only webhook unchanged;
  - typing refresh, retention of files, `send_source_file` and the invite-only text.
- **ally-ai:** transcription (Sarvam pieces and language, the over-2-minutes rule, the Whisper fallback, failures) and the tool.
- **ally-web:** ticks, failure reasons, the voice-note player and files, attach and buttons, nothing extra on web chats, and shared components only.
- **Fixtures** are written from Meta's documented payloads, not captured.
- **Live check after deploy** (Shehbaz, Sukoon number): a Hindi voice note answered, a photo declined politely, ticks in the Inbox.

### Existing tests changed
- One assertion accepts the crisis check's new options argument.
- Two assertions use the new invite-only wording, as the brief asked.
- The staff view's test mocks the new attach hook.

### Later (in the notes)
- An owner-set contact for the refusal (the first number in the sources can be wrong, TF1 N-10).
- A file field on lists.
- A dashboard switch for `send_source_file`.
- Streaming to lift the 25 MB document cap.
- A native speaker's review of the Hindi and Hinglish drafts.

Manual: proposal 5b01a8bc-0cc3-47b5-baf3-e8e88c64c3e2

Also filed for this PR: 88ad54dd-6017-4c28-bd8f-5c00da82fce6 (Inbox), d0d2e507-7100-49c0-b57b-3d018ec5687a (who may chat), 8da7ee58-c4c2-4b89-a26f-3e4d90f84017 (assistant safety).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
