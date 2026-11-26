# Chunk UX1: Make what's built easy to use

> Brief for Claude Code. Read `docs/agents-v2/CONTEXT.md`, `docs/agents-v2/DESIGN.md`, `docs/agents-v2/ONBOARDING-COPY.md`, `docs/agents-v2/ROADMAP.md`, `docs/agents-v2/ISSUES-TF1.md`, `docs/agents-v2/TF1-SAATHI-FINDINGS-25NOV.md` (the manual test report, including its "What it was like to use" section), then this file.
> **Fresh start:** a clean worktree from `origin/master`, branch `ux1`. Tag commits `[UX1]`. One PR per slice.
> **Stops:** after the audit (Phase 1); after the target journeys and their tests (Phase 2); after each slice in Phase 3. Show screenshots at each stop and wait for approval.
> **Never relaxed:** the safety rules, the crisis replies, and "no write without a yes". If a UX change touches any of them, stop and ask.

## Why

Testing Saathi Youth Helpline end to end (25 Nov) showed that most of what an owner and a person need already exists: templates, facts with sources, Try it, Change by chat with Undo, the crisis check, the go-live checklist, Confirm cards, the Inbox and hand-over. The problem is how they are placed and how they behave in a real journey:

- The owner has no path after setup, can't see which safety pack is on, doesn't know when they've gone live or what budget was set aside, and sees three checkup scores that disagree.
- The person chatting is greeted with "A colleague or supervisor is the better route", watches answers get swapped after they've read them, needs three tries to request a callback, waits 15 to 20 seconds, and hits pages that turn them away with no help number.

`DESIGN.md` already sets the right principles ("One thing at a time", "Always alive", "Honest", "Editable everywhere"). The product has drifted from them. This chunk brings the owner and visitor journeys back in line with them, measures the result, and proves it with tests.

## Scope

In: the owner journey from Create to watching the Inbox, and the visitor journey on the bot page, for the five organisation templates.
Out: WhatsApp, new list types, new abilities, pricing, the business templates, visual rebranding. Don't add features that aren't needed to fix a journey.

## Phase 0: Trust fixes come first

A redesign can't be judged while the product gives wrong or unsafe answers. Before any UX slice ships, these must be fixed (in the TF1 fix loop or here, whichever is first). They are behaviour bugs, not layout:

- S-1 to S-4 from the findings report (garbled helpline text in crisis replies, flood routed to self-harm, over-triggered crisis reply, injection answered with a joke).
- B-1 (the draft is streamed, then replaced by the fixed decline; staff decline wording on a public helpline).
- B-2, B-3, B-4 (name not learned, callback not started from a plain ask, cards without the person).

**Status (26 Nov): done by TF1 round 2 (merged and released, `be-v1.275.0`).** Confirm on master before Phase 1. TF1 also partly did slices O-B (pack named, helpline field and preview), O-C (go-live confirms), O-D (checkup counts), P-C (cards carry the person) and P-E (crisis information on dead-end pages): audit what's left of each rather than rebuilding it; `CHUNK-TF1-NOTES.md` lists what was done.

## Phase 1: Audit (no code changes)

1. Run both journeys with Playwright on the local stack (`ally-web/apps/ally-admin-dashboard/e2e`) for the Helpline template, and screenshot every screen at desktop width and at 375 px.
   - Owner: Create → template → questions → PDF → what it learned → safety → lists → checkup → Try it → change by chat → go live → share → Inbox → take over → hand back.
   - Person: open link → sign in → greeting → two facts → the template's action → come back in a new chat → a crisis message → removed or paused.
2. For each step record: screens visited, clicks, seconds of waiting, what the user must find on their own, and every place the text or numbers disagree.
3. Map every finding in the report (S, B, P2 and "What it was like to use") to a journey step and to the `DESIGN.md` principle it breaks.
4. List the ingredients that already work and should be reused rather than rebuilt (for example the go-live checklist, the crisis check, Change history, the Confirm card).
5. Write `docs/agents-v2/UX1-AUDIT.md` with the screenshots, a table per journey, and the top 10 problems ranked by how often a real owner or person would hit them and how badly.

**Stop.**

## Phase 2: Target journeys and their tests

Write the target journeys as short step lists, then as Playwright specs that fail today. These specs are the definition of done.

### Owner journey targets

| # | Target | Measured by |
|---|---|---|
| OJ1 | After the template questions, the owner lands on one "Get it ready" path with each step in order and one primary action per step | Spec walks the path without using the side nav |
| OJ2 | Template to live in 10 minutes or less, with no dead ends | Spec timing, step count |
| OJ3 | The safety pack, helpline number and crisis check status are visible together in one place, before and after go-live | Spec reads them from one card |
| OJ4 | The helpline number is a phone field; the owner sees the exact crisis reply it will produce before confirming | Spec checks the preview text equals the sent reply |
| OJ5 | Go live confirms in place: it's live, who can chat, the link, the budget set aside, and what happens at zero | Spec checks the dialog and the badge without reload |
| OJ6 | One checkup score with the crisis check as a separate pass or fail; all counts agree everywhere they appear | Spec compares Overview, Build and Checkup numbers |
| OJ7 | After Change by chat, a short replay of 3 to 5 key questions (the template's action, the crisis check, two facts) shows before and after replies, and warns if the action stopped starting | Spec applies a change and reads the replay |
| OJ8 | Settings split into tabs; "Who may chat" has one home | Spec finds each setting in one click from Settings |

### Person journey targets

| # | Target | Measured by |
|---|---|---|
| PJ1 | Never show text that is then taken back | Spec records every streamed frame and compares it to the final reply |
| PJ2 | Something visible within 1 second; first useful reply p50 under 6 seconds, p95 under 12 | Spec timings across 20 runs |
| PJ3 | "Hi, I'm Asha" gets a greeting by name and one line on what it can help with | Spec |
| PJ4 | Asking for the template's action in plain words starts it on the first turn ("Can someone call me back tomorrow evening?") | Spec, for each of the five templates' actions |
| PJ5 | Cards show the person's name, the day and time in words, and the contact used; cancelled cards say cancelled | Spec |
| PJ6 | The disclaimer appears once; suggestions follow from the last reply or are hidden; no internal source names | Spec |
| PJ7 | The person can type while a reply is pending, and messages are never joined | Spec |
| PJ8 | After a crisis reply: one message, the helpline number stays visible, and it says when a person will reply | Spec |
| PJ9 | Every page that stops the person (code screen, not invited, removed, bad link, paused) shows crisis information and is styled | Spec visits each |

Also add an accessibility check (axe) to each spec, and a 375 px run.

**Stop.**

## Phase 3: Build in slices

Each slice: behind a feature flag, one PR, its Phase 2 specs green, before and after screenshots at desktop and 375 px, new strings added to `ONBOARDING-COPY.md` in the same commit, `DESIGN.md` tokens and components only. **Stop after each slice.**

Order by what hurts most:

1. **P-A Checked replies only (PJ1, PJ2).** It changes when the safety check's result is shown, so it **stops for approval before merge, with the crisis must-pass cases re-run**. Show a live "Looking at {organisation}'s information…" line within 1 second, and show the reply only after the check passes (or stream into a held state that can't be read until checked). Measure latency before and after; don't trade a correct reply for speed.
2. **P-B Greeting and the primary action (PJ3, PJ4).** The template's action becomes the first suggestion ("Request a callback") and a plain ask starts it. Declines use the audience's voice (a public or youth audience never hears "colleague or supervisor").
3. **O-A "Get it ready" path (OJ1, OJ2).** Reuse the go-live checklist as a step list on Overview: what it learned → safety → the list → try it → go live → share. Each step links to the exact place, shows done or not, and returns the owner to the path.
4. **O-B Safety at a glance and the helpline number (OJ3, OJ4).** One card: pack name in plain words, what it does, change it; helpline number as a phone field with a live preview of the crisis reply; crisis check status and re-run.
5. **O-C Go-live confirmation (OJ5).**
6. **P-C Cards that carry the person (PJ5).**
7. **P-D Calm chat page (PJ6, PJ7).**
8. **P-E Crisis follow-up and dead-end pages (PJ8, PJ9).**
9. **O-D One checkup score (OJ6).**
10. **O-E Replay after Change by chat (OJ7).**
11. **O-F** (start only after WhatsApp Stage A is merged: it adds delivery ticks to the Inbox) **Settings tabs and one home per setting (OJ8);** also hide internal sources in Build, make Copilot and Form show the same state, and fix the owner's "You don't have permission" toasts.

## Phase 4: Prove it

1. Re-run the full TF1 manual test script (the Claude Doc "Ally Agents: manual test script") on all five templates, automated where the specs cover it. Every finding in the report is closed or listed with a reason.
2. Before and after table for each Phase 2 target, with the numbers.
3. Event tracking for the funnel, using whatever analytics the app already has (find it; don't add a vendor): template chosen, each "Get it ready" step done, went live, first visitor message, action confirmed, reply latency, reply withdrawn or declined. Report what exists and what you added.
4. Prepare a moderated usability script for 5 owners from small NGOs and 5 people aged 18 to 25 (tasks, what to watch, what to ask). People run these sessions; Claude Code writes the script only.
5. Write `docs/agents-v2/CHUNK-UX1-NOTES.md`: what changed, the numbers, what's left.

## Rules

- `DESIGN.md` and `ONBOARDING-COPY.md` win. Don't invent owner or visitor text outside the copy deck.
- Reuse what exists before building anything new; say in each PR what was reused.
- No safety behaviour changes without a stop. Crisis replies stay fixed text.
- Keep each PR small enough to review in 15 minutes.
- If the bot page route should be `/b/<slug>` (as `DESIGN.md` says) rather than `/chat/<slug>`, raise it at the Phase 1 stop; don't change routes silently.
