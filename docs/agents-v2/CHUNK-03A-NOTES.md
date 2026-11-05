# Chunk 03a notes: conversational agent

**Branch:** `feat/agents-v2-chunk-01-langgraph-runtime` (Shehbaz: stay on the current branch). **Repos:** ally-ai (most), ally-be, ally-web.

Plan approved 2026-11-05. Sections 2 onwards (what was built, decisions, how to test, open items) are written at the end of the chunk.

## 1. Code map: what exists today (read before building)

**Model calls and tool calling.** `ally-ai/app/core/llm/dispatch.py::generate_structured` is structured output only:
- OpenAI uses `response_format` json_schema (non-strict).
- Gemini uses `response_schema`.
- Anthropic uses a forced internal tool, `emit_result`, or `output_config.format`.

There is **no tool-calling path**. It owns usage emission (`_emit_usage`), the provider fallback, and the gpt-5/o-series temperature rule (temperature is sent only when truthy and the model isn't gpt-5/o*). LangChain `ChatOpenAI` exists only in `text_generations/` and `dependencies.py`. `langchain-anthropic` is deliberately absent (`pyproject.toml:33-37`).

→ **Decision (Shehbaz):** the agent uses a **structured "step"** through `generate_structured`. Each call returns either a tool call or the final reply, and the loop runs in code. All 3 providers work, with the same usage accounting, fallback and temperature handling, no new dependency, and no new PHI destination. Runs stay inside `tracing_context(enabled=False)` as today.

**Keyword templates** live in the table `wa_keyword_templates` (`whatsapp/entity/wa-keyword-template.entity.ts`).
- **Category:** they carry one, `kind` = `crisis | command | consent | faq` (`whatsapp/enum/whatsapp.enum.ts:81-90`). There is no stable key, only a free-text `name`.
- **Scope:** rows are global (`chatbotId` NULL) or per bot. A bot row can override a global one through `overridesTemplateId`, and it inherits kind, priority and `mandatory`.
- **Seeded rows** (`migrations/1892000000008-…:68-150`):

  | Name | Kind | Priority | Mandatory | Matches |
  |---|---|---|---|---|
  | Immediate risk | crisis | 10 | yes | |
  | Opt out | consent | 110 | yes | |
  | Opt back in | consent | 120 | yes | |
  | Greeting | command | 210 | no | exact: hi / hello / hey / namaste / start chat |
  | Help | command | 220 | **yes** | exact: help / menu / what can you do / options |

- `ChatbotReplyService.match` (`chatbot/service/chatbot-reply.service.ts:65-140`) normalises the text and takes the first match by priority. The engine (`chatbot-engine.service.ts:169-213`) uses a match only if `bypassRag`. A greeting match on a bot with `persona.greeting` returns the welcome (`isWelcome`).
- **STOP/START** is a separate path in inbound, *before* the engine (`whatsapp-inbound.service.ts:50-51, 285-294, 436-505`), so the engine skip can't affect it.
- The **welcome** is `persona.greeting`. It is joined with `disclaimerText` on message 1 (`first-reply.ts`).
- There is **no "HELP crisis command"**. Help is a non-crisis command, with fixed "not a crisis service / no medical advice" wording.

**composeReply and unanswered.**
- `whatsapp/util/reply-composer.ts` builds the body as `answer || declineText`. It adds Sources only for `answer` with citations, and adds no disclaimer.
- `toDecision` (`chatbot-engine.service.ts:519-549`) maps answer → RAG, clarify → CLARIFIED, else DECLINED. **Only a decline is filed as unanswered.**
- **`retrieval.unsupported` is never read in ally-be.** It just passes into `retrieval_meta`.

→ An uncited small-talk reply sent as `intent: answer` is RAG and not filed, so **no ally-be change is needed** for that. A test pins it.

**Prompts and `make sync-prompts`.**
- `ally-ai/Makefile` → `scripts/sync_prompts.py` scans `app/prompts/<folder>/<name>.txt`. The code becomes `ally_ai_<folder>_<name>`, the metadata comes from `app/prompts/contracts.py` (`PromptInputs` subclasses), and it POSTs to ally-be `/api/v1/prompts/sync`.
- ally-be sends ally-ai only the codes in `KNOWLEDGE_PROMPT_CODES` (`chatbot-engine.service.ts:54-59`, loaded by `loadPromptOverrides` :597-652). The bot's model is merged into the answer and general codes only.
- So `agent/contextualize.txt` → `ally_ai_agent_contextualize` and `agent/system.txt` → `ally_ai_agent_system`, which matches the brief's names.

**Judge pattern.** It exists: `app/core/{filler,rag,debrief}_quality/judge.py`. Each calls `generate_structured(..., never_fallback=True)` with a pinned `settings.<X>_JUDGE.MODEL` and a `PROMPT_VERSION`. The eval reuses that call pattern with a rubric local to the script (eval-only, not a Skills Store prompt).

**Other facts.**
- History reaches ally-ai as the last 6 `{role, content}` turns (`recentHistory`, inbound :520-538), or Preview's `dto.history`.
- `buildAgentRunRequest` (`chatbot/engine/knowledge-request.ts:39-56`) does **not** send `features`.
- Document titles: `listDocuments` (`chatbot.service.ts:376-403`) joins `chatbot_documents` with `kb_documents`.
- `features` jsonb exists, but **no API sets it**. Runtime's admin gate is `chatbot.service.ts:300-303`, `516`.
- Preview: `RunDetails` in ally-web renders `node · ms` only, **not `summary`**.

**Differences from the brief (the code wins):**
1. "`answer` with no valid citations → decline, **as today**" is wrong. Today `check` keeps an uncited answer and only sets `retrieval.unsupported=True` (`agent.py:676-684`). Agent mode makes it a decline (stricter). v1 and flag-off stay as they are.
2. "Copy the safety rules from the current answer prompt": `whatsapp_answer.txt` has **no** safety rules, only grounding. The safety wording lives in ally-be: `disclaimerText`, the Help and crisis template text, and `crisisEscalationText`. The agent prompt takes its meaning from those.
3. There is no "HELP crisis command" (see above). **Decision (Shehbaz):** keep only an exact `help` on agent bots; "what can you do", "menu" and "options" go to the agent.
4. Templates *do* carry a category (`kind`), so the skip is by kind (keep `crisis` and `consent`) plus one pattern rule. No allow-list of template keys is needed.
5. The welcome isn't a template but `persona.greeting` on a greeting match. **Decision (Shehbaz):** on agent bots it is kept on the first message only, when a welcome is set.
6. `features` isn't sent today, and no API sets it. 3a adds both.
7. ally-be would never send a new prompt code unless it is added to the code list. 3a loads the 2 agent codes **only for agent-mode runs**, so the v1 request snapshot is unchanged.
8. The brief puts persona inside the instructions at position 4. The existing `format_persona` *prepends* a fenced persona block that explicitly ranks itself below the rules that follow. 3a reuses it, so the effective order still has rules winning.
9. `documents_and_general` bots: the brief is silent. In agent mode they keep strict grounding, and an uncited answer is allowed only as today's "general information" path (see check rules). This is listed as an open item.
10. Two new model calls (contextualise, agent step) need 2 `LLMTask` values plus 2 ally-be registry rows. The registry is per call (CLAUDE.md rule), which the brief doesn't mention.

### Decisions taken at plan time (Shehbaz, 2026-11-05)
1. `documents_and_general` bots in agent mode: as planned (strict grounding plus today's uncited "general information" exception).
2. Small talk stays `handledBy` RAG, with `turn_type` in `retrieval_meta`. A separate category is chunk 12.
3. Organisation-source bots send `knowledge_topics: []` for now.
4. Logging tool searches to the retrieval log is chunk 3b.
5. Wiki: the same `Wiki-PR:` trailer as chunks 1–2.
6. **Latency fallback.** If p50 misses +25%, the first step is a lower reasoning effort for the agent step only, recorded in NOTES. `dispatch.py` doesn't support this today: it sends no `reasoning_effort`. So the change would be an optional `reasoning_effort` argument on `generate_structured`/`_generate_openai`, sent only to gpt-5 and o-series models, defaulting to None so every existing caller is unchanged. It would be set from a setting (`AGENT_RUNTIME__AGENT_REASONING_EFFORT`, unset by default). This is done only if the budget fails.

Also decided at plan time:
- The agent calls the model through a **structured step** on `generate_structured`, not LangChain `bind_tools` (see the model-calls entry above).
- On agent bots, only an exact `help` keeps the fixed Help template; "what can you do", "menu" and "options" go to the agent.
- The welcome (`persona.greeting`) is kept on the first message only.
- `v2-chunks.md` was replaced by the 3a/3b/3c split.
- **First-message notice:** today it follows only the welcome. In agent mode, a `smalltalk` or `about_bot` first reply also counts as a welcome, so the notice follows it. A first question stays notice-free, as in v1.
