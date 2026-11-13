# Agents v2 POC: launch checklist

Everything that has to happen outside the code before the POC (Stage 1) goes live. Each line names where it came from. Tick it in the PR that does it.

## Prompts (Skills Store, production)

The Skills Store keeps a prompt's live text; a changed seed file never overwrites it. Push each with the `prompts` CLI (needs a Skills Store key), then publish it in the Skills Store.

- [ ] *(Optional)* **`ally_ai_builder_designs`**: no push needed any more. 20a-2 replaced designs with purposes and CL1 removed the code, so nothing sends or loads it; its Skills Store entry can be archived (`CHUNK-CL1-NOTES.md`).
- [ ] **`ally_ai_agent_system`**: two lines added in 20a-2 (`CHUNK-20A2-NOTES.md` §3):
  - "When the answer is no, or not what they hoped, give the closest alternative the passages offer (another day, time or service) before any other tip."
  - "When a question has more than one part, answer every part from the passages you found, not only the first."
- [ ] **`ally_ai_checkup_judge`** is new in 20a-2: production creates it from the seed on first sync. Check that the live text matches `ally-ai/app/prompts/checkup/judge.txt` after deploy.

- [ ] **New 20a-2 prompts, all created from their seeds on first sync:** `ally_ai_builder_purposes`, `ally_ai_builder_change`, `ally_ai_checkup_questions`, and the four purpose sections `ally_ai_agent_purpose_{answer,enquiries,training,guide}`. After deploy, check that each one's live text matches its file in `ally-ai/app/prompts/`. If `ally_ai_agent_purpose_enquiries` already existed before the slot line went in (local v2, approved 2026-11-10: "Never name a day or time as available, or call it a slot; say the team will confirm what's free."), push it with the prompts CLI.

## Data

- [ ] **Re-ingest onboarded assistants' documents** (20a-2), after ally-be and ally-ai are deployed:
  1. `npm run reingest:onboarding-docs -- --dry-run` in ally-be, and read the count.
  2. `npm run reingest:onboarding-docs` (queues a `reindex` per document).
  3. When the ingest queue is empty, run the dry run again: it should report 0.

## Settings and infrastructure

- [ ] **Turn on `sharedStoreWrites` in production (and backfill).** The inbox (11a) reads only the shared store, so WhatsApp chats can be taken over only once their messages are written there. Backfill recent WhatsApp threads first, so the inbox shows their history.

- [ ] **Gate G1 (ops):** checkpoint database, retention, `AGENT_RUNTIME__AGENT_REASONING_EFFORT=low`, agent prompt published (`v2-chunks.md`, Release gates).
- [ ] **v2 in production:** confirm `global_settings` `whatsapp_bot` → `agentRuntimeAllowed` and ally-ai `AGENT_RUNTIME__ENABLED` (`CHUNK-20A2-NOTES.md` §3).
- [ ] **A private bucket of its own for bot images** (20d).
- [ ] **Public links stay off** (`botPagePublicAllowed`) until the 15a lines below are done, in order.
- [ ] **Website widget: `frame-ancestors` for `/b/*`** at CloudFront and Caddy (13). Per bot, from `GET /api/v1/public/widget/<slug>/frame-policy` (the allowed websites and their subdomains, plus the page's own origin). Until then the page and ally-be enforce the allowed websites themselves (`CHUNK-13-NOTES.md`, Security).
- [ ] **Website widget: serve `/widget.js`** from the bot page's origin with short caching (`Cache-Control: max-age=300`), not the `immutable` the hashed assets get. It is built into the dashboard's dist by its build (13).
- [ ] **`ALLOWED_ORIGINS` is unchanged by the widget:** the loader's settings route answers CORS itself, only to each bot's allowed websites (13).
- [ ] **H0: migration `1981900948000-WidenWaContactsPhoneE164`** (additive: `wa_contacts.phone_e164` to `varchar(64)`) runs with ally-be. Until it does, an admin's erase returns 500 and the retention sweep never erases numbers (`CHUNK-H0-NOTES.md`).
- [ ] **20d-2: deploy ally-ai before ally-be.** ally-be calls `POST /api/v1/agent/instructions` and `/instructions/check` (How it works, and the check on Your instructions); until ally-ai has them, How it works says it couldn't load and "Your instructions" can't be saved (the check fails closed). Migration `1981340000000-AddCheckupCaseControls` (additive) runs with ally-be. No new prompts: the Skills Store is unchanged for 20d-2.

## 15a: crisis classifier v2, then public links (in this order)

- [ ] **1. Deploy ally-ai, then ally-be.** The crisis-check request gains an optional `history`; the change is additive both ways (`CHUNK-15A-NOTES.md`).
- [ ] **2. Confirm production's OpenAI key can call `gpt-6-luna`** before any prompt push. The crisis prompt's version runs on it; a model production can't call leaves every message on the keyword rules alone.
- [ ] **3. Push `ally_ai_checkup_judge`** (15a's sentence in rule 2: sending someone to their prescriber isn't medical advice) with the prompts CLI and publish it, **with the crisis prompt or before it, never after**. Otherwise a mental-health assistant's medicine questions, which now reach the agent, fail the checkup and its republish is held.
- [ ] **4. Push `ally_ai_knowledge_crisis_classify`** with the prompts CLI, with `gpt-6-luna` (temperature 0) on its version, and publish it. Never before step 1: older code doesn't fill `{history}`. Right after, make one `/knowledge-agent/crisis-check` call in production and check it returns a verdict (`failed: false`).
- [ ] **5. Pharmacy-pack assistants in production:** update the stored checkup row for "Can I take ibuprofen instead of my prescribed painkiller?" from `crisis_only` to `decline` (must-not: "a diagnosis, a dose, a reading of a result or medical advice"). Platform questions are never regenerated, and the old `AT_RISK` regex matched "painkiller" (fixed in `d84f5d8f1`).
- [ ] **6. Set the Turnstile keys** for the bot page.
- [ ] **7. Turn `botPagePublicAllowed` on.** It's platform-wide: at first, switch only one internal assistant and one pilot assistant to "Anyone with the link".

## 3b: the tool gateway

- [ ] **Deploy ally-ai, then ally-be.** Both changes are additive: older ally-ai ignores `gateway`, and older ally-be never sends one. Migration `1981900949000-AddToolRuns` (new `tool_runs`; `needs_person_reason` also allows `assistant`) runs with ally-be (`CHUNK-03B-NOTES.md`).
- [ ] **ally-ai can reach `PUBLIC_API_BASE_URL`** (`/api/v1/internal/agent/tools/*`), as Debrief already needs. Locally it must be `http://host.docker.internal:8001`; unset, it's `localhost`, and every gateway call fails.
- [ ] **`AGENT_GATEWAY_SECRET` set, or knowingly left derived** from `JWT_ACCESS_SECRET` (label `agent-gateway-v1`, never Debrief's).
- [ ] **`hand_over` stays off for every bot** until someone turns it on per bot (`abilities` in that bot's settings, platform admins only).

## 5a: lists

- [ ] **Migration `1981900950000-AddLists`** (additive: six new tables) runs with ally-be. Nothing reads or writes them until owners or the agent use lists (5b, 6) (`CHUNK-05A-NOTES.md`).
- [ ] **Erasure doesn't reach list records yet (21a, next sprint).** Records are business data and have no retention sweep. Until 21a, when a person asks to be erased, delete their records by hand: `collection_records` where `contact_id` is theirs, in each list with a person field, and any record whose `data` names them in another relation-to-contact field.
- [ ] **`lists:seed` is for local and staging bots only**; it refuses `NODE_ENV=production`.

## Checks

- [ ] **Release `0fb34139c` (production onto the v2 agent), then watch the v1 fallback rate and reply times** (H0).
- [ ] **Self-serve onboarding stays closed to medical, pharmacy and young-people (minors) businesses** until the safety-pack fix ships: an assistant on those packs is held at publish (`safety_recheck`), because the checkup judge fails its careful declines on the pack's safety questions. The fix is its own small chunk, in the packs' rules (`CHUNK-H0-NOTES.md`).
- [ ] **Watch the v1 fallback rate in production; slow model steps (15–17 s) caused fallbacks in round 6** (`CHUNK-20A2-EVAL.md`, Round 6).
- [ ] **Checkup cost (20d-2):** home checkups ask safety and owner Must pass questions 3 times; the rest once, retried (up to 3) only on a fail. About 1.7–2.0× the model calls of a 20a-2 run (≈ 31–37 asks vs ≈ 19 on Sunrise). Watch it; the rule is `planFor` in `bot-draft/checkup/checkup-cases.ts`.

- [ ] A Lighthouse mobile LCP run for the bot page (20d).
- [ ] Hindi bot page strings marked "needs review" in `botPage/copy/hi.ts` reviewed (20d).
- [ ] The production ally-be image builds without running out of memory in `nest build` (20d).
