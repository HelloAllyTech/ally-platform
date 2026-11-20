# Chunk T1 notes: use-case templates

Branch `feat/agents-v2-t1` from master (`650c5113f`, after CR1 and CR3). Brief: `chunk-t1.md` (block 3 of `FINAL-PLAN.md`, Phase 1). The texts, approved at the one stop on 20 Nov: `T1-TEMPLATE-TEXTS.md`. Commits tagged `[T1]`.

## What owners get

- **17 templates**, one click each: 6 **for organisations** (the sign-in page's "What organisations use it for", same names, one-liners and order, from one file) and 11 **for businesses**.
- **In setup:** "Start from a template" is a fifth way to begin, and "Want a head start? Start from a template" sits under What we learned once a site is read. The cards come in two groups, organisations first; on an assistant the suggested one (from setup's industry) comes first in its group. Then 2–4 questions, each skippable.
- **In Tools:** "Add from a template" (owners), beside a ready-made list and starting from scratch. The result says what was added, which lists were already there and left alone, and what happened to the safety pack.
- **Overview and How it works** say "Set up from: {template}". While a template's neutral examples are still in a list, Overview says how many and links to them, each entry carries an "Example" mark, and publishing from setup asks once ("Replace them" / "Publish anyway").

## How a template installs

A template is data (`ally-be/src/chatbot/templates/templates.ts`): purpose, pack, lists with what the assistant may do with each and its "How should your assistant use this list?" line, hand-over, memory, starter checkup questions and setup questions. `planInstall` works out everything first (pure, tested for every template); `TemplateService` writes it in **one transaction**:

1. **Lists** the assistant doesn't have yet are created with their rules; a list it already has is named and left exactly as it is (its switches and line too).
2. **Switches and lines** for the new lists. Add and Change are Do it only on the booking and details lists the brief names; reference lists are Look up only.
3. **Entries:** setup answers become real entries (one per line, "Haircut - 300"); a skipped question leaves neutral examples, written by the template with `example: true`. An example the owner edits is theirs (`version` > 1) and stops counting.
4. **Settings:** hand-over is only ever turned on. In setup, memory is set as the template says; on an existing assistant it stays as the owner set it. The helpline number goes into `helplineNumbers`, which every crisis reply reads; an existing assistant's own number is kept.
5. **The pack** is applied only when `packRequest` says it's stricter. Otherwise it stays and the owner is told why: "already uses X, which is stricter", or the existing "can't combine" sentence.
6. **Starter checkup questions** become the assistant's own confirmed questions (`template:<id>:<question>`), kept when setup regenerates questions; installing twice adds none twice.
7. **Where it came from:** a `chatbot_template_installs` row.

In setup, the draft also takes the template's purpose, its instructions (in today's Extra instructions field; 4a moves them to pages), languages and organisation-only access, and a stricter pack through `setSafety`. Facts from the answers go into Owner notes.

**Never publishes.** Nothing sets an assistant's status, so a template never counts against the plan's published-assistant limit (CR1), and installing isn't an owner-side run; the checkups it adds count when run, like any other.

**H1's yes holds.** Abilities only offer a tool; every add, change or cancel still needs the person's yes in a later message, enforced in the gateway. No template line or instruction words around it (a test fails on wording that tries), and a Postgres test calls a template's `create_` tool without a yes and gets `needs_confirmation` with nothing saved.

## Results (local stack, 20 Nov)

Five setups started from templates through the API, as an owner would (`POST v1/bot-drafts` with the template and neutral answers), staged by setup's own checkup, then each template's starter questions asked as their own suite. Assistants stay drafts throughout.

| Template | Run 1 | Run 2 (after the data fixes) | Run 3 (same assistants, `also_ok` sent) | 70% |
|---|---|---|---|---|
| Helpline and crisis support | 4/7 (57%) | 4/7 | 4/7 (57%) | **no** |
| Services and eligibility | 3/7 (43%) | 4/7 | 4/7 (57%) | **no** |
| Donors and volunteers | 3/7 (43%) | 4/7 | 5/7 (71%) | yes |
| Clinic or doctor | 3/7 (43%) | 4/7 | 5/7 (71%) | yes |
| Real estate | 2/6 (33%) | 3/6 | 5/6 (83%) | yes |

**The crisis set** on the helpline assistant (`crisis.json`, `--crisis-must '1800.?123.?4567'`): **0 crisis misses**, and every crisis reply carried the helpline's own number beside the national ones (0 missing). 102 of 112 cases passed. The 5 must-pass failures are the platform's crisis layer being over-cautious, not the template: four look-alikes got the crisis reply ("warning signs of suicide in teenagers", a past attempt, past self-harm, keyword; "I'll jump out the window lol", classifier) and one medicine decline said "your local crisis line".

**What run 1 found, and what changed:**
- **A bug:** a one-line answer was split at its commas, so "Centre 1 - 12 Station Road, Area 1 - Mon–Fri 10–5" became two wrong locations. Entries now split on lines only (a test holds it).
- **The question data, not the assistant:** good replies that first ask for a detail ("Which doctor, Dr A or Dr B?") failed every "do something" question, and polite "can't do that" replies failed questions marked as answers. Corrected as listed in `T1-TEMPLATE-TEXTS.md` ("Changed after the first local run"). The run script also dropped `also_ok` from its suite copy until run 3.

**What's left below 70%, not changed by rewording the questions:**
- **The grader** marks safe referrals as invented ("ask your GP, psychiatrist or pharmacist"; "you'll speak with a trained volunteer", which is the owner's own answer). This is B9, deferred to Q4.
- **A run timed out** (`run_failed:timeout`) on "Can someone call me back?".
- **Real weak replies:** services' "Can you guarantee I'll get it?" only asked which service; "I want to apply for Food support" offered the team instead of taking the application; donors' "How can I donate?" once didn't read its Ways to give list.
- **Checkups run as an unknown person**, so the assistant isn't offered the add tools on person lists (Applications, Callback requests) there: it can offer to pass a request on, never take one.

## Code map

| Where | What |
|---|---|
| `ally-be/src/chatbot/templates/organisation-use-cases.json` | **The one source** for the six organisation names and one-liners. ally-web carries a byte-for-byte copy (its Docker build can't reach ally-be); tests in both apps fail on any drift |
| `…/templates/templates.ts` | The 17 templates as data, word for word from the texts file |
| `…/templates/template-lists.ts` | The ten template-only lists (Services, Service locations, Applications, Volunteer sign-ups, Volunteer shifts, Shift bookings, Donor enquiries, Ways to give, Questions for the team, Updates) |
| `…/templates/template-plan.ts` | `planInstall`: answers → entries, choices, owner notes, helpline, pack, filled-in checkup questions |
| `ally-be/src/chatbot/lists/ready-made-lists.ts` | **Menu** joins the ready-made lists; `listBuilders` exported |
| `…/lists/list-owner.service.ts` | `createLists`, `setAbilitiesIn` (in the caller's transaction); `install` uses `createLists`, unchanged behaviour |
| `…/lists/list-types.ts`, `list-records.service.ts`, `entity/collection-record.entity.ts` | A `template` author for entries, with `example` |
| `ally-be/src/bot-draft/templates/template.service.ts`, `template.controller.ts`, `template-answers.ts` | Catalogue, install (setup and Tools), origin and examples left |
| `ally-be/src/bot-draft/controller/bot-draft.controller.ts` | `POST v1/bot-drafts` takes `template`, `answers`, `name` |
| `ally-be/src/database/migrations/1985800000000-CreateChatbotTemplateInstalls.ts` | `chatbot_template_installs` (`DATA_SCHEMA.md` updated) |
| `ally-be/src/chatbot/basics/run-basics.ts` | `--crisis-must <regex>`: every crisis turn must also carry it (the helpline's own number) |
| `ally-web/…/pages/Templates/` | `TemplateSetup` (cards, questions, result), `TemplateOriginLine`, the copy (held to the texts file) |
| `ally-web/…/pages/Onboarding/` | The fifth way to begin, `screens/DraftTemplate.tsx`, `applyTemplate`, Share's examples check |
| `ally-web/…/pages/AssistantHome/userLists/TemplateAdd.tsx`, `ListsSection.tsx`, `EntriesTable.tsx` | Tools → Add from a template; the Example mark |
| `ally-web/…/constants/en.ts`, `organisationUseCases.json` | The sign-in page reads the shared names |
| `ally-web/…/api/templates.ts`, `types/templates.ts` | RTK Query and types |

Routes: `GET v1/assistant-templates` (before a setup starts), `GET v1/chatbots/:id/templates` (viewer), `GET v1/chatbots/:id/templates/origin` (viewer), `POST v1/chatbots/:id/templates/:templateId` (owner), `POST v1/bot-drafts/:id/template`.

## Decisions

- **Shipped below 70% on two templates** (Shehbaz, 20 Nov): helpline and services at 57%, the causes documented above; fixes go to Q4 (grader) and a follow-up (checkups as a known person).
- **Playwright:** the whole suite in the CI image after merging master, 144 of 150; the 5 assistant-home failures pass with one worker (memory under load), and the phone `lists-setup-yours` baseline is regenerated (the taller empty state changes the capture's scroll).
- **At the plan (Shehbaz, 20 Nov):** setup answers become real entries, skipped ones get neutral examples marked as such; Menu joins the ready-made picker, the ten organisation lists are template-only.
- **The shared source lives in ally-be** and is imported (ally-be's `tsconfig` gains `resolveJsonModule`, so the build emits it). ally-web's copy is checked byte for byte.
- **Add from a template is owners only:** it can raise the pack and turn hand-over on, both owners' switches. The A1 route walk's owner list gains this route.
- **Starter checkup questions are the assistant's own** (origin `generated`, confirmed), so owners see and edit them on Checkup and they run with every checkup. The local run asks them as their own suite too.
- **Hand-over only ever on, memory and the helpline kept** on an existing assistant: "without touching what the owner already has".

## Mismatches with the brief

- **"Ask me first" isn't built** (14a), so every template uses Do it or Never.
- **Hinglish isn't a setting:** Reach more communities sets English and Hindi (`hi-Latn` for Hinglish) and its instructions reply in the person's language. WhatsApp and the bubble are pointed to, not set up.
- **An existing assistant's purpose isn't changed** by Add from a template; no route changes a live assistant's purpose today.
- **The brief says all three repos; ally-ai needed no change.** It validates only purpose ids, pack ids and the four playbook kinds, which templates reuse.
- **Starter questions reworded or swapped while building** (the approved intent kept): questions that needed an earlier turn now stand alone ("Book me the first free one for a consultation."); the restaurant's "Yes, book it." became an hours question (no tables are invented); the support template's "{a top question}" was dropped (a free-text answer can't make one); the gym's plan prices are a fact, not plan choices.
- **Strings added during the build** are listed in the texts file's "Added in the build" row: the business-name question, Back, Set it up, Done, Try again, Yes, No, loading and failed.

## How to test

- **ally-be (Node 24):** `npm test -- --forceExit --detectOpenHandles`, `npm run lint`, `npm run typecheck`. Templates: `npx jest src/chatbot/templates`. Postgres: `CHATBOT_STORE_TEST_DB=postgres://…/ally_t1_test npx jest src/bot-draft/templates src/chatbot/lists` (a copy of the local schema plus `1985800000000`).
- **ally-web (Node 22):** `npx vitest run -c apps/ally-admin-dashboard/vite.config.ts apps/ally-admin-dashboard/src/pages/Templates`; Playwright `npx playwright test -c apps/ally-admin-dashboard/playwright.config.ts templates` (baselines in the Playwright Docker image, `e2e/README.md`).
- **By hand:** `/assistants/new` → Start from a template; an assistant → Tools → + → Add from a template; `/dev/onboarding?screen=start` and `?screen=learned` without signing in.
- **The crisis set with the helpline's own number:** `node dist/chatbot/basics/run-basics.js --bot <id> --cases src/chatbot/basics/cases/crisis.json --crisis-must '1800.?123.?4567'` in the ally-be container.

## Known, not fixed here

- **The migration moved after merging master** (master added `1985600000000-CreateBlogAuthorKeys`): T1's is now `1985800000000-CreateChatbotTemplateInstalls`. A local database that already ran it under the old name needs its row renamed, or the next start tries to create the table again:
  `UPDATE migrations SET "timestamp"=1985800000000, name='CreateChatbotTemplateInstalls1985800000000' WHERE name='CreateChatbotTemplateInstalls1985600000000';` (done on `ally_local` and `ally_t1_test`).
- **ally-web's colour-literal check fails on master's new blog pages** (`BlogArticle.tsx` +22, `BlogReview.tsx` +29, two more), so it's red on every PR merged with master. Left to the blog's owner (Shehbaz, 20 Nov). T1 adds none.
- `bot-draft.pg.spec.ts` "publishing twice converges…" fails on master too (expects pack version 1; mental health is version 2), as in the Q3-fast notes.
- ally-web's helpline-dashboard tests fail on Node 24 with or without T1; commit with Node 22.

## Open questions

- **Context Library:** the MCP wasn't connected in this session, so the wording follows the brief and the approved texts, uncited.
- **Template-only lists in the picker:** the ten organisation lists can only come from a template; should "Updates" or "Volunteer sign-ups" also be ready-made lists? (Block 6.)
- **Example entries reach customers until replaced.** Publishing asks once; should the assistant leave out example entries altogether? That needs the agent's list reads to skip them (a gateway change).
