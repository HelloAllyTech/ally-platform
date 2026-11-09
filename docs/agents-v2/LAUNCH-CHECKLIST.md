# Agents v2 POC: launch checklist

Everything that has to happen outside the code before the POC (Stage 1) goes live. Each line names where it came from. Tick it in the PR that does it.

## Prompts (Skills Store, production)

The Skills Store keeps a prompt's live text; a changed seed file never overwrites it. Push each with the `prompts` CLI (needs a Skills Store key), then publish it in the Skills Store.

- [ ] **`ally_ai_builder_designs`**: one speaker per sample line, no ungrounded details (20d, `CHUNK-20D-NOTES.md` §5).
- [ ] **`ally_ai_agent_system`**: two lines added in 20a-2 (`CHUNK-20A2-NOTES.md` §3):
  - "When the answer is no, or not what they hoped, give the closest alternative the passages offer (another day, time or service) before any other tip."
  - "When a question has more than one part, answer every part from the passages you found, not only the first."
- [ ] **`ally_ai_checkup_judge`** is new in 20a-2: production creates it from the seed on first sync. Check that the live text matches `ally-ai/app/prompts/checkup/judge.txt` after deploy.

## Data

- [ ] **Re-ingest onboarded assistants' documents** (20a-2), after ally-be and ally-ai are deployed:
  1. `npm run reingest:onboarding-docs -- --dry-run` in ally-be, and read the count.
  2. `npm run reingest:onboarding-docs` (queues a `reindex` per document).
  3. When the ingest queue is empty, run the dry run again: it should report 0.

## Settings and infrastructure

- [ ] **Gate G1 (ops):** checkpoint database, retention, `AGENT_RUNTIME__AGENT_REASONING_EFFORT=low`, agent prompt published (`v2-chunks.md`, Release gates).
- [ ] **v2 in production:** confirm `global_settings` `whatsapp_bot` → `agentRuntimeAllowed` and ally-ai `AGENT_RUNTIME__ENABLED` (`CHUNK-20A2-NOTES.md` §3).
- [ ] **A private bucket of its own for bot images** (20d).
- [ ] **Public links stay off** (`botPagePublicAllowed`) until Stage 6.

## Checks

- [ ] A Lighthouse mobile LCP run for the bot page (20d).
- [ ] Hindi bot page strings marked "needs review" in `botPage/copy/hi.ts` reviewed (20d).
- [ ] The production ally-be image builds without running out of memory in `nest build` (20d).
