# PR: Q3-fast — the fixes real customers would notice first

Branch `feat/agents-v2-q3-fast` → `master`. All three apps.

- Epic: `EPIC-Q3-FAST.md`, with the causes in `FIXES-17NOV.md` and the gaps in
  `Q3-FAST-GAPS-AND-RETEST.md`.
- Notes: `CHUNK-Q3-FAST-NOTES.md`. Prompt texts: `Q3-PROMPTS.md`, all approved.
- Measurements: `evals/prod-17nov/runs/`.
- Q3d's six fixes are merged in. master was merged in on 18 Nov.

## What people will notice

**Customers**

- **One run path.** A run that fails gets one honest line with the business's real contact,
  never a v1 answer.
- **Safety:**
  - Everyday language ("I'll kill your delivery guy lol", "die of boredom", "11 works for me")
    no longer gets the crisis reply.
  - Someone at risk gets the reply in about 2 s, with real numbers: 112, Tele-MANAS and the
    business's own helplines.
  - A medical emergency (bleeding in pregnancy, chest pain, a chemical in the eye) gets "go to
    the nearest emergency department, 112 / 108".
  - Someone who is upset gets warmth, and still an answer.
  - Hindi and Hinglish messages get Hindi replies.
- **Answers:**
  - The facts setup learned from the site are searched, so prices, hours, addresses and policies
    on the site are found.
  - No more "the provided passages…".
  - No offers it can't keep (add to cart, delivery estimates).
  - "I don't know" comes with the business's real contact, added once.
- **Booking:**
  - A time that's taken is never offered as free.
  - A refusal is said in words ("11:00 is taken, 15:00 is free").
  - Picking an option isn't a yes; it confirms the exact booking first.
  - Tools stay for the whole chat.

**Owners**

- **Setup:**
  - An error, block or captcha page is never stored as a fact, and is listed under "We couldn't
    read these pages".
  - A Cloudflare-hidden email is read as the real address.
  - Uploads show "Reading your documents…" until they're read, and never ask for the same file
    again.
- **Checkup:**
  - "You're ready" appears only when every safety question passed and at least 70% of the rest
    did; otherwise "X of Y questions need a fix".
  - Publishing below that asks "Publish anyway?" with the score.
  - Live assistants show "X need a fix" on the Overview.
- **Safety:**
  - "This isn't right for my business" corrects a wrong pack. A less strict pack needs a reason,
    which is logged.
  - Asking setup for stricter rules applies them when they're strictly stricter. Medical,
    pharmacy, mental health and young people never replace one another; setup says so.
  - The Safety screen shows the at-risk reply exactly as it's sent.
- **Lists:**
  - Each list brings its own instructions (booking, taking details, orders, reference), with
    "How should your assistant use this list?" for the owner's own line. How it works says what
    each list makes the assistant do.
  - Ready-made Appointments examples are neutral.

## What changed, per part

| Part | Commit(s) | In short |
|---|---|---|
| 0 One path | `d37247aea` | v1 fallback removed; `run-failed-reply.ts`; `agentRuntimeAllowed` ignored |
| 0b Booking | `565c2935e` | `takenOf`, refusals relayed, `said_yes`, hand-over respects its switch, table in the title |
| 1 Safety | `48969ffad` | four crisis levels, `crisisReply` / `emergencyReply`, the level wait, pack correction, Medical v3 and Legal v2, young people with no pre-chat |
| 2 Answers | `18d88b01b`, `f0d42a807`, `893fa52e6` | honest voice and contact; the "What we learned" document; 8 passages (migration `1984600000000`); contact once |
| 2b Playbooks | `059837791`, `610fa2c81` | `playbooks.py`, four approved playbooks, owner's line per list |
| 3 Trust in setup | `408e60615`, `995c7310a`, `893fa52e6`, `610fa2c81` | error pages, Cloudflare emails, the publish gate, uploads show reading, one pack per assistant |
| Q3d | `aeba62123` (merge) | gap answers saved, thumbs-down reason reaches the owner, Appointments examples per business, Overview counts, share link base path |

## Measured

All on local copies of the 17 Nov businesses, built from their public sites.

**Safety**, 3 runs on the code going in:

- 42 of 43 cases pass every run.
- 0 misses.
- The 15a set passes 110 of 112 every run.
- Classifier false alarms: 4 over 3 runs, 3 of them the approved "jump out the window lol".
- The one failing case is finance P9, deferred below.

**Answers.** In-data questions answered correctly:

| When | Result |
|---|---|
| Baseline | 57% of runs |
| After the learned facts were searched | 72% |
| On the final code (one run) | 80% (32 of 40) |

The target is 85%. Details: `P2-BASELINE-REPORT.md`, `P2-FIX1-REPORT.md`, `P2-FASTFINISH.md`.

**Speed:** median 7.8 s, slowest 13.8 s.

**Publish gate:** `runs/publish-gate-1440.png`.

## Launch steps

These are in `LAUNCH-CHECKLIST.md`, Q3-fast section.

1. **Before deploying, publish to production's Skills Store:**
   - `ally_ai_knowledge_crisis_classify` (gpt-6-luna, temperature 0);
   - `ally_ai_builder_system` (rule 3).
2. **Deploy.**
   - Migration `1984600000000-KeepEightPassages` runs with ally-be. It's data only.
   - The sync creates the new prompts from their approved seeds:
     - the four `ally_ai_agent_playbook_*` prompts;
     - `ally_ai_agent_upset` and `ally_ai_agent_upset_support`.

     Check that each live v1 matches its file.
3. **Remove `agentRuntimeAllowed`** from config.
4. **Don't re-index.** Production's assistants will be recreated. The facts document is written
   at publish.
5. **Watch crisis replies for a day,** and tell support about pack correction and "Publish
   anyway".

## Deferred to the next round

- Keyword search beside the vector search.
- Splitting a message that asks two questions.
- The right number, not a page label (C15).
- The finance wording "no returns are guaranteed".
- The B9 judge change (the grader failing correct answers).
- Combining safety packs (one pack per assistant today).
- Part 3b from the gaps doc.
- Booking for someone else.
- Gaps items 1–7 not done here.
- The full retest, which runs on production as Round 5.
- Answering before asking "which one?" (skipped at Stop 2).

## Known, not changed here

Three Postgres tests fail on master too:

- `bot-draft.pg.spec.ts` "publishing twice converges…" expects pack version 1, but mental health
  has been version 2 since SP1.
- Two `inbox.pg.spec.ts` tests fake `accessibleChatbotIds` as `null`, the shortcut A1 removed.
- Five shared-store Postgres tests also fail on master as it is now (`a8c5cd1a6`), with the same
  `null.length` error:
  - `erasure.pg.spec.ts`: erasing a contact;
  - `dashboard-parity.pg.spec.ts`: three dashboard views;
  - `backfill-check.pg.spec.ts`: resuming after a crash.

  Found after merging master.

## Merging master

- **One conflict:** `ally-be/DATA_SCHEMA.md`, the `bot_drafts` row. This branch added
  `source.learnedFactsDocumentId` and `source.readingDocuments`; master added
  `source.interview`. Resolved by keeping all three.
- **The migration timestamp clashed twice.** master added `1984300000000-DropDebriefRiskCueOptions`
  and later `1984400000000-AddBehaviorInstructionScore`, each with the timestamp this branch's
  `KeepEightPassages` had at the time. Ours is now `1984600000000`, after every master migration.
  It's idempotent (it acts only where the value is still 5), so an environment that already ran
  it under an old number is unaffected.
- **Second merge (19 Nov, master at `56531062f`):** one conflict,
  `ally-web/.../Roadmap/components/ViewBar.tsx`. This branch had only moved an import (from the
  first merge's lint fix); master rewrote the file. Took master's version. master's changes are in
  debrief, roadmap, learn and mobile, nothing in the agent runtime, crisis check, packs or prompts,
  so safety wasn't re-run.
- **master's changes in these areas:** only new Scribe prompts and their contracts. Nothing in
  the agent runtime, crisis check, packs or engine. Even so, the safety suite was re-run once on
  the merged code, with the same results as before:
  - mental health 12 of 12; medical 14 of 14; finance 4 of 5 (the deferred P9); standard 12 of 12;
  - 15a crisis set 111 of 112;
  - 0 misses;
  - 1 false alarm, the approved "jump out the window lol".

## Checks on the merged code

- **Typecheck:** clean in ally-be and ally-web.
- **Lint:** ally-be is clean. It needs `NODE_OPTIONS=--max-old-space-size=8192` locally; without
  it, Node runs out of memory.
- **Tests:**
  - ally-web: 1,501 pass (Onboarding, Assistant home, Dev onboarding).
  - ally-ai: 700 pass (builder, agent runtime, knowledge agent, checkup).
  - ally-be: the bot-draft, chatbot, knowledge-base, WhatsApp and migration suites pass, apart
    from the eight database tests listed above that fail on master too.
  - Playwright: the publish gate passes at 1440 and 390.
- **Lint problems that come from master, not this branch,** in files this branch doesn't touch,
  so CI on master shows them too:
  - ally-web: 1 eslint error, `import/order` in
    `ally-helpline-dashboard/.../DebriefProgressCard.tsx`;
  - ally-web: 70 files `prettier --check` flags;
  - ally-ai: flake8 in `scripts/eval_pm_conversation_quotes.py` and
    `tests/core/debrief_graph/test_data_access_matches_wiring.py`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
