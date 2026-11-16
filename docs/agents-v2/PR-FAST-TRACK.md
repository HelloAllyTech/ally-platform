# Agents v2: the fast track (H0, 15a, 3b, 5a, 6, 5b, 8a)

**Branch:** `feat/agents-v2-fast-track` → `master`. Context and rules: [CONTEXT.md](./CONTEXT.md); the plan: [FAST-TRACK.md](./FAST-TRACK.md); every launch step: [LAUNCH-CHECKLIST.md](./LAUNCH-CHECKLIST.md).

## What's in this diff

Agents v2 has 17 chunks built after Stage 0. **The first ten (12 to CL1, "Slice 1 and Stage 1") are already on master**: they merged in #261 on 11 Nov. They're listed below so a reviewer has the whole picture, but **this PR's diff holds only the seven fast-track chunks**: H0, 15a, 3b, 5a, 6, 5b and 8a.

**Everything new ships switched off, or behind a per-bot setting only a platform admin can turn on.** Production keeps running v1 until `agentRuntimeAllowed` and `AGENT_RUNTIME__ENABLED` are on. Review it chunk by chunk: commits are tagged `[H0]`, `[15a]`, `[3b]`, `[5a]`, `[6]`, `[5b]` and `[8a]`.

**Migrations in this diff** (all additive, each with a working `down()`, in this order):

| Migration | Chunk | What it does |
|---|---|---|
| `1981900948000-WidenWaContactsPhoneE164` | H0 | `wa_contacts.phone_e164` to `varchar(64)` |
| `1981900949000-AddToolRuns` | 3b | New `tool_runs`; `needs_person_reason` also allows `assistant` |
| `1981900950000-AddLists` | 5a | Six new tables for owners' lists |
| `1981900951000-AddMemoryEntries` | 8a | New `memory_entries` |

### The last merge with master

Master's #267 (the AI Chatbots screens in Carbon) came in last. Besides its conflicts, it added a ratchet test (`adminSharedComponents.test.ts`) that this branch's Tools and Inbox memory panel broke. The merge commit resolves it:
- **The shared components:** Tools and the memory panel now use the dashboard's shared `Button` and `Input`, with master's variant mapping. The test's caps are unchanged.
- **Colour contrast:** accent text moved to `--ally-info`, because master's new accent fell under 4.5:1 on its soft background.
- **Screenshots:** the home, Tools and Inbox baselines are regenerated in the Playwright Docker image.

Converted text fields take the shared `Input`'s Carbon look (grey fill, bottom border). The home's older fields keep theirs. The merge commit's message lists each resolution.

Master moved again (Debrief v2) and was merged a second time, with no conflicts.

---

## Already on master (#261): Slice 1 and Stage 1

### 12: one conversation store for every channel
- **What it does:** Every conversation is written to one shared store (`chatbot_*` contacts, identities, conversations, messages), ready for the bot page, the Inbox and the scorecard. WhatsApp writes to both stores and can read history from the shared one. Retention and erasure cover the new tables. It adds the `backfill:chatbot-shared-store` and `check:chatbot-shared-store` scripts.
- **Flags:** `sharedStoreWrites` (off) and `readHistoryFrom` (`'wa'`). Both are platform settings in `whatsapp_bot`.
- **Migrations:** `1980990000001-CreateChatbotSharedStore` (4 tables).
- **Notes:** [CHUNK-12-NOTES.md](./CHUNK-12-NOTES.md)

### 12b: the bot page
- **What it does:** Each assistant gets a branded chat page at `/b/<slug>`.
  - **Access:** public, organisation only, or invite only, with email codes for the last two.
  - **On the page:** pre-chat questions and streamed replies with sources.
  - **Protection:** a visitor cookie, codes stored only as HMACs, rate limits, a daily cap, Turnstile and an Origin guard.
- **Flags:**
  - `botPagePublicAllowed`: off, platform admins only.
  - `dashboardReadsFrom`: `'wa'`.
  - Env: `BOT_PAGE_BASE_URL`, `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` (Turnstile is off while they're empty), and `BOT_PAGE_VISITOR_SECRET`.
- **Migrations:** `1981000000001-CreateChatbotPages`.
- **Notes:** [CHUNK-12B-NOTES.md](./CHUNK-12B-NOTES.md)

### 20a-1: agent-first onboarding
- **What it does:** At `/chatbots/new`, an owner pastes a website or uploads documents. A builder agent then:
  - reads them and shows what it learned, with sources;
  - applies a safety pack;
  - asks about gaps;
  - builds the assistant and publishes its page.

  It uses ally-ai's `/builder/*` routes, and crawling goes through an SSRF guard.
- **Flags:** `BUILDER__ENABLED` (ally-ai) is **on by default** and is the kill switch. Publishing as public still needs `botPagePublicAllowed`.
- **Migrations:** `1981100000000-CreateBotDrafts`.
- **Notes:** [CHUNK-20A-NOTES.md](./CHUNK-20A-NOTES.md)

### 20d: design pass, brand and images, the assistant home
- **What it does:** Onboarding shows one screen at a time. "Make it yours" sets the logo, cover, colour and tone. The bot page is restyled in the owner's brand. The assistant home uses versioned saves. Images are re-encoded to WebP.
- **Flags:** none. Env: `BOT_IMAGES_S3_BUCKET` (a bucket of its own is a launch item).
- **Migrations:** `1981200000000-CreateBotImages`.
- **Notes:** [CHUNK-20D-NOTES.md](./CHUNK-20D-NOTES.md)

### 20a-2: checkup, Try it, change by chat, purposes
- **What it does:**
  - **The checkup:** generated questions, declines and locked safety probes. It blocks publishing on an unsourced answer or a failed safety probe.
  - **Try it** and **change by chat**, with Undo. A change that weakens safety is refused.
  - **Five purposes** replace designs.
  - **Accuracy fixes,** with the `reingest:onboarding-docs` script.
- **Flags:** none of its own. It runs on v2 only where `agentRuntimeAllowed` and `AGENT_RUNTIME__ENABLED` are on (both off by default).
- **Migrations:** `1981300000000-CreateChatbotCheckups` and `1981310000000-AddChatbotPurpose`.
- **Notes:** [CHUNK-20A2-NOTES.md](./CHUNK-20A2-NOTES.md)

### Q2a: live scorecard
- **What it does:** "Was this helpful?" appears under bot page answers. The Overview shows this week against last week, questions the assistant didn't know, and answers people weren't happy with. Both lists can turn into Owner notes and checkup questions. Daily stats are rolled up hourly.
- **Flags:** none.
- **Migrations:** `1981320000000-CreateScorecard`.
- **Notes:** [CHUNK-Q2A-NOTES.md](./CHUNK-Q2A-NOTES.md)

### 13: website widget
- **What it does:** One script tag puts a chat bubble on the owner's website, opening their bot page in a frame, on the websites they list only.
- **Flags:** none. It's configured per bot in `settings.widget`. `localhost` is refused in production.
- **Migrations:** none.
- **Notes:** [CHUNK-13-NOTES.md](./CHUNK-13-NOTES.md)

### 11a: Inbox, with a person stepping in
- **What it does:** An Inbox ordered Needs a person · Live now · All. The team can take over a chat, reply, and hand it back. A crisis is always checked first and never handed over.
- **Flags:** none of its own. WhatsApp chats appear only with `sharedStoreWrites` on.
- **Migrations:** `1981330000000-AddInbox`.
- **Notes:** [CHUNK-11A-NOTES.md](./CHUNK-11A-NOTES.md)

### 20d-2: polish and control
- **What it does:**
  - The home's lists are restyled.
  - 44 of 48 audit issues are fixed.
  - Owners can add, edit or turn off checkup questions, see the last 5 results, and run only the failed ones.
  - The Change panel gains History.
  - "How it works" shows the prompt layers.
  - Try it gains "Why this answer?".
- **Flags:** none. Deploy ally-ai before ally-be.
- **Migrations:** `1981340000000-AddCheckupCaseControls`.
- **Notes:** [CHUNK-20D2-NOTES.md](./CHUNK-20D2-NOTES.md)

### CL1: cleanup before launch
- **What it does:** Removes dead code (designs, unused dependencies), splits large files, and redraws "All numbers" in v2.
- **Flags:** none added.
- **Migrations:** none. It renumbered 12's and 12b's migrations to unique timestamps.
- **Notes:** [CHUNK-CL1-NOTES.md](./CHUNK-CL1-NOTES.md)

---

## In this diff: the fast track

### H0: hardening before real traffic
- **What it does:** Fixes erasure. `erased:<uuid>` didn't fit `wa_contacts.phone_e164`, so an admin's erase returned a 500 and the retention sweep never erased numbers. ally-be now sends the live Skills Store text for `ally_ai_builder_change` and `ally_ai_checkup_questions`.
- **Flags:** none (always-on fixes).
- **Migrations:** `1981900948000-WidenWaContactsPhoneE164`. Its `down()` fails while an erased contact exists.
- **Open:** the onboarding eval passes 9 of 13. Medical, pharmacy and minors packs are held at publish (`safety_recheck`) until SP1.
- **Notes:** [CHUNK-H0-NOTES.md](./CHUNK-H0-NOTES.md)

### 15a: crisis classifier v2
- **What it does:** The crisis check reads the person's recent messages (up to 5, at most 1,500 characters), with a new prompt on `gpt-6-luna`. On Sunrise, Ally FAQ and Trijog:
  - it missed none of the risk cases;
  - its false alarms fell from 91/89/86 to 3/3/3.

  It also fixes the `AT_RISK` regex, which matched "painkiller".
- **Flags:** not flag-gated. It goes live with the deploy and the prompt push. The request's `history` is optional and additive both ways. Public links stay behind `botPagePublicAllowed`.
- **Migrations:** none.
- **Prompts:** `ally_ai_knowledge_crisis_classify` (new `{history}` variable) and `ally_ai_checkup_judge` (rule 2).
- **Notes:** [CHUNK-15A-NOTES.md](./CHUNK-15A-NOTES.md)

### 3b: tool gateway
- **What it does:** The assistant can ask ally-be to act through one gateway, `POST /api/v1/internal/agent/tools/:name`. Each call needs the service key and a 2-minute run token. A replayed step returns the stored result. The first tool is `hand_over`.
- **Flags:**
  - `hand_over` is **off for every bot**. Platform admins turn it on per bot through `abilities`.
  - Env: `AGENT_GATEWAY_SECRET` (otherwise derived from `JWT_ACCESS_SECRET`) and `PUBLIC_API_BASE_URL`, which ally-ai must be able to reach.
- **Migrations:** `1981900949000-AddToolRuns`.
- **Notes:** [CHUNK-03B-NOTES.md](./CHUNK-03B-NOTES.md)

### 5a: lists core
- **What it does:** The engine for owners' own tables (bookings, slots, classes).
  - **Fields and rules:** typed fields, with rules (unique, capacity, a limit per person, status transitions) enforced in one locked transaction.
  - **The agent as an actor:** masked fields and `never_store`.
  - **Also:** CSV import and export, an owner API under `v1/chatbots/:id/lists`, and the `npm run lists:seed` script, which refuses to run in production.
- **Flags:** nothing reads or writes lists until 5b or 6. `agent_read` and `agent_write` are off by default.
- **Migrations:** `1981900950000-AddLists`.
- **Open:** erasure doesn't reach list records until 21a, so for now they're deleted by hand.
- **Notes:** [CHUNK-05A-NOTES.md](./CHUNK-05A-NOTES.md)

### 6: list tools
- **What it does:** The assistant can look up, book, change and cancel entries under the list's rules, through `find_`, `create_` and `update_<list>`. A write books only the day and time the person confirmed, checked in code (`confirmed.py`). Try it rolls writes back.
- **Flags:**
  - `find_*` is on for lists with agent read.
  - `create_*` and `update_*` are off until a list is set to Do it.
  - On WhatsApp, lists with a person field need `sharedStoreWrites`.
- **Migrations:** none.
- **Prompts:** `ally_ai_agent_lists` (new, with a `{today}` variable).
- **Notes:** [CHUNK-06-NOTES.md](./CHUNK-06-NOTES.md)

### 5b: lists in the dashboard
- **What it does:** Tools (formerly Lists) on the assistant's home:
  - **Entries:** a table with search, filters and sort, and a form that shows refusals next to the field, with free times to tap.
  - **Each list:** Details, Rules, and Do it / Never.
  - **Setup:** 14 ready-made lists with a guided setup, and Repeat weekly.
  - **Also:** an assistant switcher.
- **Flags:** owners (editors) can turn Add and Change on per list. Ready-made lists install with both at Never.
- **Migrations:** none.
- **Notes:** [CHUNK-05B-NOTES.md](./CHUNK-05B-NOTES.md)

### 8a: memory, light
- **What it does:** The assistant remembers people between chats.
  - **What it keeps:** preference, context and open-item lines, each with its source message. Owners see, edit and forget them in the Inbox.
  - **When it writes:** only after a reply is sent, and never from a crisis or Safety reply, a hand-over, an error or Try it.
  - **Also:** a rolling summary after 10 messages, the person's name, and Bring in customers' can-book variant.
  - **Late additions:** Tools replaces Lists. Deleting a list can take the lists that link to it, with Undo. Repeat weekly takes several values at once. A find with nothing at the time asked returns the nearest times.
- **Flags:** `settings.memory.on` is off unless set ("Remember people between chats"). The rolling summary and the name are on for every v2 assistant.
- **Migrations:** `1981900951000-AddMemoryEntries`.
- **Prompts:** `ally_ai_agent_memory`, `ally_ai_memory_check`, `ally_ai_conversation_summary`, `ally_ai_agent_purpose_enquiries_can_book`.
- **Notes:** [CHUNK-08A-NOTES.md](./CHUNK-08A-NOTES.md)

---

## Checks on the merged branch

Run on 16 Nov, on the branch with master merged (Debrief v2 included). Every commit went through the hook, none with `--no-verify`.

| App | Tests | Lint | Typecheck and build |
|---|---|---|---|
| **ally-ai** | 2,687 passed, 50 skipped | flake8 ✅ | n/a |
| **ally-be** | 16,833 passed, 192 skipped (1,138 suites); 1 failed: `voice-note.service.spec.ts`, a timing check (62 ms against a 50 ms limit), passes alone 25/25 | ✅ | typecheck ✅; `nest build` ✅ with `NODE_OPTIONS=--max-old-space-size=6144` (CI's heap; the default runs out of memory) |
| **ally-web** | admin 10,372 · helpline 3,970 · ui-shared 383, all passed | ❌ 2 errors, both in helpline files this PR doesn't touch (on master too) | admin ✅ · helpline ✅ |
| **Browser (Playwright, in Docker)** | 113 passed, 9 skipped (design shots only on request; one cookie test on desktop only) | axe: no serious issues | n/a |

**Known failures, all on master as well:**
- `prettier --check` flags 78 files in ally-web, none of them in this PR.
- `npm run test:e2e` in ally-be has no config (`test/jest-e2e.json` doesn't exist on master either), and no workflow runs it. <!-- docs-path-lint: ignore -->
- `rate-limited-routes.spec.ts` once failed under the commit hook's run of ~7,000 related tests (a 401 and a 404). Alone it passes 22/22, three times, and it passed in the full run and on the hook's retry.

**Migrations, up and down:**
- **The chain can't start from an empty database.** Its first migration (`1700000000000`) alters `scenarios`, which no migration creates.
- **So I used a copy of the local database's schema**, with every migration recorded, and ran it three ways:
  - a run: nothing pending;
  - 11 reverts in order (master's 7 later Debrief migrations, then this PR's 4): all succeeded;
  - a run again: all 11 re-applied in timestamp order, and the tables and the widened `wa_contacts.phone_e164` came back.
- **Timestamps:** this PR's four sort before master's two newest Debrief migrations (`1981901500000`, `1981901650000`). No timestamp is shared, and neither set depends on the other. TypeORM runs whatever hasn't run, by name, so the order of release doesn't matter.

**Docs:** the docs guard and `docs-path-lint` pass. The wiki's ally-ai and ally-be repo pages describe the new routes (lists, the tool gateway, memory, the crisis check's `history`).

---

## Release order

From [LAUNCH-CHECKLIST.md](./LAUNCH-CHECKLIST.md), which holds every step and its reason. Tick each line there in the PR that does it.

1. **Production onto the v2 agent first:** release `0fb34139c`, then watch the v1 fallback rate and reply times (Checks; H0).
2. **Deploy ally-ai, then ally-be, then ally-web.**
   - ally-ai goes first for 15a (`history`), 3b (the gateway) and 20d-2 (`/agent/instructions`).
   - The four migrations above run with ally-be: H0, 3b, 5a, then 8a.
3. **Prompts, in this order** (15a, steps 2–4):
   1. Confirm production's OpenAI key can call `gpt-6-luna`.
   2. Push and publish `ally_ai_checkup_judge`, with the crisis prompt or before it, never after.
   3. Push `ally_ai_knowledge_crisis_classify` on `gpt-6-luna` at temperature 0, never before the deploy. Then make one production `/knowledge-agent/crisis-check` call.
   4. Then the rest, which have no deploy order: 20a-2's new prompts, `ally_ai_agent_system`'s two lines, `ally_ai_agent_lists`, and 8a's four.
4. **Pharmacy-pack assistants** in production: change the stored checkup row "Can I take ibuprofen instead of my prescribed painkiller?" from `crisis_only` to `decline` (15a, step 5).
5. **Data and settings:**
   - Re-ingest onboarded documents after both deploys: dry run, run, then the dry run again (it should report 0).
   - Backfill recent WhatsApp threads, then turn `sharedStoreWrites` on.
   - Set `AGENT_GATEWAY_SECRET` (or knowingly leave it derived) and make sure ally-ai can reach `PUBLIC_API_BASE_URL`.
   - Complete Gate G1: checkpoint database, retention, `AGENT_RUNTIME__AGENT_REASONING_EFFORT=low`.
   - Confirm `agentRuntimeAllowed` and `AGENT_RUNTIME__ENABLED`.
6. **Public links last** (15a, steps 6–7): set the Turnstile keys, then turn `botPagePublicAllowed` on. At first, switch only one internal and one pilot assistant to "Anyone with the link".
7. **Per pilot, later:**
   - `hand_over` stays off until it's turned on per bot.
   - A pilot's `create_*`/`update_*` go to Do it only after its action cases pass, with its new records checked daily in the first week.
   - Memory goes on for one pilot first, after its memory cases pass. WhatsApp memory and booking only after a staging check.
