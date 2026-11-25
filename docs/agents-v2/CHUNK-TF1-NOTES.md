# Chunk TF1 notes: one complete pass, then fix in a loop

Branch `test/agents-v2-tf1` from master `2eb64bb88` (crisis fix #376 and BT1 #380 merged). Brief: `chunk-tf1.md`. The issue list, with both rounds' results: `ISSUES-TF1.md`. The new wording, approved on 25 Nov: `TEXTS-TF1.md`.

## Result

One pass on five fictional non-profits (a youth helpline, a disability NGO, an animal shelter, a literacy NGO's volunteer handbook, a flood-relief NGO), each from its own PDF, on a fresh local stack: the owner in the real admin UI, an email person on the real bot page, a phone person on signed WhatsApp webhooks, and a stranger. It found 7 Serious issues, 20 to fix before customers, 14 polish and 6 decisions.

Two rounds of fixes, one issue per commit, each with a test, each re-run on the live stack:

| | Pass (24 Nov) | After round 2 (25 Nov) |
|---|---|---|
| Serious | 7 | 0 open |
| Fix before customers | 20 | 0 open; F7 and F18 moved after launch |
| Polish (approved four) | 4 | 0 open; P13 needed no code |
| Decisions | 6 | B1, B2, B4, B5 built; B3 is S5; B6 unchanged |
| Found in the re-runs | | N1, N2, N3, all fixed |

What still needs a person, not code: the DPDP legal check below; two prompt changes for the ally-ai prompt owner (F8's false refusal, F10's "I've noted…" when memory is turned on by hand); the withdrawal's wording (below).

## Code map

ally-be unless marked web.

| Issue | Where |
|---|---|
| S1 go-live checklist | `ally-be/src/chatbot/safety/go-live-gate.service.ts` (`checklist`: the working copy's purpose); web `pages/AssistantHome/sections/Overview.tsx` (a never-live assistant goes to Build; refusals shown) |
| S2 starting budget | `ally-be/src/billing/service/ledger.service.ts` (`ensureStartingBudget`), called from `ally-be/src/bot-draft/service/bot-draft-publish.service.ts` and `ChatbotService.setStatus`; web `pages/Onboarding/create/GoLive.tsx` |
| S3 pack survives publish | `ally-be/src/bot-draft/safety-pack/sync-draft-pack.ts`, used by the template install and the Settings pack correction |
| S4 helpline confirm | web `HelplineConfirm` in `pages/AssistantHome/sections/Safety.tsx`, rendered in `pages/AssistantHome/sections/Settings.tsx`; the template hint in `ally-be/src/chatbot/templates/templates.ts` |
| S5 Inbox by person | `ally-be/src/chatbot/inbox/inbox.service.ts` (one row per contact, contact labels, other chats, `newerChatId`); web `pages/Inbox/Inbox.tsx`, `pages/Inbox/ChatView.tsx` |
| S6 templates in Create | web `pages/Onboarding/create/StartPanel.tsx`, `BuildScreen.tsx`; the route `POST bot-drafts/:id/use-case` in `ally-be/src/bot-draft/templates/template.controller.ts` (N2) |
| S7 safeguarding | `ally-be/src/chatbot/engine/safeguarding.ts`; the engine's `fixedReply` in `ally-be/src/chatbot/engine/chatbot-engine.service.ts` |
| F1, F9, F16 list tools | `ally-be/src/chatbot/agent-tools/list-tools.service.ts` (`fillFromIntake`, `withoutOtherScriptText`), `ally-be/src/chatbot/agent-tools/list-tools.ts` (tool descriptions) |
| F2 typed yes | `ActionsService.typedYes` in `ally-be/src/chatbot/actions/actions.service.ts` |
| F4 held PDFs | `ally-be/src/knowledge-base/privacy/pii-scan.ts`, `knowledge-review.service.ts`; web `pages/Onboarding/create/Sources.tsx` |
| F5, F12, N3 names | `ally-be/src/chatbot/service/chatbot.service.ts` (list names), `ally-be/src/bot-draft/service/bot-draft.service.ts` (`save`), `ally-be/src/bot-draft/name-placeholders.ts`; web `pages/BuilderHome/BuilderHome.tsx` |
| F6 examples | `ally-be/src/chatbot/lists/list-records.service.ts` (`query`, agent only) |
| F8 change by chat | `ally-be/src/bot-draft/home/change.service.ts` |
| F11 paused page | web `botPage/BotPageApp.tsx`, `botPage/screens/ErrorState.tsx` |
| F13 checkup label | web `summaryHeading` in `pages/AssistantHome/sections/Checkup.tsx` |
| F17, B2 access lines | web `botPage/copy/en.ts`, `hi.ts`, `pages/AssistantHome/sections/WhoMayChat.tsx`; Go live's access in `GoLive.tsx` |
| F19 emergency wording | `emergencyKindOf` and `KIND_FIRST` in `ally-be/src/bot-draft/safety-pack/safety-packs.ts`; `EMERGENCY_HOLDING_COPY` in `ally-be/src/chatbot/safety/crisis-copy.ts` |
| F20 done card after a tap | `confirmedWrite` in `ally-be/src/chatbot/bot-page/live-steps.ts` |
| P1, P2 citations | `ally-be/src/whatsapp/util/reply-composer.ts` |
| P3 "Reply STOP" | `withoutStopLine` in `ally-be/src/chatbot/safety/chat-notice.ts` |
| B1 memory notice | `ally-be/src/chatbot/privacy/memory-consent.service.ts`, `memory-consent-copy.ts`; template flags in `templates.ts` |
| B4 withdraw | `withdrawable`, `withdrawOnlyDefinition` in `list-tools.ts`; `withdrawOnly` in `list-tools.service.ts`; the gateway in `ally-be/src/chatbot/agent-tools/agent-gateway.service.ts`; statuses in `ally-be/src/chatbot/templates/template-lists.ts` and `ally-be/src/chatbot/lists/ready-made-lists.ts` |
| B5 WhatsApp names | `ally-be/src/whatsapp/provider/meta-whatsapp.provider.ts`, `ally-be/src/whatsapp/service/whatsapp-inbound.service.ts` |
| N1 consent yes | `askedLast` in `memory-consent.service.ts`, used by `ally-be/src/chatbot/privacy/chat-privacy.service.ts` |

All new customer-facing text: web `pages/AssistantHome/copy/tf1.ts`, and the lines listed in `TEXTS-TF1.md`.

## Decisions

- **The checklist reads the working copy; the status switch reads the live row.** Go live publishes the working copy, so its checklist must too. Overview's "Turn on" on a never-published assistant goes to Build instead of trying a status change that can't make a page.
- **A starting budget, not a new checklist item.** $2 (the cutover's own starting budget), or what's free if less; a budget the owner set, even $0, is never touched.
- **A template's helpline number still waits for the owner's confirm (Q4 G7)**; the confirm moved to where owners look.
- **Safeguarding is decided by the message, not the crisis check's `self_harm` flag**, which fires on harm to someone else. The fixed reply still wins when the person speaks of harming themselves, or for a medical emergency. The crisis alert still goes out.
- **An organisation's PDF with up to 4 phone numbers or emails, and no identity numbers or private names, is its published contacts.** Crawled pages keep the old rule.
- **Example entries are hidden from the assistant only**; the owner still sees them to replace.
- **A typed yes confirms the card just shown** only when the last message carried its question; anything else goes to the agent.
- **"kya aap therapy dete ho?" after a crisis message still gets the crisis reply.** The check reads earlier messages on purpose (chunk 15a); safety is not relaxed.
- **B4 is new installs only.** Existing lists keep their statuses; an owner can re-add a list from its template.

## Memory: the DPDP legal check (before outside users)

B1 turns memory on by default for Services, Donors and volunteers, and Staff onboarding, and replaces the YES/NO consent question with a one-line notice for adult audiences ("… Say 'forget me' any time."). Memory starts when the notice is shown; "forget me" erases at any time. Young or unstated audiences are still asked YES or NO.

This is notice and opt-out, not opt-in consent. **Before outside users, it needs a legal check against India's DPDP Act**, in particular:

- whether a notice with opt-out is valid consent for these purposes, or whether "legitimate use" covers it;
- the notice's required content (what is kept, why, how long, how to withdraw, whom to complain to) and its languages;
- children's data: the young-people path still asks, but an "adults" setting is the owner's word, not verified;
- retention limits for memory lines, and erasure on request across both stores.

Until then, internal launch only. Turning it back to the question is one setting per template (`memory_notice`), and the code path is kept.

## How to test

- **Unit:** each fix's spec sits beside its code (search the spec files for "TF1"). ally-be: `npm test -- --forceExit`. ally-web: `npm run test:admin`.
- **Postgres specs** (template install, inbox): `CHATBOT_STORE_TEST_DB=postgres://…/ally_tf1_test npx jest src/bot-draft/templates src/chatbot/inbox`, with a scratch database made from the current schema (CHUNK-12-NOTES has the recipe).
- **Live:** the scripts in `evals/tf1/scripts/` (a browser driver, a WhatsApp webhook signer, case builders). The re-run steps and what they showed are in `ISSUES-TF1.md`; screenshots in `evals/tf1/screenshots/` (`r1-*`).

## Results of the suites (25 Nov)

- **ally-be:** typecheck clean; ESLint clean on the files this branch changed; full jest 20,138 passed, 1 failed (an auth rate-limit spec that passes alone; nothing here touches it).
- **ally-web admin:** typecheck clean; ESLint clean on changed files; every test this branch touched passes; the round-1 timeouts were machine load, and those files pass on a re-run. AnalyticsAgentTab passes on master and on this branch.
- **Known failures, not from this branch:** two inbox Postgres specs (null scope; same on master); the templates drift check inside the container (ally-web isn't mounted there; passes on the host).

## Open questions

1. **Withdrawal wording.** It reads "Shall I cancel your evening on +919800000001?" and "Done: +919800000001 is cancelled." (the list's existing cancel lines). Proposed: "Shall I withdraw your callback request?" / "Done: your callback request is withdrawn." New wording: yours to approve.
2. **Existing request lists** don't get "withdrawn" (B4 is new installs only). Backfill them, or leave owners to re-add?
3. **Prompts (ally-ai)**: F8's false refusal in change by chat; F10's "I've noted…" before the consent question when memory is turned on by hand.
4. **Weaviate** was killed for memory once during the full suites on a dev laptop; worth a memory limit note in the local stack docs.

## After launch (moved on 25 Nov)

| # | What |
|---|---|
| F7 | One setup answer copied onto every entry (documents on every service; the 80G line on in-kind gifts) |
| F18 | Settings → Safety empty after a template install until a reload |
| P4 | PDF facts listed under "From your website" |
| P5 | "Memory has moved to Tools" while Tools has no memory; "Turn it on in Tools" opens Settings |
| P6 | History shows a raw "safetyPack" key |
| P7 | Checkup: a raw "{s} s to answer" line; a whole update embedded in a question |
| P8 | Credits chart labels are raw keys |
| P9 | Every owner page logs 403 on `/users/me/preferences`; a React error once on "People who may be under 18" |
| P10 | No greeting on the bot page; generic suggested questions |
| P11 | Phone not normalised; awkward confirm lines; no chips for set choices |
| P12 | A spurious 409 when adding a pre-chat question |
| P14 | Template questions not pre-filled from the uploaded PDF; an unexplained empty "Callback requests" list |
| New | Withdrawal wording (open question 1) |

## Local setup notes

- `ally_tf1` is a schema-only copy of `ally_local` plus the migration-seeded rows; migrations can't run from an empty database (`1700000000000` needs `scenarios`). `ally_local` was never touched.
- ally-be ran as build then `node dist/main` with a compose override (`DB_DATABASE=ally_tf1`, dummy SES, a local WhatsApp app secret, no send token). Sign-in codes came from the log; WhatsApp replies were read from `wa_messages`.
- The pre-commit hook was off (`HUSKY=0`), as asked; lint and the suites ran at the end of each round.

## Saathi manual pass (25 Nov): prompts to push at release

Published to the **local** Skills Store only (`publish-local-prompts.js`). Neither adds or removes a variable, so order relative to the deploy doesn't matter for the contract; **push them after the ally-be deploy** anyway, because the code rules (flood and trapped as emergencies, distress as upset, the one-line decline) are what the texts assume.

| Prompt code | Local version | What changed | Production |
|---|---|---|---|
| `ally_ai_knowledge_crisis_classify` | v6 | `emergency` covers disasters (flood, water coming in, fire, collapse, being trapped, an attack); relief questions are not emergencies; `at_risk` no longer includes "someone is in danger" in general; "I'm so stressed and tired of everything" is `upset` unless there's a sign of wanting to die | Push at release, after the ally-be deploy |
| `ally_ai_agent_system` | v7 | Rule 2: a request to ignore or change the rules gets one short sentence that declines and says what it can help with, nothing else | Push at release, after the ally-be deploy |

Defaults updated in the same change: `ally-ai/app/prompts/knowledge/crisis_classify.txt`, `ally-ai/app/prompts/agent/system.txt`.

## Rules checked in code on every reply (TF1 round 2, Saathi and Sahyog passes)

Safety and correctness rules that don't depend on the model following its prompt. Each runs in ally-be's engine (before or after the run) or in ally-ai's reply check (`ally-ai/app/core/agent_runtime/check/`), and each has a test.

| Rule | Where | What happens | Test |
|---|---|---|---|
| Only a phone number (with a short label) ever reaches a crisis reply | ally-be `engine/phone-text.ts` `helplineLines`, read by `crisisHelplines()` | Hours, notes and sentences are dropped; text with no number is refused on save | `engine/test/phone-text.spec.ts`, `crisis-helplines.spec.ts` |
| A flood, water coming in or being trapped is an emergency; distress is upset, never decided by keywords alone | ally-be `engine/emergency-keywords.ts` | Emergency reply at once; distress gets the warm reply with 112 and 14416, the classifier can raise it | `disaster-keywords.spec.ts`, `emergency-keywords.spec.ts`, `saathi-round2-safety.spec.ts` |
| At a spend limit, a message the keyword rules mark at risk still flags the chat and alerts | ally-be engine `keywordCrisisOnly` | Crisis reply, flag and alert, no model call | `saathi-round2-safety.spec.ts` (budget at zero) |
| A request to drop the rules gets one fixed line, after the crisis check | ally-be `engine/visitor-override.ts` | Fixed decline in the voice, no run | `visitor-override.spec.ts`, `saathi-round2-safety.spec.ts` |
| A request to be diagnosed (mental-health packs) gets the fixed reply, after the crisis check | ally-be engine, `caring-decline.ts` | Fixed reply, no run | live `tf1-round2-saathi.json` (`r2-b5-diagnosis*`) |
| Never a national number as the organisation's own | ally-ai `check/fixes.py` `_no_national_number_as_own`; `mood.py` gives only the confirmed own line | The sentence is removed; national numbers are given as themselves | `test_round2_rules.py` |
| No eligibility verdict (Services template, Legal and financial pack) | ally-ai `check/eligibility.py`, `_no_eligibility_verdict` | Sent back once, then the verdict sentence is removed | `test_round2_rules.py` (35%, ₹30,000, 17) |
| No offer the list's abilities don't allow | ally-ai `_no_change_offer_without_the_ability` (and the older `_trim_false_offers`, `_no_false_lookups`) | The offer sentence is removed | `test_round2_rules.py` |
| No action pitch, email or coping tips on an upset turn; no memory or name notice on it | ally-ai `_quiet_on_upset`, `add_fallback_contact`; ally-be `decision.upset` in `chat-privacy.service.ts` | Removed; the crisis numbers stay | `test_round2_rules.py` |
| A rule keeps its condition ("unless", "only if", "except", "until") | ally-ai `check/conditions.py`, `_keep_conditions` | Sent back once, then the rule's own sentence is added | `test_conditions.py` |
| No citation debris or in-text "Sources:" | ally-ai `check/text.py` `without_citation_marks`; ally-be `reply-composer.ts` | Removed: `[n]`, `[]`, `[…]`, "(see citations)", "(cite: …)", a "Sources:" block | `test_round2_rules.py` |
| No promise to message or pass on later | ally-ai `_trim_pass_on_promises` (earlier) | Removed | existing `test_agent_check.py` |
| No "not a crisis service" in replies on the bot page (the page shows it) | ally-ai `_trim_repeated_crisis_wording` | Removed | live |
| A greeting or self-introduction stays small talk | ally-ai `greeting.py`, `check/pipeline.py` `_relabel` | Never the fixed decline | `test_greeting.py`, `test_agent_check.py` |
| No draft text on safety-pack assistants or upset turns; text waits for the crisis verdict everywhere | ally-be `engine/live-reply.ts` | Only status lines and the checked final reply | `live-reply.spec.ts`, `web-channel-crisis.spec.ts` |
| A reply gets at most one rewrite | ally-ai `nodes/agent_check.py` (`MAX_REVISIONS = 1`) | After one, the fixes are applied to the text | existing |

## Search (TF1 round 2)

Hybrid search (`KNOWLEDGE_AGENT__HYBRID_SEARCH`, alpha 0.5, neighbour chunks) was already on by default in this branch and in the running stack, so "turning it on" changed nothing to measure. "Will you tell my parents?" scored 0.27 against the Policies passage with hybrid on. The fix that holds is at the source: setup's fact extraction (`ally_ai_builder_extract` v2) now keeps a rule's conditions in the same fact, and keeps "who decides" rules (Sahyog N-5); and the conditions check above.
