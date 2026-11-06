# Chunk 03d notes: v2 only, and a chatbot's own documents

Brief: [chunk-03d.md](./chunk-03d.md). Built 2026-11-06 on `feat/agents-v2-chunk-01-langgraph-runtime`.

## Decisions

| Question (brief) | Decision | Why |
|---|---|---|
| Hide or delete v1 | **Hide** (Shehbaz) | v1 is the backup when `/agent/run` fails. Deleting it is chunk 25 / Stage 3. |
| Private and shared documents | **Both** (Shehbaz) | Upload makes a bot's own document; library documents can still be added. |
| Quick replies as agent rules | **With chunk 4** (Shehbaz) | Designed with the Agent page and the Never list. |
| 1. The emergency switch's default | **Stays off** (`agentRuntimeAllowed: false` in `DEFAULT_WHATSAPP_SETTINGS`) | Defaulting it on would move every bot to v2 at deploy in any environment where the switch was never saved, production included. If ally-ai there doesn't have the runtime enabled, every message would fail over to v1 and alert. Locally the switch is saved on. Turning it on is a settings change per environment. |
| 2. A deleted chatbot's own documents | **Archived** with the bot | Citations in its old conversations still resolve. |
| 3. "Move to the library" | **Not built** | Not needed yet. |

## Code map

### ally-be

| File | What changed |
|---|---|
| `chatbot/engine/agent-runtime.ts` | `effectiveRuntime(settings)` is v2 while the switch is on, v1 otherwise. `EngineChoice` is `v1 \| v2`, and v2 always means the agent. The bot's `runtime`, `features` and Preview's `runtime` are no longer read. |
| `chatbot/engine/chatbot-engine.service.ts`, `chatbot-engine.types.ts` | `resolveEngine(settings)`. No shadow branch. `ChatTurn.runtime` is removed. |
| `chatbot/engine/agent-runtime-runner.service.ts` | Sends `features: {…stored, agent: true}`, so a bot saved without the flag still runs the agent. The v1 fallback is unchanged. `shadowFor` is kept but not called (deleted with v1). |
| `chatbot/service/chatbot.service.ts` | Covered in detail below. |
| `chatbot/controller/chatbot.controller.ts` | `POST :id/documents/upload-url`, `POST :id/documents/private`, `DELETE :id/documents/:documentId`. All need `WHATSAPP_BOT` edit permission plus the bot's editor role. |
| `chatbot/dto/chatbot.dto.ts` | `runtime`, `features` and Preview's `runtime` are documented as ignored. |
| `chatbot/entity/chatbot.entity.ts` | Defaults: `runtime = v2`, `features = {"agent": true}`. |
| `knowledge-base/entity/kb-document.entity.ts` | `ownerChatbotId`. |
| `knowledge-base/repository/kb-document.repository.ts` | `list` leaves out documents that belong to a chatbot (the library and every picker). |
| `knowledge-base/service/knowledge-base.service.ts` | `createChatbotUploadUrl`, `createForChatbot` and `archiveForChatbot`, detailed below. |
| `database/migrations/1980940000000-AgentForEveryChatbotAndPrivateDocuments.ts` | Existing bots → v2 + `agent: true`; column defaults; `kb_documents.owner_chatbot_id` (FK, index with `corpus`). `down` restores the defaults and drops the column; it can't restore each bot's old runtime. |
| `DATA_SCHEMA.md` | The `kb_documents` and `chatbots` rows. |

`chatbot/service/chatbot.service.ts`:
- `runtime` and `features` in a PATCH are ignored for everyone; Preview ignores `runtime`.
- `listDocuments` marks `private`.
- `setDocuments` always keeps the bot's own documents and refuses another bot's.
- New: `createDocumentUploadUrl`, `addOwnDocument`, `removeDocument` (its own document is archived; a shared one is only taken off the bot).
- Archiving a bot archives its own documents.

`knowledge-base/service/knowledge-base.service.ts`:
- `createChatbotUploadUrl` uploads into `knowledge-base/chatbots/<id>/`.
- `createForChatbot` creates the document in `whatsapp_qa`, owned by the bot, not global and with no organisations. It is reached only through the bot's `document_ids`. It checks the file was uploaded for this bot.
- `archiveForChatbot` returns 404 for a shared or another bot's document.
- `archive` was split into `archiveFound`, so the chatbot path skips the organisation check. Without that, an organisation's editor of a chatbot couldn't remove its own document, which is targeted at no organisation.

### ally-web (`apps/ally-admin-dashboard/src`)

| File | What changed |
|---|---|
| `pages/WhatsAppBot/ChatbotEngineCard.tsx` | **Deleted.** | <!-- docs-path-lint: ignore -->
| `pages/WhatsAppBot/AgentTab.tsx` | No Engine card. Platform admins see a note when the switch is off ("…answers with the backup engine"). |
| `pages/WhatsAppBot/ChatbotTestTab.tsx` | Badge: "Answered by the agent", "Answered by the backup engine (the agent failed: …)" or "Answered by the backup engine". |
| `pages/WhatsAppBot/KnowledgeTab.tsx`, `KnowledgeUploadPanel.tsx` (new) | Covered in detail below. |
| `api/chatbots.ts`, `constants/common.ts`, `types/chatbots.ts`, `constants/en.ts` | Endpoints, types (`ChatbotDocumentRow.private`; `runtime` and `features` gone from the update request) and copy. The Defaults switch now reads "Answer with the agent: turn off only in an emergency…". |

The Knowledge tab:
- **"Upload a document":** a PDF, Word or EPUB file up to 25 MB, or pasted text. The title defaults to the file name.
- **The document list:** a "Private to this chatbot" tag, plus "Indexing…" or "Failed". The list refreshes every 4 s while anything is still indexing.
- **Removing a private document:** asks to confirm, then deletes it.

## Tests changed because the behaviour changed on purpose

| Spec | Was | Now |
|---|---|---|
| `chatbot-engine.service.spec.ts` | "lets the kill switch win over a forced v2 in Preview" | "answers Preview with v1 too while the kill switch is off" |
| | "follows the bot's own setting…", "lets Preview force v1…" | "answers every bot with v2 once the kill switch is on, whatever runtime it stored" |
| | "calls /agent/run with v1's body plus the run's four fields" | "…plus the run's fields and the agent's" (`features`, `knowledge_topics`, `decline_text`, the agent prompt's model) |
| | "a shadow bot" (3 tests) | removed: a bot can't be in Shadow |
| `chatbot-engine-agent-mode.spec.ts` | "gives %s every template" for v1 / flag off / no features / shadow / kill switch | "gives every bot every template under the kill switch", plus "lets the agent answer greetings for %s" for each saved state |
| | "lets Preview force v2 for an agent bot saved on v1" | removed |
| | "sends none of it for a v2 bot with the flag off" | "sends Agent mode on for a bot saved with it off" |
| `chatbot.service.spec.ts` | PATCH runtime: refuses non-admins / lets an admin set it | "ignores it, from anyone" |
| | "lets only a platform admin force an engine for one test" | "ignores an engine asked for in the test" |
| `chatbot-agent-mode.service.spec.ts` | PATCH features: 3 tests (admin only, merged, known flags only) | "ignores Agent mode in a PATCH, from anyone" |
| `whatsapp-inbound-agent-runtime.spec.ts` | "a v1 bot" | "under the kill switch" |
| | "a shadow bot" (3 tests) | removed |
| `whatsapp-inbound-agent-first-message.spec.ts` | "leaves a v1 bot exactly as before" | "gives no notice on a first answer under the kill switch, as v1 always did" |
| ally-web `AgentTab.test.tsx` | Engine (3) and Agent mode (4) blocks | "no Engine card" (3) |
| ally-web `ChatbotTestTab.test.tsx` | the badge text | the new badge text, plus a test for the switch-off note |

**New tests:**
- `chatbot-documents.service.spec.ts` (7);
- `knowledge-base.chatbot-documents.spec.ts` (5);
- ally-web `KnowledgeTab.test.tsx` (8).

## Verification

| Check | Result |
|---|---|
| ally-be: chatbot, whatsapp, knowledge-base, ai, llm and migrations specs | 89 suites, **1,144 passed** |
| ally-be: lint (touched folders), typecheck, `docs-path-lint` | Clean. Four broken doc paths from my 3a/3r docs, which existed before this chunk, are fixed. |
| ally-web (Node 22): whole admin project | 540 files, **8,350 passed** (run by the web build) |
| ally-web: WhatsAppBot folder again, and the CI typecheck | 85 passed; clean |
| Migration on `ally_local` | Applied; both bots on v2 with `agent: true`; `owner_chatbot_id` exists |

Not run: the full ally-be suite, `build`'s e2e, ally-ai (unchanged).

## How Shehbaz tests it

Follow [chunk-03d.md](./chunk-03d.md), "How Shehbaz tests it". Refresh the dashboard first: the Engine card is gone.

## Open items

- **The crisis classifier fires too often for a clinic.** "bye" (0.2), "18 & not studying & anxiety" (0.6) and a dose question (0.7) all came back `is_crisis`, and ally-be acts on any verdict whatever the confidence. It's the safety net for every bot, so it needs Shehbaz's decision: the prompt, a confidence floor, or a per-bot setting.
- **Shadow and v1 leftovers.** `AgentRuntimeRunner.shadowFor`, `ChatbotShadowService`, the `agent_shadow_runs` table, `chatbots.runtime` and `features.agent` stay until v1 is deleted (chunk 25).
- **The knowledge-base console's search** (an admin tool) can still return passages from a chatbot's own documents. Only the list and the pickers leave them out.
- **The emergency switch in production:** turn it on (Defaults → "Answer with the agent") once ally-ai there has `AGENT_RUNTIME__ENABLED=true` and the checkpoint database.
