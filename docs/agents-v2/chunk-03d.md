# Chunk 3d — v2 only, and a chatbot's own documents

> Brief for Claude Code. Read `docs/agents-v2/CONTEXT.md`, `CHUNK-02-NOTES.md`, `CHUNK-03A-NOTES.md` (sections 9–13) and `REVIEW-1-3A.md`, then this whole file, before writing code.
> Branch: the current Agents v2 branch, unless Shehbaz says otherwise. Repos: **ally-be** (most), **ally-web**. No ally-ai change is expected.

## Why this chunk exists

Testing a new bot by hand (Sunrise Mind Clinic, 2026-11-06) showed two things that get in the way of setting up a chatbot:

| What happened | Why it's a problem |
|---|---|
| To give the bot its FAQ, the PDF had to go into the shared library first, then be picked on the Knowledge tab. | A business's own documents aren't "shared". They belong to its chatbot, and other bots shouldn't see them in their picker. |
| A new bot starts on v1, with Agent mode off, and a platform admin has to switch it to v2 and turn Agent mode on in the Engine card. | v2 with Agent mode is the product now. The engine choice, Shadow and the Agent mode toggle are an internal switch, not something a bot owner should see or set. |

**Decisions (Shehbaz, 2026-11-06):**
1. **Hide v1, don't delete it.** Every bot answers with v2 and Agent mode. v1 stays only as the hidden fallback when `/agent/run` fails (timeout, outage), so a person still gets an answer. Deleting v1 is chunk 25 / Stage 3, as planned.
2. **Private and shared documents.** Uploading on a chatbot's Knowledge tab creates a document only that chatbot sees and uses. Shared library documents can still be added to any chatbot. The library lists shared documents only.
3. **Quick replies and settings as agent rules come later, with chunk 4** (the Agent page and its rules) and chunk 13 (the Never list). Not in this chunk; see "Not in this chunk".

## Scope

### 1. v2 with Agent mode for every bot (ally-be, ally-web)

- **Effective engine.** Every bot answers with v2 and the conversational agent, whatever its stored `runtime` and `features`. Do it in the one place the decision is made (`resolveEngine` in `chatbot/engine/agent-runtime.ts`), so the rest of the engine is unchanged. The v1 fallback inside `AgentRuntimeRunner` stays exactly as it is.
- **Kill switch.** `agentRuntimeAllowed` (Defaults → Safety switches) stays as the platform's emergency switch: off sends every bot to v1, as today. Keep its copy, but make it read as an emergency switch ("Use the backup engine for every chatbot"), not as an opt-in. Decide its default with Shehbaz (see open questions).
- **Data.** New bots are created with `runtime = 'v2'` and `features = {"agent": true}`. Existing bots are migrated the same way, in a migration with a correct `down`. Keep the columns and the CHECK: they still let the fallback and any later per-bot exception work.
- **Shadow.** No new bot can be put in Shadow. Existing shadow bots move to v2 in the same migration. Keep the shadow code and table for now (a later chunk can delete them with v1).
- **Dashboard.**
  - Remove the Engine card from the Agent tab, and the "engine" wording from Overview and Preview.
  - Preview keeps the run id, the steps and the turn type, and still says when an answer came from the fallback ("Answered by the backup engine: v2 failed (timeout)").
  - The platform-admin note about the switch holding a bot on v1 stays, worded for the emergency switch.
- **API.** `PATCH /chatbots/:id` stops accepting `runtime` and `features.agent`: they are ignored and documented as such, not a 400, so an old dashboard tab doesn't break. Preview's `runtime` request field stays ignored, as today.
- **Quick replies.** Agent mode is now always on, so greeting, help and FAQ quick replies give way to the agent on every bot (the 3a rule). Crisis, consent (STOP/START), the bare `help` reply and the welcome message on a first message behave exactly as today.

### 2. A chatbot's own documents (ally-be, ally-web)

- **Ownership.** Add `kb_documents.owner_chatbot_id` (uuid, nullable, FK to `chatbots` with `ON DELETE SET NULL` or archive — decide and record which; indexed with `corpus`). Null means a shared library document (today's documents). Set means the document belongs to that chatbot.
  - Follow the existing ownership pattern (`owner_tenant_id` for `ally_guide_library`, `KB_OWNED_CORPORA`): ownership decides who can **see and manage** a document. Which documents a bot **answers from** is still `chatbot_documents`.
  - An owned document is attached to its chatbot when it's created, and can't be attached to another chatbot.
- **Upload on the Knowledge tab.** "Upload a document" (PDF, DOCX, paste, URL: the same extract → chunk → index pipeline and presigned upload as the library), titled by the owner. It shows in the bot's document list with its status (indexing, indexed, failed) and a "Private to this chatbot" label. "Add from the library" stays for shared documents.
- **Library.** The library (Knowledge base console) lists shared documents only (`owner_chatbot_id IS NULL`). A chatbot's private documents are managed on its Knowledge tab only: rename, replace the file, remove. Removing a private document archives it.
- **Topics.** The agent's `knowledge_topics` already come from the titles of the documents the bot answers from, so private documents are included with no ally-ai change. Check it in Preview.
- **Access.** Only the chatbot's editors (and platform admins) can upload or manage its private documents. Reuse `ChatbotAccessService`.
- **Data schema.** Update `DATA_SCHEMA.md` (the `kb_documents` row: the new column and what ownership means here).

### 3. Not in this chunk

- **Quick replies and general settings as rules for the agent.** Chunk 4 (the Agent page, AGENT.md) and chunk 13 (the Never list). The idea to take there:
  - Greeting, help and FAQ quick replies become plain-words rules the agent follows.
  - The decline wording becomes guidance among those rules.
  - "Something went wrong", rate limit, unsupported media and not-on-the-list stay fixed system messages, because no agent runs when they're sent.
  - Crisis keywords, the crisis check, STOP/START and rate limits stay fixed in code (`agents-v2-spec.md`: "Kept from today").
- **Deleting v1, Shadow and the parity tooling.** Chunk 25 / Stage 3.
- **The crisis classifier firing too often** for a clinic. Found in the Sunrise test: "bye" (0.2), "18 & not studying & anxiety" (0.6) and a dose question (0.7) all came back `is_crisis`, and ally-be acts on any crisis verdict whatever the confidence. It's the safety net for every bot, so it needs its own decision (prompt, a confidence floor, or a per-bot setting), not a quiet change here. Record it in NOTES as an open item for Shehbaz.

## Rules for this chunk

- Behaviour on WhatsApp is unchanged for crisis, consent, rate limits and access. v1 still answers when v2 fails.
- Existing tests keep their assertions. Where a test pins "v1 by default" or the Engine card, change it only because this chunk deliberately changes that behaviour, and list each such test in NOTES.
- Migrations follow the repo's rules: new files, a correct `down`, and no edits to merged ones.
- No prompt text changes. No new dependencies.

## Done when

- A new chatbot answers in Preview with v2 and the agent, with nothing to switch on.
- On a chatbot's Knowledge tab you can upload a PDF, see it index, and get answers cited from it. It doesn't appear in the library or in another bot's "Add from the library".
- Shared library documents can still be added, and are answered from as before.
- With `/agent/run` failing (ally-ai running with `AGENT_RUNTIME__ENABLED=false`, so the route answers 404), Preview still answers, from the backup engine, and says so.
- With the emergency switch on, every bot answers from v1.
- Tests, lint and typecheck pass in ally-be and ally-web (ally-web on Node 22). `CHUNK-03D-NOTES.md` is written: code map, decisions, every changed test and why, open items.

## How Shehbaz tests it

1. Create a new chatbot. Its Agent tab has no Engine card. Preview → "hi" answers with the agent: steps show `agent: smalltalk …`.
2. Knowledge tab → Upload a document → the Sunrise Mind Clinic PDF. It indexes. Ask "what are your timings on saturday?" → "9 am to 5 pm", cited from it.
3. Open the library: the Sunrise PDF isn't listed. Open another chatbot → Add from the library: it isn't offered there either.
4. Set `AGENT_RUNTIME__ENABLED=false` in `ally-ai/.env` and recreate the container (`docker compose -f docker-compose.local.yml up -d --force-recreate app`). Ask again in Preview → an answer from the backup engine, labelled as such. Set it back to `true` and recreate.
5. Defaults → turn the emergency switch on → Preview says the backup engine answered. Turn it off.

## Open questions for Shehbaz (answer before building)

1. **The emergency switch's default** for new environments and for production: on (v2 everywhere) or off (v1 until someone turns it on)?
2. **A deleted chatbot's private documents:** archive them (recommended: citations in old conversations still resolve) or delete them?
3. **Can a private document be shared later** ("Move to the library")? Recommended: not in this chunk.
