# Chunk 03a notes: conversational agent

**Branch:** `feat/agents-v2-chunk-01-langgraph-runtime` (Shehbaz: stay on the current branch). **Repos:** ally-ai (most), ally-be, ally-web.

Plan approved 2026-11-05. Eval report: [CHUNK-03A-EVAL.md](./CHUNK-03A-EVAL.md).

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

## 2. What was built

### ally-ai

| File | What it is |
|---|---|
| `app/schemas/agent_runtime.py` | The request adds `features`, `knowledge_topics` (at most 50, each trimmed to 200 characters) and `decline_text`. The response adds `turn_type`, which is **omitted** (not null) while the agent is off, so the flag-off response is byte-for-byte the chunk 1 shape. |
| `app/core/agent_runtime/graph.py` | One graph, routed at `START` on `bot.features.agent`: `translate → …` (unchanged) or `agent ⇄ tools → agent_check (→ agent once, if it refused the draft) → finalize`. *Revised, section 9: no contextualise or prefetch step.* |
| `app/core/agent_runtime/conversation.py` | The model call, through `generate_structured`: `agent_step()`. |
| `app/core/agent_runtime/schemas.py` | `AgentIntent`, and `step_schema(tools)`, which builds `AgentStep` from the registry. `action` is a str **Enum** (not a Literal, so a one-value schema renders `enum`, not `const`), plus one input field per tool, plus `turn_type` and the reply fields. |
| `app/core/agent_runtime/tools/` | The registry: `base.py` (`Tool`, `ToolContext`, `ToolResult`), `search_knowledge.py`, and `__init__.py` (`REGISTRY`, `allowed_tools(bot)`). |
| `app/core/agent_runtime/check.py` | `check_reply()`, the rules in section 1 / plan, as a pure function, returning the result and a rejection reason; `looks_factual()`; `REJECTIONS`. |
| `app/core/agent_runtime/prompt.py` | Renders topics, searches, tools and the rewrite feedback; prepends the persona with the existing `format_persona`. |
| `app/core/agent_runtime/nodes/{agent,tools,agent_check}.py` | The new nodes. Every node, and each tool call, adds a trace step with counts only. A tool step is `{node: "tool", summary: "search_knowledge: 2 hits, 1 new passages, best 0.61"}`. |
| `app/core/agent_runtime/state.py` | New run-scoped keys (reset on every run). |
| `app/core/knowledge_agent/agent.py` | **Refactor only:** `decline()`'s retrieval-log call is extracted as `report_gate_decline()`, so the agent's first search can log a weak result without declining. |
| `app/core/llm/dispatch.py` | Optional `reasoning_effort` on `generate_structured`, sent to OpenAI gpt-5/o-series only; None (the default) sends nothing, so every existing caller is unchanged. |
| `app/core/config.py` | `AGENT_RUNTIME__MAX_TOOL_CALLS` (4) and `AGENT_RUNTIME__AGENT_REASONING_EFFORT` (unset). |
| `app/core/llm_usage/tasks.py` | `WHATSAPP_AGENT_STEP`. |
| `app/prompts/agent/system.txt`, `app/prompts/contracts.py` | **New seed prompt** `ally_ai_agent_system`, with its contract. No existing prompt text changed. |
| `scripts/agent_conversation_eval.py`, `tests/fixtures/agent_conversation_cases.yaml` | The conversation eval (32 cases, 34 turns). |

### ally-be

| File | What it is |
|---|---|
| `chatbot/dto/chatbot.dto.ts`, `chatbot/service/chatbot.service.ts` | `PATCH /v1/chatbots/:id` takes `features: {agent}`; `assertPlatformAdmin()` as for `runtime`; only the `agent` key is written, merged into the saved flags. Preview returns `turnType` and passes `isFirstMessage`. |
| `chatbot/engine/agent-runtime.ts` | `isAgentMode(chatbot, settings, requested)`: effective runtime v2 (kill switch and Preview override included) and `features.agent === true`. |
| `chatbot/engine/chatbot-engine.service.ts` | `agentAnswersInstead()` (the keyword skip); the agent prompt codes and the bot model on `ally_ai_agent_system`, in agent mode only; `knowledgeTopics()` (titles, ≤ 50, non-archived); `turn_type` into `retrieval_meta`; `isWelcome` for an agent `smalltalk` / `about_bot` reply. |
| `chatbot/engine/knowledge-request.ts` | `buildAgentRunRequest` adds `features`, `knowledge_topics`, `decline_text` **only when given** (agent mode). |
| `chatbot/engine/chatbot-engine.types.ts`, `whatsapp/service/whatsapp-inbound.service.ts` | `ChatTurn.isFirstMessage`, set from the contact's `messageCount === 1` on WhatsApp. |
| `ai/dto/knowledge.dto.ts` | The new request fields and `turn_type`. |
| `learn/enum/llm-task.enum.ts`, `llm/constants/ai-task-registry.constants.ts` | One `LlmTask` member and one registry row (`whatsapp-agent-step`). |
| `DATA_SCHEMA.md` | The `features.agent` key (no migration). |

### ally-web (`apps/ally-admin-dashboard/src`)

| File | What it is |
|---|---|
| `pages/WhatsAppBot/ChatbotEngineCard.tsx` | **Agent mode** toggle (with a tooltip), shown to platform admins while the engine is v2; saved with **Save engine**, sending only what changed. |
| `pages/WhatsAppBot/ChatbotTestTab.tsx` | Steps read `summary · ms` (falling back to `node · ms`), tool steps prefixed `tool ·`; a turn-type chip next to the engine badge. |
| `constants/en.ts`, `types/chatbots.ts` | Copy and types. |

### Tests added

| App | Spec | Count | Covers |
|---|---|---|---|
| ally-ai | `tests/core/agent_runtime/test_agent_graph.py` | 24 | contextualise and follow-ups (mocked), degrade, smalltalk/about_bot/unclear skip retrieval, persona/topics/decline in the prompt, numbering continues, tool step counts only, cap at 4 (5th call reply-only), lower cap, uncited answer → decline with no text, gate reason kept, retrieval log once / skipped, the bot's model on the agent step, tracing disabled, JSON state, flag off = chunk 1 graph, a thread switching paths, reasoning effort |
| ally-ai | `test_agent_check.py`, `test_tools.py`, `test_agent_endpoint.py`, `tests/core/llm/test_dispatch_reasoning_effort.py` | 25 + 9 + 4 + 5 | check rules; registry and `search_knowledge`; endpoint shape; `reasoning_effort` only to reasoning models |
| ally-be | `chatbot/engine/test/chatbot-engine-agent-mode.spec.ts` | 28 | templates skipped / kept (crisis, consent, bare `help`, first-message welcome), every template for v1 / flag off / shadow / kill switch, request fields, prompts and model, titles (draft, organisation, failure), small talk not filed, first-message notice flag, crisis overrides small talk |
| ally-be | `chatbot/service/test/chatbot-agent-mode.service.spec.ts` | 8 | features PATCH admin-only and merged, unknown keys dropped, GET, Preview `turnType` and `isFirstMessage` |
| ally-be | `whatsapp/service/test/whatsapp-inbound-agent-first-message.spec.ts` | 5 | the notice after the agent's "who I am" on message 1; crisis alone; first question no notice; later messages; v1 unchanged |
| ally-web | `ChatbotAgentMode.test.tsx`, `ChatbotTestTabAgentMode.test.tsx` | 4 + 3 | toggle admin-only, v2-only, saves only what changed; tool step summary; turn-type chip |

Every existing test is unmodified.

### Results

| App | Result |
|---|---|
| ally-ai | **1,838 passed**, 33 skipped. flake8 clean. |
| ally-be | **963 suites, 14,059 tests pass** (chunk 2: 960 / 14,018). Lint and typecheck clean. |
| ally-web | Admin dashboard **540 files, 8,338 tests pass**. Lint 0 errors; CI typecheck clean. **Helpline dashboard: 14 snapshot tests fail** (DatePicker, TimePicker, Calendar, Settings, Search, StressBuster, PostSimulationSummary, AccessDenied): the stored snapshots escape quotes (`\"`) and the renderer no longer does. Not touched by this chunk (no helpline or `ui-shared` file changed); not fixed here. Under the pre-commit hook's parallel load more helpline tests time out. |

## 3. Decisions (beyond the plan)

- **The model call is a structured step** (Shehbaz). `step_schema(tools)` makes a tool that isn't offered impossible to name; past the cap the schema is reply-only.
- **`features` is sent only in agent mode.** The chunk 2 engine spec pins the v2 body to "v1's body plus four run fields". ally-ai reads no `features` as "agent off", so the flag-off request is unchanged.
- **The `turn_type` key is omitted when the agent is off**, rather than null, for the same reason: the chunk 1 endpoint test pins the response's extra fields.
- **A refused draft is rewritten once, then cleared** (*revised, section 9*). When check refuses an uncited answer (or small talk with an unsourced detail), the agent is told why and writes the reply again; only a second refusal clears the text, and ally-be then sends the bot's `declineText`. A decline the model chose keeps its own words.
- **The agent's first search logs retrieval exactly as the parity path would** (once per message: "answered" when it clears the threshold, else `declined_no_hits` / `declined_below_threshold`), even though the run goes on. Small talk logs nothing (no search). Later searches in the same message aren't logged (chunk 3b).
- **`isFirstMessage` on `ChatTurn`.** WhatsApp's `history` already contains the message being answered (it's stored at dedupe, before the engine runs), so `history` can't tell a first message.
- **The step schema's `action` is an Enum**, not a Literal: a one-value Literal renders JSON Schema `const`.
- **The eval judge** follows the repo pattern (`generate_structured(never_fallback=True)`, pinned model, default gpt-5-mini) with a script-local rubric; it's not a Skills Store prompt.
- **The agent system prompt was revised once after the first eval run** (it's a new seed from this chunk, never released): persona facts and links need a passage too; no jokes or off-topic tasks; "not a crisis service" only when saying who it is; `decline` whenever it isn't doing what was asked. See section 5.
- **Latency: reasoning effort `low` for the agent step** (Shehbaz's rule: try this first if p50 misses +25%). See section 5.

## 4. Conversation eval and parity (the results)

Full report: [CHUNK-03A-EVAL.md](./CHUNK-03A-EVAL.md) (every turn, every reply, judge notes). Local stack, rebuilt ally-ai image, Ally FAQ persona and decline wording, all 7 documents, `features.agent` on, `AGENT_RUNTIME__AGENT_REASONING_EFFORT=low`.

| Measure | Result | Bar |
|---|---|---|
| **Hard fails** | **0** of 34 turns | 0 |
| Automatic check fails | 0 | |
| `turn_type` as expected | 94% (29 of 31; `ab-hinglish` "hi, ye kya hai?" → `question`, still answered as about-the-bot) | reported only |
| Natural and on-persona (judge, gpt-5-mini) | mean **4.71**, min 4 | reported only |
| In scope: same documents as v1 | **100%** of 9 | ≥ 80% |
| p50 in scope: agent / parity mode | 6,561 ms / 8,133 ms, **−19%** | ≤ +25% |

**Parity with Agent mode off** (`scripts/agent_parity.py`, 22 cases, master baseline): **0 must-match failures**, 0 baseline failures, 2 "translation differs" (`lang-marathi`, `lang-hinglish`; sampling, as in chunk 1), p50 v1 6,282 ms / v2 6,109 ms (−2.8%).

What reading the replies shows (not failures, worth knowing):
- **It over-introduces itself.** Most small talk and some answers add "I'm Ally FAQ (not a crisis service)" and the topic list, even on "thanks" and "bye", despite the rule. Brief and safe, but repetitive. Tune the live prompt text in Manage Prompts if it bothers you; it's not a code change.
- `www.helloally.ai` appears in three replies. It *is* in four of the seven documents, so this is allowed by the passages rule.
- The medical-advice and injection cases decline cleanly, and `push-dose` points to the prescriber or a supervisor.

## 5. How the eval got there (two runs)

| Run | Change | Hard fails | Check fails | Judge mean | p50 vs parity |
|---|---|---|---|---|---|
| 1 | as first built (default reasoning effort) | **1**: `st-dhanyavaad` said "non-profit platform" (from the persona) uncited | 1: `out-mausam` declined in substance but as `smalltalk` (so not filed) | 4.53 (min 2: `push-joke` told the joke) | **+25.4%** (10,332 / 8,242 ms): over budget |
| 2 | prompt revised + reasoning effort `low` | **0** | 0 | 4.71 (min 4) | **−19%** |

**Prompt revision** (`app/prompts/agent/system.txt`, a seed new in this chunk and never released; no existing prompt changed):
- rule 1: no jokes, stories, games or general tasks; decline them kindly;
- rule 2: facts, names, links or contacts from the persona need a passage too;
- rule 3: "not a crisis service" only when saying who it is;
- `decline` whenever it isn't doing what was asked, even when it offers alternatives; `smalltalk` never for a request it isn't doing.

Locally, sync never overwrites an existing prompt's text, so the first-synced row for `ally_ai_agent_system` (created by this chunk's sync 30 minutes earlier) was deleted from `prompts` / `prompts_versions` / `prompt_translations` in `ally_local` and re-synced. Elsewhere the prompt doesn't exist yet, so the seed is what gets created.

**Latency** (Shehbaz's rule: first try a lower reasoning effort for the agent step). `dispatch.py` had no way to send it, so `generate_structured` gained an optional `reasoning_effort` (OpenAI gpt-5 / o-series only; None by default, so every other caller is unchanged), and `AGENT_RUNTIME__AGENT_REASONING_EFFORT` (unset in code) passes it to the agent step only. With `low`, the agent step went from about 5–9 s to about 3–5 s, and quality held (above). **Production must set `AGENT_RUNTIME__AGENT_REASONING_EFFORT=low`** for these numbers; unset, the agent is about 25% slower than parity mode. Nothing else was changed for latency.


## 6. How Shehbaz tests it

**Ports:** dashboard http://localhost:8081 · ally-be `localhost:8001` (container `ally-be-app-1`) · ally-ai `localhost:3001` (container `ally-ai-app-1`, a baked image).

### 1. Suites and lint
```bash
cd ally-ai  && poetry run pytest tests/ -q && poetry run flake8
cd ally-be  && npm test -- --forceExit --detectOpenHandles && npm run lint && npm run typecheck
cd ally-web && nvm use 22 && npm test && npm run lint && npx tsc --noEmit -p apps/ally-admin-dashboard/tsconfig.app.json
```
Focused: `poetry run pytest tests/core/agent_runtime -q` · `npx jest src/chatbot src/whatsapp/service/test/whatsapp-inbound-agent-first-message.spec.ts` · `npx vitest run --project ally-admin-dashboard src/pages/WhatsAppBot`. Expect the 14 helpline snapshot failures (section 2) in `npm test` for ally-web.

### 2. Publish the prompts and rebuild ally-ai
```bash
cd ally-ai
KEY=$(grep '^ALLY_CORE__API_KEY=' .env | cut -d= -f2-)
ALLY_CORE__ENDPOINT=http://localhost:8001 ALLY_CORE__API_KEY=$KEY poetry run python scripts/sync_prompts.py
docker compose -f docker-compose.local.yml up -d --build app
```
- `make sync-prompts` is the same script, but it reads the two variables from the environment, not from `.env`, and `.env`'s endpoint is the in-Docker `host.docker.internal`; hence the override above.
- Expect `1 added` the first time (**Manage Prompts → "Chatbot Agent: Instructions"** appears). Sync never overwrites an existing prompt's text: to change it later, publish a new version in Manage Prompts.
- `ally-ai/.env` needs `AGENT_RUNTIME__ENABLED=true`, the checkpoint URL (chunk 1), and now `AGENT_RUNTIME__AGENT_REASONING_EFFORT=low` (added locally).
- ally-be: if it was already running, `docker restart ally-be-app-1` (its file watcher missed this chunk's changes here).

### 3. Switch on Agent mode
**Dashboard → AI Chatbots → Ally FAQ → Settings → Engine** (platform admins only): choose **v2**; the **Agent mode** toggle appears under the options; turn it **On**; **Save engine**. Defaults → Safety switches → *Allow the new engine* must be On (chunk 2). Ally FAQ must have all 7 "Ally FAQ –" documents under **Knowledge**.

### 4. Preview script
**Ally FAQ → Preview → New thread**, then send these in order. Under each reply read: the text, **Handled by**, the engine badge (**Answered by v2**), the **turn-type chip** next to it, and **Steps (n)** (open it).

| # | Send | Expect |
|---|---|---|
| 1 | `Hello` | Ally FAQ has a welcome message, so this first hello gets **the welcome plus the notice** (a fixed template, no run, no chip): the first-message welcome is kept. |
| 2 | `who are you?` | A short reply naming Ally FAQ, listing its topics, saying it isn't a crisis service. Chip **About the chatbot**; Handled by RAG; no sources. Steps: `agent: about_bot, smalltalk via … · check … · finalize` — one model call, no search. |
| 3 | `what can you do?` | The agent, not the Help template: the 7 topics in its own words. Chip **About the chatbot**. |
| 4 | `how do I get access?` | A cited answer (source: Getting Access and Signing In). Chip **Question**; steps: `agent: question, calls search_knowledge` · `tool · search_knowledge: N hits, N new passages, best 0.xx` · `agent: question, answer` · check · finalize. |
| 5 | `and after that, how do I sign in?` | Understood from turn 4: a cited sign-in answer. The agent searches with its own rewritten query (not the literal message). |
| 6 | `what's your refund policy?` | It searches, finds nothing, and says so in its own words (naming refunds), suggesting where to go and one thing it can help with; no refund policy, no link. Handled by **Declined**, *Would be filed as unanswered*. |
| 7 | `thanks!` | A warm one-liner. Chip **Small talk**; Handled by RAG; **not** filed as unanswered. |
| 8 | `help` | The fixed **Help** template (kept on purpose), no run. |

Then **New thread** and send `hi, ye kya hai?`: a Hindi/Hinglish reply naming the bot and its topics (first message, no welcome match, so the notice follows it).

To force a tool step: **New thread**, `What are streaks?` then `and do they reset?`.

### 5. Agent mode off
**Settings → Engine → Agent mode Off → Save engine.** New thread in Preview, send `what can you do?` → the fixed **Help** template is back; then `Hello` → Ally FAQ's welcome message again (v1 behaviour: a bot with a welcome answers every hello with it). v2 answers exactly as chunk 2.

### 6. Eval and parity
```bash
cd ally-ai
KEY=$(grep '^API__X_API_KEY=' .env | cut -d= -f2-)
API__X_API_KEY=$KEY poetry run python scripts/agent_conversation_eval.py \
  --cases tests/fixtures/agent_conversation_cases.yaml   # writes ../docs/agents-v2/CHUNK-03A-EVAL.md
API__X_API_KEY=$KEY poetry run python scripts/agent_parity.py \
  --cases tests/fixtures/agent_parity_cases.yaml --base-url http://localhost:3001 \
  --baseline tests/fixtures/parity_baseline_master.json
```
Expect eval exit 0 (no hard fails) and parity `must-match failures: 0`. Read `CHUNK-03A-EVAL.md`'s **Replies** section.

### 7. Stored state
```sql
-- ally_local
select retrieval_meta->>'turn_type', handled_by from wa_messages
 where direction = 'outbound' and agent_runtime = 'v2' order by "createdAt" desc limit 5;
select features from chatbots where name = 'Ally FAQ';            -- {"agent": true}
```

## 7. Commits, in review order

**Chunk 3a**
```
5b1547e74 docs(agents-v2): chunk 3a brief, split chunk plan; current chunk is 03a
282740df5 docs(agents-v2): chunk 03a code map
d2691c823 feat(agent-runtime): agent contract, tool registry with search_knowledge, and agent prompts
c482dc8c0 feat(agent-runtime): conversational agent path behind features.agent
f923fc6f3 feat(chatbot): Agent mode — features.agent, keyword replies give way, agent request fields
85b5e1940 feat(admin-dashboard): Agent mode toggle and Preview tool steps and turn type
f9ada7d69 feat(agent-runtime): conversation eval; reasoning effort for the agent step; agent prompt revised after the eval
(this notes commit) docs(agents-v2): chunk 03a notes and conversation eval
```
Chunks 1 and 2 are listed in `CHUNK-02-NOTES.md` §7. One PR for all three, as decided for chunk 2, unless you say otherwise.

## 8. Open items

- **Wiki** (decided: the same `Wiki-PR:` trailer). This chunk touches `app/api/v1/endpoints/**` again; the ally-ai wiki PR is still owed from chunk 2.
- **Same run id, same thread → the stored run is returned.** Found while testing: on the chunk 1 graph too, a second `/agent/run` with the same `run_id` in the same thread returns the first run's state without running (LangGraph). On WhatsApp, `run_id` is derived from the provider message id, so a redelivered message gets the stored answer: effectively idempotent, but it should be a written decision (chunk 3b, idempotency).
- **The existing `whatsapp_*` LLM tasks have no `LlmTask` member** in ally-be (`whatsapp_rag_answer`, `whatsapp_query_translate`, `whatsapp_crisis_classify`), so their usage lands in `UNKNOWN`. The two new ones do have members. Not fixed here.
- **WhatsApp history includes the message being answered** (pre-existing): the latest message appears twice in the prompts (history and "latest message"). Harmless in the eval; worth trimming in `recentHistory` in a later chunk.
- **Persona text vs grounding.** The Ally FAQ persona tells the bot to give `www.helloally.ai` and "the helplines"; the agent's rules now override that unless a passage says it. If those should be said, they belong in a document (or, later, Facts, chunk 5).
- **Organisation-source bots** send `knowledge_topics: []` (decided).
- **Tool searches aren't in the retrieval log** (decided: chunk 3b).
- **Small talk counts as `handledBy` RAG** (decided: its own category is chunk 12); `retrieval_meta.turn_type` tells it apart.
- **Reasoning effort** is a platform setting (`AGENT_RUNTIME__AGENT_REASONING_EFFORT`), unset in code. Production needs it set to match what was measured here.
- **Helpline snapshot failures** (section 2).
- **Checkpoint retention** (from chunk 1) still open; eval threads (`eval-…`) add rows.

## 9. Revision after Preview feedback (2026-11-06)

**What Shehbaz saw.** `who are you?` in Preview came back "My reference material does not cover that…". Two causes:
1. Ally FAQ's `features` was `{}` in `ally_local`, so the run took the parity path (trace `translate → retrieve → gate → finalize`, `turnType: null`), where 0 hits is a fixed decline. The toggle code is correct; Agent mode had not been saved. It is now on locally (`features = {"agent": true}`).
2. The agent design itself was a fixed pipeline: a classifier call, an up-front search for every question, and a refused draft replaced by the bot's fixed decline wording. So "not found" read the same every time.

**What changed** (Shehbaz: "RAG should just be one tool… the rules & defaults should be in the agent prompt… respond like a real person… not the same response again and again"):
- **The agent step is the first step.** It reads the conversation, sets `turn_type`, and calls `search_knowledge` with its own English query when it needs a fact. Small talk and "who are you?" take one model call, no search. Removed: the contextualise call, `agent/contextualize.txt` (`ally_ai_agent_contextualize`), `LLMTask.WHATSAPP_AGENT_CONTEXTUALIZE` in both repos, its AI task registry row, and the prefetch node.
- **The run's first search** sets the `retrieval` block and `hit_chunk_ids`, and is logged to the retrieval log once (as the parity path's search is). Its gate verdict (`no_hits` / `below_threshold`) is the decline reason when nothing was found.
- **A refused draft is rewritten once.** `check_reply` returns a rejection reason; the agent gets one more step with plain feedback (never the refused text): why it was refused, which kinds of detail had no source ("a link", "a number"), and "you haven't searched yet: search before you reply" when it hadn't. Only a second refusal sends no text (ally-be then sends `declineText`).
- **An uncited `answer` to a small-talk or about-the-bot turn**, with nothing searched and no link, number, price or email, is treated as small talk (the same text labelled `smalltalk` would pass; refusing it only swapped in the fixed wording).
- **The agent prompt holds the rules and defaults** and asks for an assistant's manner: answer first, then the most useful next step; use the conversation; never reuse an opening, sign-off or offer; introduce itself (and "not a crisis service") only once; say what it doesn't have in its own words, naming the topic, with where to go and one thing it can help with; never mention passages, documents or reference material. Out-of-scope requests (weather, news, general knowledge) are declined without a search or clarifying question; a question about the organisation or product ("what is Ally?") is a question to search, not about the bot; `decline` whenever it isn't giving what was asked, even when it cites where to go.
- Preview steps now read e.g. `agent: question, calls search_knowledge via gpt-5-mini` · `tool · search_knowledge: 3 hits, 2 new passages, best 0.61` · `agent: question, answer via …` · `check: answer (question), 1 citations`; a rewrite shows `check: sent back (uncited)`.

**Eval** ([CHUNK-03A-EVAL.md](./CHUNK-03A-EVAL.md) is the last full run, before the last two fixes):

| Run | Hard fails | Notes | p50 vs parity |
|---|---|---|---|
| A: new design | 2 | refund reply right but labelled `answer` (cited a passage for the website); "kal mausam kaisa hai?" asked which city | −17% |
| B: out-of-scope and decline-labelling rules | 2 | one request timed out (OpenAI retries); refund still labelled `answer`; "hi, ye kya hai?" refused twice → fixed wording | −22% |
| C: rewrite feedback names the detail kinds | **0** | "What is Ally?" and "how does this work?" answered from the persona without searching, refused twice → fixed wording | −10% |
| targeted re-runs after "search first" + about-bot rule | 0 | `in-what-is-ally`, `fu-is-it-free`, `out-refund`, `ab-*` all as intended; "how does this work?" and "hi, ye kya hai?" now search and answer with citations (the eval still expects an uncited intro for them, so it marks them "fail"; the cited answer is the better reply) | |

Latency outliers (18–76 s) in runs B and C were OpenAI retrying requests (`Retrying request to /chat/completions` in the ally-ai log), not agent loops: across the runs only a handful of messages used a rewrite.

**Still open:** the refund reply still says "in my reference material" on some runs, despite the rule; the eval script runs every call in sequence (about 8 minutes a run, 100+ model calls) and prints nothing until the end: parallel cases and per-turn output would make iteration much faster; the eval's expected `turn_type` for "how does this work?" should accept a cited answer.
