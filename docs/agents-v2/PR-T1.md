# T1 — Use-case templates

Block 3 of `FINAL-PLAN.md` (Phase 1); brief `chunk-t1.md`; the approved texts `T1-TEMPLATE-TEXTS.md`; notes `CHUNK-T1-NOTES.md`.

## What it does

Owners start from a whole use case instead of assembling an assistant from parts. **17 templates**, using only what works today:

- **For organisations (shown first):** Helpline and crisis support, Services and eligibility, Donors and volunteers, Staff and volunteer onboarding, Reach more communities, Campaigns and urgent updates. Names, one-liners and order match the sign-in page's "What organisations use it for", read from **one file** (`ally-be/src/chatbot/templates/organisation-use-cases.json`; ally-web carries a checked copy). Tests in both apps fail if they drift.
- **For businesses:** Clinic or doctor, Salon/spa/consultant, Restaurant or café, Real estate, Online store, Coaching or school, Gym or studio, Mental-health helpline or practice, Finance or legal firm, Customer support, Staff handbook.

**Where:**
- **Setup:** "Start from a template" as a fifth way to begin, or after the website is read. The cards come in two groups, then 2–4 questions, each skippable.
- **Tools → Add from a template** (owners): adds the template's lists, what the assistant may do with each, their lines and starter checkup questions, and says what it added, what it left alone and what happened to the safety pack.
- **Overview and How it works:** "Set up from: {template}" and any examples still to replace; an "Example" mark on those entries; setup's publish step asks once while examples remain.

**What a template installs, in one transaction:** lists (existing ones skipped and named, never changed), their switches and lines, entries from the owner's answers (neutral examples, marked, for skipped questions), hand-over on, the helpline number every crisis reply gives, a pack **only when stricter**, starter checkup questions, and where the assistant came from.

**Respecting what's built:**
- **CR1:** installing never publishes, so it never counts against the plan's published-assistant limit; it isn't an owner-side run.
- **H1:** abilities only offer a tool; every add, change or cancel still needs the person's yes in a later message, enforced in the gateway. A test fails on template wording that would talk round it, and a Postgres test calls a template's `create_` tool without a yes: `needs_confirmation`, nothing saved.
- **Safety:** `packRequest` decides; a template's pack never replaces a stricter or a different care pack, and the owner is told.

## Results (local stack)

| Template | Starter checkup | 70% |
|---|---|---|
| Helpline and crisis support | 4/7 (57%) | no |
| Services and eligibility | 4/7 (57%) | no |
| Donors and volunteers | 5/7 (71%) | yes |
| Clinic or doctor | 5/7 (71%) | yes |
| Real estate | 5/6 (83%) | yes |

**Crisis set** on the helpline assistant: 0 misses; every crisis reply carried the helpline's own number beside the national ones. The 5 must-pass failures are the platform's crisis layer over-calling look-alikes (four) and "your local crisis line" in a medicine decline (one), not the template. What's left below 70% and why: `CHUNK-T1-NOTES.md` → Results.

## Decisions

- Setup answers become real entries; skipped ones get neutral examples marked as such (Shehbaz, at the plan).
- Menu joins the ready-made lists; the ten organisation lists install only through a template (Shehbaz, at the plan).
- Add from a template is owners only (it can raise the pack and turn hand-over on); the A1 route walk's owner list gains it.
- Starter checkup questions are the assistant's own confirmed questions, so owners see and edit them on Checkup.
- On an existing assistant: hand-over only ever turned on; memory, access, purpose and its own helpline number are kept.

## Mismatches with the brief

"Ask me first" isn't built (Do it / Never only); Hinglish isn't a setting (languages plus the template's instructions); an existing assistant's purpose isn't changed; ally-ai needed no change. Starter questions corrected after the first local run are listed in the texts file.

## Deploy

- Migration `1985600000000-CreateChatbotTemplateInstalls` (one new table; nothing else changes).
- No prompt text changed; no new prompt.
- ally-be's `tsconfig` gains `resolveJsonModule` (the shared organisation file is imported and emitted with the build).

## Screenshots

Playwright baselines at 1440 and 390: `templates-setup-cards`, `templates-setup-questions`, `templates-tools-cards`, `templates-tools-result` (`ally-web/apps/ally-admin-dashboard/e2e/__screenshots__/`); `lists-empty` changes for the new Add from a template choice.

## Tests

- ally-be: `src/chatbot/templates/test/templates.spec.ts` (every template: lists, abilities, lines, wording, question counts, plans; the shared file; the web copy), `src/bot-draft/templates/test/template-install.pg.spec.ts` (every template installs in one transaction; existing lists kept; pack never weaker; never publishes; all or nothing; H1).
- ally-web: `pages/Templates/__tests__` (screens, copy held to the texts file, the one source), plus Onboarding, Tools and Share tests; `e2e/templates.e2e.ts`.

## How to test

1. `/assistants/new` → Start from a template → Helpline and crisis support → answer the helpline number → Set it up. Safety shows Mental health, the crisis reply in Safety gives your number, Tools has Callback requests, Checkup has the starter questions.
2. An assistant you own → Tools → + → Add from a template → Clinic or doctor. Lists it already has are named and left alone; a stricter pack is kept and you're told.
3. Overview: "Set up from: …"; skipped questions leave examples marked "Example" in their list.

## Follow-ups

- The grader's B9 (correct referrals marked invented) holds two of the helpline's starter questions; Q4.
- Checkups run as an unknown person, so details lists (Applications, Callback requests) can't be filled there.
- The crisis layer's keyword rules over-call "warning signs" and past self-harm or attempts.
- Whether example entries should be hidden from customers until replaced (a gateway change).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
