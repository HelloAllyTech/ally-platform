# Chunk WA-A notes: WhatsApp reply parity

Branch `feat/agents-v2-wa-a` from master (after TF1 round 2, be-v1.275.0). Brief: `chunk-wa-a.md`. Texts approved 26 Nov: `TEXTS-WA-A.md`. Built in parallel with WA-B and WA-C. Nothing under `ally-be/src/whatsapp/outbound/` or `ally-be/src/whatsapp/campaigns/` was touched (neither existed). WA-A merges first.

## Result

Every item in the brief is built and tested with unit and integration specs.

Nothing has run against Meta, the live Docker stack or production. The live check comes after deploy, on the Sukoon number (Shehbaz): a Hindi voice note answered, a photo declined politely, ticks in the Inbox.

| Done when | State |
|---|---|
| A late at-risk verdict flags and alerts | Done (§0a) |
| The given name wins on WhatsApp | Done (§0b) |
| Voice notes transcribed and answered, crisis-checked first | Done (§1) |
| Images and documents accepted and sent | Done (§2): in; out by the team; `send_source_file` |
| Delivery status in the Inbox | Done (§3) |
| Typing indicator; business-scoped IDs; the invite-only refusal | Done (§4) |
| Texts approved | Done (26 Nov, with changes; see `TEXTS-WA-A.md`) |

Tests run on the branch:
- **ally-be:** the full suite at the branch head (1,377 suites, 20,508 tests, 0 failed). Also `typecheck` (needs `NODE_OPTIONS=--max-old-space-size=8192` on a laptop), lint, and the AppModule dependency check.
- **ally-ai:** the agent runtime and voice-note specs (644), plus flake8, black and isort.
- **ally-web (Node 22):** the admin and helpline suites in the commit hook, plus the admin typecheck and lint.

## How it works

### §0a A late crisis verdict

- `AiService.checkWhatsAppCrisis` takes an optional `onLate` callback. The same request keeps listening for up to 30 s (`CRISIS_CHECK_LIMITS.lateListenMs`) after the 6 s budget. The turn still sees the timeout at 6 s, so its timing is unchanged, and no second call is paid for.
- The engine (`answerLogged`) passes `onLate`. If the reply was not the crisis reply and the late verdict is at risk, `LateCrisisService.flag` does what an in-time verdict does:
  - sets `safety_at`;
  - calls `CrisisAlertService.flag`, which sends the "May be at risk" flag, the emails to Owners and Responders and the holding message;
  - publishes a Safety event to the Inbox;
  - sends the Slack crisis alert;
  - logs a `crisis_late_verdict` stage line.
- This applies to WhatsApp and the bot page only, never the test console.

### §0b The given name wins

- New column `chatbot_contacts.display_name_source`, either `whatsapp_profile` or `chat`.
- The WhatsApp profile still fills only an empty name, and marks it as the profile's.
- `MemoryService.nameNow`, the run's memory `name` write and a list entry's name may replace a profile name, and mark it `chat`. The profile never replaces a name the person gave.
- Names set before this column count as given, so nothing existing changes.

### §1 Voice notes

The flow, with the step skipped by a crisis decision:

1. `MetaWhatsAppProvider.parseInbound` reads `audio`, `image` and `document` as `media`, no longer as unsupported.
2. `WaMediaService` downloads the file (`provider.downloadMedia`: `GET /{media-id}`, then its URL with the token, capped at 25 MB) and stores it in the private audio bucket as `wa-media/<chatbotId>/<conversationId>/<messageId>.<ext>`.
3. It puts the file on the person's `chatbot_messages.attachments` (kind, key, type, size, transcript, language, duration).
4. A voice note is sent to ally-ai's new `POST /api/v1/voice-notes/transcribe`:
   - ffprobe measures the duration, and over 120 s returns `too_long`;
   - Sarvam `saarika:v2.5` transcribes with `language_code: unknown`, in 29 s pieces made with ffmpeg;
   - Whisper is the fallback.
   - Hindi, Hinglish (heard as Hindi), English, Marathi, Tamil, Bengali and other Indian languages are covered.
5. The transcript becomes the message's text, then goes through the same steps as typed text: consent, the free crisis keyword check, then the engine (classifier and keywords first, then the agent).
6. Audio never reaches a language model.

When it fails:
- On a failure, an empty transcript, a note over 2 minutes or a failed download, the person gets the approved "please type it" line and the message is kept.
- The line's language comes from the person's earlier turns in this chat (`replyLanguageOf`). Only when there are none does the WhatsApp locale decide; otherwise English.
- Typing dots show while the note is being transcribed.

Other details:
- Registry row: `whatsapp-voice-note-transcribe`.
- Retention and erasure delete the stored files before they clear `attachments`, so no file outlives its message.

### §2 Images and documents

**In.** The file is stored and shown in the Inbox.
- With a caption, the caption is answered like typed text (crisis first).
- Without one, the approved "can't read files yet" line goes out, in the language chosen as for voice notes.
- No image goes to a model.

**Out: `provider.sendMedia`.** Images and documents are sent by link (a 10-minute signed URL). Before sending it checks:
- type (JPEG or PNG; PDF, Office or text);
- size (images 5 MB, documents 25 MB);
- caption length (1,024);
- file name length;
- that the link is https.

A file that doesn't fit is never sent.

**Team files and buttons from the Inbox.**
- `POST /v1/inbox/chatbots/:chatbotId/conversations/:id/attachments` takes a multipart upload. It is checked, stored under `wa-media/`, then sent through the handover, with the same holder and 24-hour checks as text.
- `WhatsAppInboxSender` sends it with `sendMedia`, using the reply's text as the caption.
- A text reply can carry up to 3 buttons, sent with BT1's interactive send and ids `team-reply:N`. If the buttons can't go, the text goes with the choices listed.
- A tap on a team button reads as its title, never as a BT1 token or as STOP.
- Files on bot-page chats are refused in plain words.
- The route is on the list of actions Ally staff may never take.

**`send_source_file`.** A gateway tool that is off by default and opt-in per assistant (see How to test).
- The agent names a document by its title.
- ally-be checks it is an uploaded file among this assistant's own sources (owned by it, or selected for it) of a type WhatsApp sends. Otherwise it answers `no_such_file` with the titles it can send.
- After the reply goes, the WhatsApp channel sends the file with `sendMedia`, at most 2 per run. Each is saved as its own message (`handled_by source_file`), so the Inbox shows it with ticks.
- Nothing is sent after a crisis reply or a failed run, and choosing a file doesn't count as an action taken.

### §3 Delivery status

- New table `wa_message_statuses`, keyed by Meta's message id.
  - It holds sent, delivered, read and failed (with Meta's code, title and detail), and each time is set once.
  - A status only moves forward, and a failure is kept.
  - It is independent of `wa_messages`, so WA-C can read delivered and read for campaign sends.
- `WaStatusService` records each status from the webhook, beside the cost recording. It mirrors the state onto `wa_messages.status` and `chatbot_messages.status`, and publishes an Inbox `status` event.
- The Inbox thread returns each message's `status`, a `failedReason` in plain words (`FAILED_SEND_REASONS`), and its files as signed links.
- The web shows:
  - ticks, with the label as the accessible name;
  - "Not delivered" and the reason;
  - a voice note player with the transcript;
  - photo thumbnails and document links.

### §4 Small pieces

**Typing.** The indicator already existed. Now:
- "typing…" is re-sent every 20 s on a long turn (Meta's bubble lasts about 25 s);
- the reply stops it, and it is capped at 60 s;
- it is also shown during transcription.

**Business-scoped IDs** (field names checked on Meta's page):
- **Inbound:** a message carrying `messages[].from_user_id` and no `from` is parsed, and its contact is stored with `wa_contacts.bsuid`. `phone_e164` is now nullable, with a CHECK for a phone or an ID, and the ID is unique per business number.
- **Matching:** the contact is matched by phone, else by the ID; a contact found by one learns the other.
- **Replies:** they go to the ID, sent as `recipient`.
- **Statuses:** read `recipient_user_id`, and pricing takes the country from the ID's prefix (`IN.`).
- **Queue:** the SQS consumer no longer drops a message without `from`.

**The invite-only refusal.**
- "This assistant is by invitation. Please contact {organisation} at {contact}." (or without a contact), in en, hi and hi-latn, then the crisis information, as before (D4).
- It comes after the keyword crisis check, as today.
- `{contact}` is the first phone number or email in the organisation's own sources, never a helpline. The merged settings can hold the platform's default numbers, which were nearly used.

## Code map

| Where | What |
|---|---|
| `ally-be/src/ai/service/ai.service.ts` | `checkWhatsAppCrisis(…, { onLate })`, `transcribeVoiceNote` |
| `ally-be/src/ai/constants/knowledge-answer.constants.ts` | `CRISIS_CHECK_LIMITS.lateListenMs` |
| `ally-be/src/chatbot/safety/late-crisis.service.ts` | Flag and alert on a late verdict |
| `ally-be/src/chatbot/engine/chatbot-engine.service.ts` | `onLate` wiring; `inviteOnlyText` |
| `ally-be/src/chatbot/memory/memory.service.ts`, `chatbot/agent-tools/list-tools.service.ts` | The name source |
| `ally-be/src/whatsapp/wa-a-copy.ts` | Every new fixed text, and `failedSendReason` |
| `ally-be/src/whatsapp/type/whatsapp-provider.interface.ts` | `media` on inbound messages, `fromUserId`, `WhatsAppMedia`, `WHATSAPP_MEDIA_LIMITS`, `WHATSAPP_DOCUMENT_MAX_BYTES`, `whatsappMediaProblem` |
| `ally-be/src/whatsapp/provider/meta-whatsapp.provider.ts` | Parsing media and IDs, `downloadMedia`, `sendMedia`, `recipient` for an ID |
| `ally-be/src/whatsapp/service/wa-media.service.ts` | Download, storage, transcription and the fixed lines; source files |
| `ally-be/src/whatsapp/service/wa-status.service.ts` | `parseWhatsAppStatuses`, `WaStatusService` |
| `ally-be/src/whatsapp/media/wa-attachment.ts` | The attachment shape, `waMediaKeysOf`, `deleteWaMedia`, `TEAM_BUTTON_PREFIX` |
| `ally-be/src/whatsapp/util/wa-address.ts` | `waAddressOf`, `isBusinessScopedId`, `lastFourOf` |
| `ally-be/src/whatsapp/service/whatsapp-inbound.service.ts` | Media step, team taps, typing refresh, `resolveContact` by phone or ID, source files after the reply |
| `ally-be/src/whatsapp/service/whatsapp-inbox-sender.service.ts` | Team files and buttons |
| `ally-be/src/chatbot/inbox/inbox.service.ts`, `inbox.controller.ts` | Thread delivery and files; `storeTeamFile`; the attachments route |
| `ally-be/src/chatbot/handover/handover.service.ts` | `reply(…, { media, buttons })` |
| `ally-be/src/chatbot/agent-tools/send-source-file.tool.ts` | The `send_source_file` gateway tool |
| `ally-be/src/chatbot/privacy/assistant-retention.service.ts`, `customer-erasure.service.ts` | Deleting files; contacts known only by an ID |
| `ally-be/src/whatsapp/test/fixtures/` | Webhooks in Meta's format: voice notes (hi, en), an image, a PDF, each status, a failed send, a business-scoped ID |
| `ally-ai/app/core/voice_notes/service.py`, `app/api/v1/endpoints/voice_notes.py` | Transcription |
| `ally-ai/app/core/agent_runtime/tools/send_source_file.py` | The tool, as the model sees it |
| `ally-web/apps/ally-admin-dashboard/src/pages/Inbox/WaParts.tsx` | `DeliveryTicks`, `MessageFiles`, `ReplyExtras` |
| `ally-web/apps/ally-admin-dashboard/src/pages/Inbox/copy.ts` | `INBOX_WA`, `TEAM_FILE_LIMITS_MB` |

Migrations:
- `1988610000000-ContactDisplayNameSource`
- `1988620000000-CreateWaMessageStatuses`
- `1988630000000-WaContactBusinessScopedId`

New `handled_by` values (strings, no migration): `voice_failed`, `file_not_read`, `source_file`. New `WaMessageStatus` values: `delivered`, `read`.

## Every `phone_e164` / `phoneE164` call site, after the business-scoped ID change

These line numbers are on this branch. "Phone-only" means the path needs a real number and now skips a contact known only by its ID. "Address" means it now goes through `waAddressOf` (the phone, else the ID).

| File:line | What it does | Kind | Change |
|---|---|---|---|
| `whatsapp/entity/wa-contact.entity.ts:30,34,46` | Unique partial indexes and the column | Schema | Nullable; `bsuid` beside it with its own unique indexes and a CHECK |
| `whatsapp/service/whatsapp-inbound.service.ts` `resolveContact` (~1067–1099) | Find or create the contact | Address | Phone, else the ID; each learns the other; `phoneLast4` from either |
| `whatsapp-inbound.service.ts:418` (`privacy.beforeTurn` phone) | Erase in chat by phone | Phone-only | Passes null; erasure falls back to the contact id it also gets |
| `whatsapp-inbound.service.ts:510–512` (engine `sender`) | The run's sender key and phone | Address / phone-only | `externalId` from `waAddressOf`; `phone` may be null (an ID-only sender doesn't match a phone on an invite list, which is correct) |
| `whatsapp-inbound.service.ts:554` | Blocked-notice once-a-day key | Address | `waAddressOf` |
| `whatsapp-inbound.service.ts:744` | Rate-limit key | Address | `waAddressOf` |
| `whatsapp-inbound.service.ts:822–823, 1175, 1178, 1262` | Sends (text, numbered text, interactive, source files) | Address | `waAddressOf`; the provider sends `recipient` for an ID |
| `whatsapp/service/whatsapp-inbox-sender.service.ts:170` | Team reply send | Address | `waAddressOf` |
| `whatsapp/shared-store/wa-shared-store.mapper.ts:46` (`whatsappIdentityOf`) | Shared store's WhatsApp identity | Address | `waAddressOf` |
| `whatsapp/shared-store/wa-shared-store.check.ts:210–211` | Backfill check (read only) | Address | `COALESCE(phone_e164, bsuid)` |
| `whatsapp/service/whatsapp-identity.service.ts:67–68, 131–138` | Who the sender is, by phone mapping or user phone | Phone-only | Skipped when there's no phone: unrecognised, never matched on an ID's digits |
| `whatsapp/service/whatsapp-retention.service.ts:207–218` | Erase stale contacts | Phone-only | `?.startsWith` (no crash on null); clears `bsuid` too |
| `chatbot/privacy/assistant-retention.service.ts:371, 379` | Retention sweep of contacts | Phone-only | `COALESCE(phone_e164, '') NOT LIKE` (an ID-only contact is no longer skipped); clears `bsuid` |
| `whatsapp/service/whatsapp-conversation.service.ts:313, 406, 417` | Admin "reveal number" | Phone-only | Returns null for an ID-only contact (the admin sees no number) |
| `whatsapp-conversation.service.ts:481` | Manual erase | Phone-only | Clears `bsuid` too |
| `billing/service/whatsapp-pricing.service.ts` `countryOf` / billables | Meta's fee by country | Address | Country from the ID prefix; `recipient_user_id` read |
| `whatsapp/entity/wa-phone-mapping.entity.ts`, `dto/whatsapp-phone-mapping.dto.ts`, `service/whatsapp-phone-mapping.service.ts` | Phone mappings (a separate table) | Phone-only | None: a mapping is a phone number by definition |
| `chatbot/entity/chatbot-contact-identity.entity.ts:34` | A comment | none | none |

## Decisions

- **One document size, 25 MB.**
  - `WHATSAPP_DOCUMENT_MAX_BYTES` is used by the send check, the Inbox upload, the download cap and (through the mirrored web constant `TEAM_FILE_LIMITS_MB`) the Inbox hint and the size error.
  - Meta allows 100 MB, but the Inbox upload (multer, in memory) and `downloadMedia` both hold the whole file in memory. A 100 MB document would sit in the process.
  - Raising it needs streaming uploads and downloads.
- **Late verdicts on the same request.** There is no second classifier call: the original request just keeps listening. The 6 s turn budget is unchanged.
- **A caption is the person's words.** An image or document with a caption goes through the same crisis check and agent as text. Without one, the fixed line goes out. No image goes to a model in this block.
- **No list field takes a file.** `ListFieldType` has no file type, so "attach to an entry" is never true and every file without words gets the polite decline. A file field type is a Collections change; see later.
- **The language of a fixed line** comes from the person's earlier turns, then their WhatsApp locale, then English (changed at approval). Only en, hi and hi-latn exist as fixed texts, like every other fixed reply.
- **`send_source_file` is opt-in per assistant**, like `hand_over`. Turning it on for everyone would give every assistant's runs a gateway token and a new tool, changing their requests.
- **Team buttons are not BT1 tokens.** They are plain words with a `team-reply:` id, so a tap is never redeemed as an action and never read as STOP.
- **The invite-only text applies to the invite-only refusal itself.**
  - No customer assistant reaches the old staff-bot text in the code. That text is used only by the platform's organisation-knowledge assistants, for a sender with no organisation, and it is unchanged.
  - The crisis information still follows the new line (D4).
- **Statuses table, not columns.** Status rows are keyed by Meta's id alone, so a sender that writes no `wa_messages` row (WA-C) can still read delivered and read.
- **Fixtures.** The recorded webhooks are built from Meta's documented payloads with made-up ids, not captured from Meta. The live check on the Sukoon number after deploy covers real payloads.
- **SQS window.** A voice turn adds a download (up to 15 s) and a transcription (up to 25 s) to the run. A turn that runs past the 60 s visibility window is redelivered and skipped by the dedupe insert, so nobody is answered twice. Voice-turn time is worth watching after deploy.

## How to test

1. **Local stack and migrations.** The ally-be container mounts this tree and runs the three migrations on `ally_local` at start. Rebuild ally-ai's image for the new route.
2. **Recorded webhooks.** POST each file in `ally-be/src/whatsapp/test/fixtures/` to the local webhook, signed with the local app secret:
   ```bash
   body=$(cat ally-be/src/whatsapp/test/fixtures/voice-note-hi.json)
   sig=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$WHATSAPP_APP_SECRET" | cut -d' ' -f2)
   curl -s localhost:8001/api/v1/webhook/whatsapp -H "x-hub-signature-256: sha256=$sig" \
     -H 'content-type: application/json' -d "$body"
   ```
   Media downloads need Meta, so locally they fail and the "please type it" line shows that the failure path works. Real voice notes need the deployed number.
3. **Turn on `send_source_file` for one assistant** (no dashboard switch yet).
   - SQL:
     ```sql
     UPDATE chatbots
        SET settings = COALESCE(settings, '{}'::jsonb)
              || jsonb_build_object('abilities',
                   COALESCE(settings->'abilities', '{}'::jsonb) || '{"send_source_file":"do_it"}'::jsonb)
      WHERE id = '<chatbot id>';
     ```
   - The assistant needs an uploaded PDF or Office source (`kb_documents.file_url` set, owned by it or selected for it).
   - Then on WhatsApp: "Can you send me the <document title>?" The reply says the file is on its way, and the file follows.
   - To turn it off again, set `"never"`, or remove the key.
4. **Specs.**
   - ally-be: `npx jest src/whatsapp src/chatbot/inbox src/chatbot/engine src/chatbot/safety src/chatbot/agent-tools src/chatbot/privacy src/ai`
   - ally-ai: `poetry run pytest tests/core/voice_notes tests/core/agent_runtime`
   - ally-web (Node 22): `npx vitest run apps/ally-admin-dashboard/src/pages/Inbox --config apps/ally-admin-dashboard/vite.config.ts`
5. **Live, after deploy (Shehbaz, Sukoon number).**
   - A Hindi voice note is answered.
   - An at-risk voice note gets the crisis reply.
   - A photo is declined politely and shows in the Inbox.
   - Ticks appear on replies.
   - A team reply with a PDF and with buttons arrives.
   - A username account (if one is available) is answered.

## Existing tests changed

- `chatbot-engine.service.spec.ts`: "runs the crisis check alongside with the same prompts" now also accepts the new second argument, `{ onLate }`. The request is unchanged.
- `chatbot-engine-credits.spec.ts` and `whatsapp-inbound-chatbot.spec.ts`: the "by invitation only" assertions now check the new wording, as the brief asked.
- `staffConversations.test.tsx`: mocks the new attach hook.
- `staff-access-matrix.ts`: the new attachments route is added to the staff-forbidden list, as its guard test requires. The test itself is unchanged.
- `whatsapp-inbound-agent.fixtures.ts`: also returns the history `find` mock, for the language test.

## For a native speaker (Hindi and Hinglish drafts, approved for the internal launch)

All in `ally-be/src/whatsapp/wa-a-copy.ts`:
- `VOICE_NOTE_FAILED` hi and hi-latn (समझ नहीं पाया: masculine);
- `FILE_NOT_READ` hi and hi-latn (पढ़ नहीं सकता: masculine);
- `INVITE_ONLY` hi and hi-latn (reworded at approval).

This is the same list as BT1's and TF1's.

## Open questions and later

- **`{contact}` in the invite-only refusal** is the first phone number or email in the sources, and TF1 N-10 showed that can be the wrong number. Later: an owner-set contact in Settings, used here and in the limit replies.
- **A file field on lists** (`ListFieldType.FILE`), so the agent can attach a person's photo or PDF to an entry with the usual consent question.
- **A dashboard switch for `send_source_file`** in Tools, and showing the sent file on the bot page (it's WhatsApp-only today).
- **Streaming uploads and downloads**, to lift the 25 MB document cap to Meta's 100 MB.
- **Fixed lines in Marathi, Tamil and Bengali**: transcription covers them, but the fixed lines exist only in en, hi and hi-latn.
- **Transcription cost.** Sarvam's cost isn't recorded in the cost ledger; the registry row documents the call.
- **The Inbox's new labels** (`INBOX_WA`) are kept apart from `INBOX` until they're added to `ONBOARDING-COPY.md`, which the Inbox copy test checks against.
- **The Context Library** wasn't connected in this session, so no searches were made for the labels and failure states.
- **Media sends to a business-scoped ID** follow the same `recipient` rule as text, from Meta's documentation; the live check should include one if a username account is available.
