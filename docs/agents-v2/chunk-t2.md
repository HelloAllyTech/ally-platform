# Chunk T2 — Templates that fit the organisation

> Brief for Claude Code. Read `CONTEXT.md`, `ROADMAP.md`, `chunk-t1.md`, `CHUNK-T1-NOTES.md`, `T1-TEMPLATE-TEXTS.md`, `EVALS-ROUND7-22NOV.md`, `EVALS-RHA-LIVE-22NOV.md`, `FIXES-22NOV.md` (R3, R6), `CHUNK-Q4-NOTES.md` (key facts, low-value pages), then this file. Plan briefly. <!-- docs-path-lint: planned -->
> Branch: `feat/agents-v2-t2` from master **after Q4 light is merged**. Tag commits `[T2]`. Repos: ally-be, ally-web (ally-ai only for the reading step).
> **One stop:** every changed template text (setup questions, key-fact questions, starter questions, practical-help lines, card titles) in one file. About 1.5 days.

## Why

T1's templates install lists and settings, but on 22 Nov they didn't fit the organisations they were used for: a template never read the website, its tagline became a fact ("…at any hour" on a helpline with fixed hours), the Helpline template asked a therapy clinic's questions (fees, cancellation), a food-rescue NGO carried the Helpline template, and the Donors and volunteers lists couldn't be added to an existing assistant. The first users start from these templates, so each must fit, read their site, and know the few facts that matter most.

## 1. A template also reads the organisation

- **"Start from a template" asks for the website (or documents) too,** and reads them exactly as setup does without a template. Skipping is allowed, and then the screen says nothing was read (never "The pages we read didn't say much").
- **The template's tagline and description are never saved as facts.** Only the owner's answers and what was read become facts.

## 2. What each template carries (new fields in the template data)

- **Key-fact questions:** 3–5 questions whose answers become the assistant's **Key** facts (Q4 §G3), always in context. Examples:
  - Helpline: the number; the hours (and the days); languages; "Is this an emergency service?"; what you don't do (diagnosis, medication).
  - Services and eligibility: who is eligible; the areas served; the cost; how to apply.
  - Donors and volunteers: "Do you accept money donations?" (with "No, we're zero-funds" as a choice), 80G and how receipts are sent; how to volunteer; what can be given (food, goods, time).
  - Staff onboarding: who it's for; where policies live; who to ask.
  - Reach more communities: the languages people write in.
  - Campaigns: where updates are published; how long an update stays current.
  - Business templates: their equivalents (hours, prices, booking rules).
- **Setup questions that fit:** each template's own (no fees or cancellation on Helpline; no "online or in person" unless the template offers sessions). A question already answered by the website is shown with that answer to confirm, not asked again.
- **Starter questions:** 3–4 per template, worded for its people ("How do I volunteer?", "Can my restaurant donate food?", "Any drives near me this weekend?"), filled from what was read where it can. Never generated from low-value pages.
- **Hand-over:** on only where the template is about talking to a team (Helpline, Customer support), and then for explicit requests only (Q4 §G1). Others use a callback or details list instead.
- **Practical-help line after a crisis reply** (optional, owner-approved, Q4 §G7): Helpline: the organisation's own line and hours; Donors and volunteers for food or shelter: "Tell me your area and I'll point you to the nearest chapter".
- **Card titles per list:** "Callback requested", "Registered", "Application received", "Booked", each with its date, time and venue where they apply.
- **The minimum safety pack:** stays as in T1 (never weakens); reading can only make it stricter, with the pack-detection fixes from Q4.

## 3. Templates fit the organisation

- **A seventh organisation template, "Food and essentials drives"** (food rescue, donation drives, community kitchens), or the Donors and volunteers template gains these as a variant: drives and events with places, volunteer sign-ups, surplus-food pickups (restaurants, events), "we don't take money" as a key fact. Decide in the plan which is simpler; the RHA set (`EVALS-RHA-LIVE-22NOV.md`) must pass on it.
- **Suggest the right template:** after reading, setup suggests the template that fits what was read (food rescue → Donors and volunteers or the new one; a helpline → Helpline), with the reason in one line, and the owner can choose another.
- **The organisation templates' lists are ready-made lists too** (Volunteer sign-ups, Volunteer shifts, Donor enquiries, Ways to give, Applications, Services, Updates, Questions for the team), so an existing assistant can add them from Tools.

## 3b. Template answers are used everywhere (Round 8)

- **Setup's quick questions skip what the template already asked** (Akshaya Patra was asked how people donate and volunteer right after answering both).
- **Template answers become facts the assistant uses,** including locations and hours (Jaipur Foot: "I don't have opening hours" though entered), and the **checkup is built around the template's use case** (Akshaya Patra's checkup asked about COVID meal costs, nothing about donating), graded against the owner's answers.

## 4. Installing on an existing assistant is explicit

- **Tools → Add from a template** names the assistant ("Add Helpline and crisis support to Robin Hood Army?"), lists what it adds, and asks to confirm. `chatbot_template_installs` records who installed it and when; How it works shows both.
- **Remove a template's additions:** lists it added that have no entries can be removed in one step; the "Set up from" line follows.
- Investigate the RHA row (Round 7 N5): how a Helpline install got onto Robin Hood Army, and fix the path if it wasn't an owner's choice.

## Tests

- Every template, installed with a website, reads it; none saves its tagline as a fact; each has its key-fact questions, starter questions and card titles.
- Robin Hood Army rebuilt from the fitting template: the RHA set (18 messages, `EVALS-RHA-LIVE-22NOV.md`) passes against each "Should be", including zero-funds, Hindi and Tamil answers, "Shall I register you for 11:00 on Sun 29 Nov at Bandra West station (1 place)?", and the starters.
- iCall rebuilt from Helpline with its website: hours, languages and "not an emergency service" are key facts; the 2am message gets the pack's numbers and iCall's line.
- The use-case suite (`EVAL-USECASES.md`) on the six organisation templates: no worse than after Q4, and the T1 starter checkups at 70%+.
- Installing on an existing assistant asks to confirm and records who; removing additions works.

## Done when

- [ ] Templates read the website; no tagline facts; key facts, setup and starter questions, hand-over, practical-help lines and card titles per template
- [ ] The food-drives fit (new template or variant); the organisation lists as ready-made lists; the right template suggested
- [ ] Installing on an existing assistant is confirmed and recorded
- [ ] RHA and iCall rebuilt and passing; texts approved
- [ ] `CHUNK-T2-NOTES.md`, `PR-T2.md`, the Progress row <!-- docs-path-lint: planned -->
