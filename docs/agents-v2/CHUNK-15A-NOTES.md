# Chunk 15a notes: crisis classifier v2, then public links

**Brief:** [chunk-15a.md](./chunk-15a.md). **Branch:** `feat/agents-v2-fast-track`; commits tagged `[15a]`, not pushed. **Baseline:** `0fb34139c`. **Runs beside H0** (another session, same folder): 15a commits only its own paths.

> Status: plan approved (13 Nov 2026). Building C2–C4, then **stop 1** (the eval set).

## 1. Code map (checked before building)

**ally-ai**
- `CrisisCheckRequest` in `app/schemas/knowledge_agent.py`: `message`, `prompts`.
- `POST /knowledge-agent/crisis-check` (`app/api/v1/endpoints/knowledge_agent.py`) calls `KnowledgeAgentService.classify_crisis` (`app/core/knowledge_agent/agent.py`), which calls `build_crisis_prompt` (`app/core/knowledge_agent/prompt.py`) through `load_and_format` (`app/prompts/resolver.py`).
- The contract `KnowledgeCrisisClassifyInputs` (`app/prompts/contracts.py`) has `message` only.
- `SafeFormatter` ignores an extra kwarg, so the old text renders unchanged when `history` is passed. A new `{history}` placeholder must be among the Skills Store version's variables, or it's left as literal text.

**ally-be**
- `CrisisCheckRequest` in `src/ai/dto/knowledge.dto.ts`.
- Three call sites in `src/chatbot/engine/chatbot-engine.service.ts`: `answer` (every channel), `refuse` (not on the list), `crisisOnly` (a chat a person holds, and before a hand-over).
- Where `turn.history` ends:

| Channel | Source | Ends with the current message? |
|---|---|---|
| WhatsApp | `whatsapp-inbound.service.ts` `recentHistory` (wa_messages or the shared store) | Yes |
| Bot page and widget | `bot-page-public.service.ts`, `conversations.recentHistory` | Yes |
| Preview (Try it) | `chatbot.service.ts`, `dto.history` | No |
| Basics runner | appends the inbound message, then `recentHistory` | Yes |

**Eval harness:** `ally-be/src/chatbot/basics/` (`basics-cases.ts`, `basics-evaluate.ts`, `run-basics.ts`, `cases/trijog.json`).

**Local bots:** Ally FAQ `be6c5a91-b2f7-43f1-9cbb-723eec47a274`; Sunrise eval bot `abdfd2d1-0c6f-46a1-9a21-ce476205b0c4` (PDF-onboarded, mental health pack); Trijog `71fe41e9-…` and `cfa037e5-…`.

## 2. Plan

| Commit | What |
|---|---|
| C1 | These notes |
| C2 | ally-ai: `history` on the request (lenient: trimmed, never a 422), the prompt builder renders it as a short transcript, contract field with an empty default |
| C3 | ally-be: `crisisHistory(turn)` (the person's earlier messages, without the current one, newest last, ≤ 5 and ≤ 1,500 characters); all three call sites send it |
| C4 | basics: `cases/crisis.json`, `--repeat`, misses and false alarms per case, the prompt's version, a `--classifier-only` mode for iterating → **stop 1** |
| C5 | Baseline: today's prompt, ×3, Sunrise + Ally FAQ (+ Trijog) |
| C6 | The new prompt text → **stop 2** → seed + local Skills Store version |
| C7 | The same runs again; regressions (basics must-pass, Sunrise checkup safety, 3a eval) |
| C8 | G1b locally: flag on, a public page and bubble in a private window |
| C9 | Report; `LAUNCH-CHECKLIST.md` lines; `v2-chunks.md` Progress row |
