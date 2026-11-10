# Agents v2 POC: launch checklist

Everything that has to happen outside the code before the POC (Stage 1) goes live. Each line names where it came from. Tick it in the PR that does it.

## Prompts (Skills Store, production)

The Skills Store keeps a prompt's live text; a changed seed file never overwrites it. Push each with the `prompts` CLI (needs a Skills Store key), then publish it in the Skills Store.

- [ ] **`ally_ai_builder_designs`**: one speaker per sample line, no ungrounded details (20d, `CHUNK-20D-NOTES.md` §5).
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
- [ ] **Public links stay off** (`botPagePublicAllowed`) until Stage 6.
- [ ] **Website widget: `frame-ancestors` for `/b/*`** at CloudFront and Caddy (13). Per bot, from `GET /api/v1/public/widget/<slug>/frame-policy` (the allowed websites and their subdomains, plus the page's own origin). Until then the page and ally-be enforce the allowed websites themselves (`CHUNK-13-NOTES.md`, Security).
- [ ] **Website widget: serve `/widget.js`** from the bot page's origin with short caching (`Cache-Control: max-age=300`), not the `immutable` the hashed assets get. It is built into the dashboard's dist by its build (13).
- [ ] **`ALLOWED_ORIGINS` is unchanged by the widget:** the loader's settings route answers CORS itself, only to each bot's allowed websites (13).
- [ ] **20d-2: deploy ally-ai before ally-be.** ally-be calls `POST /api/v1/agent/instructions` and `/instructions/check` (How it works, and the check on Your instructions); until ally-ai has them, How it works says it couldn't load and "Your instructions" can't be saved (the check fails closed). Migration `1981340000000-AddCheckupCaseControls` (additive) runs with ally-be. No new prompts: the Skills Store is unchanged for 20d-2.

## Checks

- [ ] **Watch the v1 fallback rate in production; slow model steps (15–17 s) caused fallbacks in round 6** (`CHUNK-20A2-EVAL.md`, Round 6).
- [ ] **Checkup cost (20d-2):** home checkups ask safety and owner Must pass questions 3 times; the rest once, retried (up to 3) only on a fail. About 1.7–2.0× the model calls of a 20a-2 run (≈ 31–37 asks vs ≈ 19 on Sunrise). Watch it; the rule is `planFor` in `bot-draft/checkup/checkup-cases.ts`.

- [ ] A Lighthouse mobile LCP run for the bot page (20d).
- [ ] Hindi bot page strings marked "needs review" in `botPage/copy/hi.ts` reviewed (20d).
- [ ] The production ally-be image builds without running out of memory in `nest build` (20d).
