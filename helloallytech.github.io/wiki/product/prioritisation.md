---
title: Prioritisation
tags: [product, best-practices, prioritisation, roadmap, scope, tradeoffs]
summary: DEPRECATED 2026-08-07, superseded by the Stacks MCP — kept for history. How Ally decides what to build next — problem before solution, explicit non-goals, thin vertical slices, and honest treatment of the maintenance and platform work that never wins a scoring model.
last_reconciled: 2026-07-28
---

# Prioritisation

*Part of [Product Management Best Practices](best-practices.md).* **Maturity: Deprecated (2026-08-07) — was Draft.**

> [!WARNING]
> **Deprecated — superseded by the Stacks MCP.** Product guidance is now retrieved from the
> external Stacks corpus at planning time; see
> [Planning with the Stacks MCP](../contributing/planning-with-stacks.md). This page is kept for
> history and because other pages cite its principles by number — do not add new principles here,
> and treat anything that conflicts with current Stacks guidance as superseded.

## Why this matters for Ally

Ally is a small team running a seven-repo platform with real-time voice, multiple AI services,
web, mobile, and multi-tenant customers. Almost every idea is *good*; the constraint is
sequence. Most prioritisation damage here comes from three things: taking a solution as the
requirement, starting more than we finish, and repeatedly deferring the platform work that
makes everything else slow.

## Principles

1. **Prioritise problems, not features.** A request arrives as a solution ("add a filter");
   record the problem behind it ("trainers can't find last week's failed sessions"). Ranking
   solutions guarantees you ship the wrong one occasionally; ranking problems doesn't.
2. **Every item names a [persona](user-personas.md) and a frequency.** "Trainers, weekly" and
   "super-admins, twice a year" are not the same item even if the effort is identical.
3. **Score in the open, decide with judgement.** A simple frame — reach × impact ×
   confidence ÷ effort, or a plain value-vs-effort 2×2 — is a *conversation tool*. The number
   is not the decision; it exposes the disagreement so it can be argued explicitly.
4. **Confidence is a first-class input.** Low-confidence, high-cost items don't get built;
   they get a cheap experiment or a customer conversation first.
5. **Cost is the whole cost.** Cross-repo features (a change touching backend + AI service +
   web + mobile) cost far more than their biggest single part. So does anything that adds a
   migration, a queue, a permission, or a new user-facing string in five languages.
6. **Thin vertical slices beat phased horizontals.** Ship the narrowest end-to-end path a real
   user can complete, then widen. A backend-only "phase 1" delivers nothing learnable.
7. **Non-goals are part of the spec.** Write what this explicitly does *not* do. Unwritten
   non-goals get rebuilt as scope creep in review.
8. **Reserve capacity for the unglamorous.** Reliability, latency, tech debt, security and
   upgrade work never win a scoring model against a shiny feature — so they get a standing
   allocation, not a fight per sprint.
9. **Limit work in progress.** Two finished things beat five in-flight things, especially
   across repos where a half-migrated interface blocks everyone.
10. **Loud ≠ important.** One escalating customer is a data point, not a roadmap. Weigh it
    against silent users who churn without filing a ticket.
11. **Date-driven items must say what gets cut.** If a date is fixed, scope is the variable —
    name what falls out before the deadline forces the choice badly.
12. **Write down why you said no.** Rejected items with a reason stop being re-proposed every
    quarter; rejected items without one come back forever.

## Checklist

- [ ] Stated as a problem, with the persona and how often they hit it.
- [ ] Success metric named — and it's measurable with what we ship.
- [ ] Non-goals written down.
- [ ] Effort estimated across *all* affected repos, incl. migration, permissions, i18n, mobile.
- [ ] Confidence level stated; if low, the next step is an experiment, not a build.
- [ ] Sliced into something shippable end-to-end.
- [ ] Dependencies and blocking teams identified.
- [ ] The "no" list updated with reasons for what got dropped.

## Anti-patterns

- **Solution-shaped backlog** where nobody remembers the original problem.
- **Scoring theatre** — a spreadsheet with invented numbers used to avoid an argument.
- **Effort estimated by the loudest repo** while the cross-repo integration cost goes unnamed.
- **Everything is P0.** A priority scheme with no bottom tier isn't one.
- **Perma-deferred platform work** until velocity quietly halves.
- **Roadmap as a promise ledger** — dates committed to customers for unstarted, unscoped work.
- **Silent scope creep** in review because non-goals were never written.

## Ally-specific notes

- Cross-repo work is the dominant hidden cost: see the [Cross-Repo Agent
  Guide](../platform/agent-guide.md) for what a change typically has to touch (backend module
  + DTOs, AI service prompts, RTK Query endpoints on web *and* mobile, migrations,
  permissions).
- Anything user-visible also implies localisation across the shipped languages and, usually, a
  mobile counterpart — budget for both or declare them non-goals.
- Multi-tenancy means "just for this customer" is rarely just for this customer: decide up
  front whether a request becomes a per-tenant toggle, a permission, or a product-wide change.
- Delivery mechanics (branching, PR process, release flow) are in the
  [Contributing Guide](../contributing/guide.md) — this page is about choosing, not shipping.

## Open questions

- What standing percentage of capacity is reserved for reliability and debt?
- Do we have a single backlog across repos, or per-repo backlogs with no shared ranking?
- Who is the tiebreaker when trainer-facing and learner-facing needs conflict?
