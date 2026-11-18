# AI Chatbots — implementation and data flow
Stage 1 build notes, as of 5 Nov 2026 (exported from the team doc "AI Chatbots — implementation and data flow")

## Summary
AI Chatbots are configurable bots that answer people's questions from a set of knowledge-library documents, reached through connectors — a WhatsApp number today. The code merged to `master` in PR #196 and deploys automatically; two prompt changes still have to be published in production by hand.
The mental model: **a chatbot is configuration, a connector is a way in, and the engine decides every reply.** A message arrives on a connector, the connector finds its chatbot, the channel-agnostic engine in ally-be decides the reply (quick reply, refusal, crisis reply or an answer from ally-ai), and the connector sends it.

| Piece | Where | State |
|---|---|---|
| Chatbot module (engine, access, settings, connectors) | `ally-be/src/chatbot` | Merged; live on deploy |
| WhatsApp connector (webhook, numbers, sending) | `ally-be/src/whatsapp` | Merged; live on deploy |
| Database migrations | `ally-be/src/database/migrations` 1980885000000–1980920000000 | Run automatically on deploy |
| Instructions, answer modes, general-knowledge prompt | `ally-ai/app/core/knowledge_agent` | Merged; active once ally-ai deploys |
| AI Chatbots admin page | `ally-web` admin dashboard, `/chatbots` | Merged; live on deploy |
| Crisis-check and decline prompt fixes (v2) | Skills Store (Manage Prompts) | Published locally only — production still runs v1 |
| Ally FAQ chatbot | Local database | Draft; one of seven documents attached; no channel connected |

## Architecture

[Diagram not included: AI Chatbots architecture · a message from WhatsApp to reply]
WhatsApp and ally-ai sit at the edges; ally-be holds the chatbots, runs the engine and talks to Meta with each number's own credentials. Preview from the dashboard calls the same engine directly, skipping Meta and the queue.

## Data model
Everything a chatbot is lives in five new Postgres tables keyed by `chatbot_id`; conversations stay in the WhatsApp tables and are stamped with the bot that answered them. Documents are never copied: a bot holds links into the shared knowledge library.

| Table | One row is | Key columns | Notes |
|---|---|---|---|
| `chatbots` | A bot | `status` (draft / live / paused), `access_mode` (anyone / recognised / listed), `answer_mode` (documents_only / documents_and_general), `knowledge_source` (selected / organisation), `persona` (jsonb), `model` (jsonb), `settings` (jsonb overrides), `last_tested_at` | `persona` holds display name, instructions (≤ 4,000 characters), tone, welcome message |
| `connectors` | A way in (any channel) | `type` ( `whatsapp` ), `chatbot_id` (nullable), `status` | A connector serves at most one bot; a bot can have several |
| `wa_business_numbers` | A WhatsApp number (the WhatsApp connector's own store) | `connector_id` , `phone_number_id` , `waba_id` , `access_token_enc` , `app_secret_enc` , `webhook_key` , `verify_token` , `status` | Credentials AES-256-GCM encrypted; `tenant_id` now optional |
| `chatbot_documents` | A library document a bot answers from | `chatbot_id` , `document_id` → `kb_documents` | Editing a document updates every bot using it |
| `chatbot_members` | A dashboard user's role on a bot | `chatbot_id` , `user_id` , `role` (viewer / editor / owner) | One user can be on many bots |
| `chatbot_audience` | One "who can chat" entry | `chatbot_id` , `kind` (user / organisation / phone / email), `value` | Used when `access_mode` is listed |
| `wa_keyword_templates` | A quick reply | `chatbot_id` (null = shared default), `overrides_template_id` | A bot can reword, switch off (optional ones) or add its own |
| `wa_conversations` | A thread | `chatbot_id` , `connector_id` , `contact_id` | Stamped at start, so history stays with the bot that answered |
| `global_settings` row `whatsapp_bot` | The defaults every bot inherits | `platformChatbotId` | Also names the bot that answers the server-configured number |

Unchanged and reused: `wa_contacts`, `wa_messages`, `wa_unanswered_questions`, `wa_phone_mappings`, `kb_documents` and their Weaviate chunks. Full column detail is in `ally-be/DATA_SCHEMA.md` §3.11.

## Message flow
A WhatsApp message reaches a reply in about 5–12 seconds through eight steps; the order is deliberate, and every step can end the run early. The webhook only accepts and queues; all the work happens in an SQS consumer, so Meta always gets a fast 200.

- **Webhook** — Meta posts to `POST /api/v1/webhook/whatsapp/:webhookKey` (one URL per number). The key picks the number; its app secret checks the `X-Hub-Signature-256` HMAC. Valid messages go onto the WhatsApp inbound SQS queue. The server-configured number uses the shared `/api/v1/webhook/whatsapp` instead.
- **Find the bot** (`WhatsAppInboundService.handle`) — Meta's `phone_number_id` → the number → its connector → its chatbot (`ConnectorService.chatbotFor`). The server-configured number uses `platformChatbotId`. No bot, or an archived one: the message is dropped and logged.

- **Dedupe** — the provider message id is inserted with `ON CONFLICT DO NOTHING`; a redelivery stops here. SQS and Meta both retry independently, so this is the first write.
- **Kill switches** — the defaults' "Agents can reply" switch and the bot's status. Draft or paused: recorded, not answered.

- **Contact and thread** — the contact is per (phone, number); a thread is reused within the idle window and only if it belongs to the same bot. Blocked contacts and photo/voice messages are handled here.
- **Rate limit and consent** — per (number, sender) limits; STOP / START are handled in code so opting out always works, even if its quick reply is broken.

- **Identity and decision** — the sender is matched to an Ally user and organisation (phone mappings first, then `users.phone`); a lookup failure counts as unrecognised. Then `ChatbotEngineService.respond` decides the reply (next section).
- **Send and record** — the outbound row is saved as `queued` before sending, then sent through Meta's Graph API with that number's own credentials. Two attempts for transient failures; a reply that still fails, crisis replies above all, raises a Slack alert. Declines are filed to Knowledge gaps.
The one rule across all of it: the service throws only before it has sent anything. After a send it records failures and returns, because a rethrow would make SQS deliver the message again and answer the person twice.

## The chatbot engine
`ChatbotEngineService.respond` turns one message into one decision in three ordered steps, and never sends or stores anything itself — which is what lets Preview run the exact production path. It returns the reply text, how it was handled, citations, retrieval details, an optional knowledge-gap entry and an optional alert; the channel does the rest.

- **Quick replies first** (`ChatbotReplyService.match`) — the shared defaults plus the bot's own and customised ones, checked top to bottom. A crisis keyword answers instantly with the crisis reply and an alert. Someone not allowed to use the bot still gets safety, consent and command replies, but not FAQ ones. A hello on a bot with a welcome message gets that welcome instead of the shared greeting.
- **Access** (`ChatbotAudienceService.canChat`) — anyone, any recognised Ally user, or only the listed users, organisations, phones and emails. A refusal runs the AI crisis check first, then sends the bot's "not on the list" message.

- **Answer** — one call to ally-ai's `/knowledge-agent/answer` with the bot's documents, instructions, tone, answer mode and model, and in parallel `/knowledge-agent/crisis-check`. A crisis verdict replaces the answer. A classifier that fails to run raises a "degraded" alert rather than staying silent.
First messages: a hello on someone's first message gets the welcome message followed by the first-message notice; a real question is answered directly. A crisis reply always goes out alone.
Settings: every bot starts from the defaults (`whatsapp_bot` row) with its own changes on top (`ChatbotSettingsService.applyOverride`). Wording is the bot's to change; safety only tightens — a bot can turn the crisis check or consent on but never off, and can lower rate limits but never raise them. The extra crisis check always uses the platform's model, whatever model the bot answers with.

## Knowledge and answering in ally-ai
ally-ai answers only from the passages it retrieves, and declines in code — with no model call — when nothing relevant is found, unless the bot allows general knowledge. The pipeline lives in `ally-ai/app/core/knowledge_agent/agent.py`.

- **Translate** — the question is detected and restated in English for searching (`knowledge/translate_query`), because cross-language search retrieves badly; the answer still comes back in the person's language.
- **Search** — the English text is embedded and searched in the Weaviate `KnowledgeChunk` collection, pre-filtered to the bot's `document_ids`. An empty selection is sent as a placeholder id, so it searches nothing, never everything.

- **Gate** — no hits, or a best match below the decline threshold, declines straight away. Bots in "documents + general knowledge" mode skip this gate and go to the model with no passages.
- **Select** — passages within a similarity band of the best one, capped by count and token budget.

- **Write** — the prompt is the bot's persona block (name, tone, instructions, ranked below the rules) followed by `knowledge/whatsapp_answer`, or `knowledge/answer_general` in general mode. The model returns `answer`, `decline` or `clarify` as structured output.
- **Check** — citations are passage numbers mapped back to chunks in code; out-of-range numbers are dropped, and an empty "answer" becomes a decline.
Retrieval thresholds (passages searched, match floor, decline threshold, passages used) come from the defaults and each bot's settings on every request, so tuning needs no deploy.

| Prompt (Skills Store code) | Used for | Model |
|---|---|---|
| `ally_ai_knowledge_whatsapp_answer` | Answers in documents-only mode | The bot's choice, else the Skills Store's (gpt-5-mini locally) |
| `ally_ai_knowledge_answer_general` | Answers in documents + general mode | The bot's choice, else the Skills Store's |
| `ally_ai_knowledge_translate_query` | Translating the question for search | Skills Store |
| `ally_ai_knowledge_crisis_classify` | The extra AI crisis check | Skills Store only (gpt-4o-mini locally) |

The live text of every prompt is in the Skills Store (Manage Prompts); the `.txt` files only seed new environments. A bot's model is sent as an override on the two answer prompts for that request only, and must be in the `llm_models` catalog for the ally-ai runtime.

## Admin dashboard and APIs
Admins manage everything from the **AI Chatbots** page (`/chatbots`, old `/whatsapp-bot` links redirect), which calls two new API groups plus the existing WhatsApp ones. Code: `ally-web/apps/ally-admin-dashboard/src/pages/WhatsAppBot`, RTK Query slices `api/chatbots.ts` and `api/whatsappBot.ts`.

- **Home** — chatbot cards; platform admins also get Channels (every number and its bot), Defaults (shared settings and quick replies) and the Knowledge library.
- **A chatbot's page** — Overview (setup checklist, Publish / Unpublish), Instructions, Knowledge, Quick replies, Access, Channels, Settings, Preview, Conversations, Knowledge gaps, Analytics.

| API | What it does |
|---|---|
| `GET/POST /v1/chatbots` , `GET/PATCH /v1/chatbots/:id` , `PATCH …/status` , `POST …/archive` | List, create, edit, publish, archive |
| `GET/PUT /v1/chatbots/:id/settings` | Defaults, the bot's changes and the result |
| `GET/PUT …/documents` , `GET/PUT …/members` , `GET/POST/DELETE …/audience` | Knowledge, team and who can chat |
| `POST /v1/chatbots/:id/test` | Preview: runs the real engine, sends and stores nothing, records `last_tested_at` |
| `GET /v1/connectors` , `GET …/types` , `PATCH …/:id/chatbot` , `DELETE …/:id` | List channels, move one to a bot, disconnect |
| `POST /v1/whatsapp/numbers/manual` , `…/:id/check` , `…/:id/subscribe` | Connect a WhatsApp number (checked with Meta first) |
| `/v1/whatsapp/templates` , `/conversations` , `/unanswered` , `/analytics/*` with `?chatbotId=` | Quick replies, conversations, knowledge gaps, analytics for one bot |

Access (`ChatbotAccessService`): a platform admin with platform-wide scope sees and manages every bot, and is the only one who can create bots, edit defaults or connect free numbers. Everyone else sees only the bots they are a member of — viewers look and preview, editors also change the bot, owners also manage its team and channels. A bot you are not on answers 404, so ids cannot be probed. All routes sit behind the `whatsapp_bot` feature toggle.

## Connectors
A connector is the only channel-specific part; the chatbot module imports no channel code, so adding Slack or IVR is a new module, not a rework. WhatsApp registers itself as the first connector type at start-up (`WhatsAppConnectorType`, `ally-be/src/whatsapp/service/whatsapp-connector-type.service.ts`).
What the WhatsApp connector owns:

- **Connecting** — an admin enters the number's Phone number ID, Business Account ID, access token and app secret; Meta checks them before anything is saved; credentials are encrypted with `WHATSAPP_CREDENTIALS_ENCRYPTION_KEY`.
- **Its webhook** — a per-number callback URL and verify token for the Meta app; the number turns `connected` when Meta verifies it.

- **WhatsApp-only rules** — dedupe, STOP/START, media, rate limits, contacts and threads, sending with retries.
- **Its card** — address, status, last message, through the registry's `summarise`.
To add a channel, a new module would:

- Register a type with `ConnectorRegistry` (label, capabilities such as maximum reply length, `summarise`, `disconnect`).
- Run its own connect flow and create the `connectors` row with `ConnectorService.create`.

- On each message, resolve the bot with `ConnectorService.chatbotFor`, identify the sender (user, organisation, email, phone), call `ChatbotEngineService.respond`, then send and record the decision.
The access list, quick replies, knowledge, instructions and Preview then work for that channel unchanged. Conversation storage is still WhatsApp's tables; a second real channel would bring its own store or move both to shared tables.

## Deployment, configuration and operations
Deploying needs no manual step except publishing two prompt fixes; the services can go out in any order. ally-be runs migrations on start (`docker-entrypoint.sh`), and an older ally-ai simply ignores the new request fields.
**Migrations, in order**

| Migration | What it does |
|---|---|
| `1980885000000-CreateWaBusinessNumbers` | WhatsApp numbers table; contacts become per (phone, number) |
| `1980890000000-CreateWaOrgSettings` | Interim per-organisation settings (dropped two steps later) |
| `1980900000000-AddWaTemplateTenant` | Per-scope quick replies |
| `1980910000000-CreateChatbots` | Chatbot, connector, member, audience and document tables; converts each number into a bot; creates "Ally assistant" for the server-configured number and stores it as `platformChatbotId` ; stamps old threads |
| `1980920000000-AddChatbotLastTestedAt` | Preview timestamp for the setup checklist |

**Configuration**

- `WHATSAPP_CREDENTIALS_ENCRYPTION_KEY` (ally-be, 64 hex characters) — optional; without it, connecting a number fails with a clear message.
- `API_BASE_URL` (ally-be) — forms the callback URL shown to admins; locally it is `localhost`, so a tunnel address is pasted into Meta instead.

- The server-configured number's existing `WHATSAPP_*` variables are unchanged.
**After each deploy**

- Publish v2 of `ally_ai_knowledge_crisis_classify` and `ally_ai_knowledge_whatsapp_answer` in production's Manage Prompts, from `ally-ai/app/prompts/knowledge/crisis_classify.txt` and `whatsapp_answer.txt`. Until then ordinary questions can get the crisis reply.
- Check AI Chatbots lists "Ally assistant" as Published if the server-configured number is live.

- Add organisation-restricted admins who need a bot to its Team; they no longer see WhatsApp pages by organisation.
**Locally**

- Meta needs a public URL: run `cloudflared tunnel --url http://localhost:8001` and paste `<tunnel>/api/v1/webhook/whatsapp/<webhook key>` with the verify token into the Meta app. The tunnel address changes on every restart.
- Meta's test number only delivers to its allow-listed phones (error 131030 otherwise); a real business number has no such limit.

- The local ally-ai container runs a prebuilt image, so instructions, tone and general-knowledge mode need an image rebuild to take effect.
- After renaming migrations, clear `ally-be/dist` before restarting, or a stale compiled copy re-runs.

## Known gaps and next steps
The biggest open item is publishing the crisis-check fix in production; the rest are limits to plan around, not breakages.

| Gap | Effect | Next step |
|---|---|---|
| Production still runs v1 of the crisis and answer prompts | Ordinary questions can get the crisis reply; declines mention "reference passages" | Publish v2 in Manage Prompts (Deployment section) |
| "Documents + general knowledge" and instructions not tried end to end | Only proven through ally-ai checks and unit tests, not a live answer | Rebuild the local ally-ai image and test in Preview |
| ally-ai's new tests and flake8 not run locally | CI is the first full run | Watch the ally-ai CI jobs |
| Team members are added by user ID | Admins must look ids up | Add a user search to Access → Team |
| Knowledge picker and source links use the library's organisation scoping | An organisation-restricted member may not be able to pick documents or open a cited source | Scope the library and citation routes by bot membership |
| Organisation-restricted admins lose organisation-based WhatsApp views | They see nothing until added to a bot | Add them to bots' Teams after deploy |
| Numbers are connected manually | Each organisation needs its own Meta app details | Embedded Signup (needs Meta Tech Provider status) |
| Conversation storage is WhatsApp-specific | A second channel needs its own store | Decide when the second channel is built |
| A general question naming suicide still gets the crisis reply | Safe by design, but a false alarm | Leave as is; revisit with real usage |

For the production Ally number: connect it under AI Chatbots → Channels after deploy, point the production Meta app's webhook at its callback URL (with the app owner's sign-off), add it to the Ally chatbot, and publish.
