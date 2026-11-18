# Q3-fast: notes

The fixes real customers would notice first, from the 17–18 Nov production tests (`EPIC-Q3-FAST.md`,
`FIXES-17NOV.md`, `Q3-FAST-GAPS-AND-RETEST.md`). Built 18 Nov 2026 on `feat/agents-v2-q3-fast`.
Q3d's six fixes were merged in (`tmp/q3d`). Commits are tagged `[Q3-fast]`.

## What's done

| Part | What changed | Where |
|---|---|---|
| 0 One path | No v1 fallback. A failed run sends a fixed reply in English or Hindi, with the business's contact taken from its sources or helplines | `agent-runtime-runner.service.ts`, `run-failed-reply.ts`, `reply-language.ts` |
| 0b Booking | Free means free. A refusal reaches the customer in words. Tools stay for the whole chat. Picking an option isn't a yes. The reservation title names its table | `list-records.service.ts` `takenOf`, `check/pipeline.py`, `tools/confirmed.py`, `handover.service.ts` |
| 1 Safety | Four crisis levels: at risk, emergency, upset, none. At-risk and emergency replies come fast, with real numbers. Upset gets a warm reply that still answers. Owners can correct a wrong pack. Young-people assistants have no pre-chat questions. New pack versions: Medical v3, Legal and financial v2 | `crisis_classify.txt`, `safety-packs.ts`, `chatbot-engine.service.ts`, `looks-emotional.ts`, `everyday-idiom.ts` |
| 2 Answers | No internal voice ("the provided passages…"). No false offers. A decline gives the real contact. The facts setup learned are searched, as a "What we learned" document. 8 passages per search. The fallback contact line is added once | `check/text.py`, `check/fixes.py`, `learned-facts-document.ts`, migration `1984300000000` |
| 2b Playbooks | Each list brings its own instructions (booking, details, orders, reference). Owners can add a line per list | `playbooks.py`, `prompts/agent/playbook_*.txt`, `list-tools.ts`, `AssistantBlock.tsx` |
| 3 Trust in setup | Error, block and captcha pages are never stored as facts, and Cloudflare-hidden emails are decoded. Setup lists "We couldn't read these pages". The message matches the score. Publishing has a quality gate with "Publish anyway". Uploads show "Reading your documents…" until they're read | `crawl/error-page.ts`, `page-parser.ts`, `checkup-gate.ts`, `CheckupScreen.tsx`, `bot-draft-session.service.ts` `reading` |
| Gaps items | The Safety screen shows the at-risk reply as sent. Ready-made Appointments examples are neutral | `assistant-home.service.ts` `atRiskReply`, `ready-made-lists.ts` |

## Measured, on local copies of the seven 17 Nov businesses

The copies were built from their public sites, in `evals/prod-17nov/runs/`.

- **Safety:** see `Q3-PROMPTS.md` Part 1. 0 misses. At-risk replies take a median 2.1 s.
- **Answers:** in-data answers went from 57% to 72% of runs with fix 1 (`P2-FIX1-REPORT.md`).
  After the fast finish: see `P2-FASTFINISH.md`.

## Decisions

- **The gate's rules.** A gap counts against the gate's 70%. A failing safety question still
  blocks publishing; "Publish anyway" doesn't override it.
- **No re-index.** Production's assistants will be recreated, and the facts document is written
  at publish.
- **One pack per assistant.** A pack asked for in setup is applied only when it's strictly
  stricter. Medical, pharmacy, mental health and young people never replace one another.
- **Appointments examples.** Therapy services appear only for a mental-health assistant. Every
  other business we can't place gets "Consultation, Follow-up, Something else".

## Deferred to the next round

- Keyword search beside the vector search.
- Splitting a message that asks two questions.
- The right number, not a page label (C15).
- The finance wording "no returns are guaranteed".
- The B9 judge change (the grader failing correct answers).
- Part 3b from the gaps doc.
- Combining safety packs: an assistant has one pack today. Medical, pharmacy, mental health and young people never replace one another, so setup says it can't add the second one.
- Booking for someone else.
- Gaps items 1–7 not done here.
- The full retest, which runs on production as Round 5.

## How to test

```bash
cd ally-be && npm test -- --forceExit && npm run lint && npm run typecheck
cd ally-ai && poetry run pytest tests/ && poetry run flake8
cd ally-web && npm test && npx tsc --noEmit -p apps/ally-admin-dashboard/tsconfig.app.json
```

The live suites run inside the ally-be container, with the basics runner:

```bash
node dist/chatbot/basics/run-basics.js --bot <id> --cases src/chatbot/basics/cases/<file>.json --repeat 3
```

| Suite | Cases file |
|---|---|
| Safety | `prod-17nov-safety.json` |
| Answers | `prod-17nov-answers.json` |
| Booking | `prod-17nov-booking.json` |

To rebuild the local copies, use `ally-ai/scripts/onboarding_eval.py --sites docs/agents-v2/evals/prod-17nov/sites.json`.
Add `--trace` to the basics runner to print each agent step.

## Known, not fixed here

Three Postgres tests fail on master too:

- `bot-draft.pg.spec.ts` "publishing twice converges…" expects pack version 1, but mental health
  has been version 2 since SP1.
- Two `inbox.pg.spec.ts` tests fake `accessibleChatbotIds` as `null`, the platform-admin
  shortcut A1 removed.
