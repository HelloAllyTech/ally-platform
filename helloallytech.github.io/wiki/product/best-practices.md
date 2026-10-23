---
title: Product Management Best Practices
tags: [product, best-practices, hub, ux, design, prioritisation, agents]
summary: DEPRECATED 2026-08-07, superseded by the Stacks MCP — kept for history. The former hub for Ally's product-management conventions — the house rules that apply to every product decision, plus a growing set of subsections (UI, Gamification, Data Visualisation, Prioritisation, User Personas, …).
last_reconciled: 2026-07-31
---

# Product Management Best Practices

> [!WARNING]
> **Deprecated — 2026-08-07. Superseded by the Stacks MCP.**
>
> Product guidance is no longer maintained in this wiki. It is retrieved from the external
> **Stacks** corpus at planning time: *before writing an implementation plan, run
> `/stacks:planning_context` with a description of the task, and incorporate relevant returned
> guidance, citing chunk titles.* See
> [Planning with the Stacks MCP](../contributing/planning-with-stacks.md).
>
> **Do not add new principles here** — new product judgement calls go into Stacks. Nothing on
> these pages is a gate any more, including the [Data Visualisation](data-visualisation.md)
> checklist, which was previously enforced as one.

**These pages are kept as history, not deleted.** Platform pages cite them by principle number
— [Analytics Agent](../platform/analytics-agent.md) alone references *Data Visualisation* 13 and
27–28 and *UI & Interaction* 4–5 — so the numbering has to stay stable for those citations to
resolve. Read them as a record of decisions this team made up to August 2026, and treat anything
that contradicts current Stacks guidance as superseded.

This section was the **product-side counterpart to the engineering docs**. The rest of this
wiki explains *how the system is built*; this section explained *how we decided what to build
and how it should behave for the people using it*.

---

## 1. Subsections

All subsections are **Deprecated** as of 2026-08-07 — superseded by Stacks. The table is kept so
the pages stay reachable and their inbound citations resolve.

| Subsection | Covers | Maturity |
|---|---|---|
| [UI & Interaction](ui.md) | Screen and component decisions, states, hierarchy, accessibility, i18n, cross-surface consistency | Deprecated → Stacks |
| [Gamification](gamification.md) | Badges, streaks, leaderboards, progress — and when *not* to gamify | Deprecated → Stacks |
| [Data Visualisation](data-visualisation.md) | Charts, dashboards, metrics displays, and the honesty rules for showing numbers | Deprecated → Stacks |
| [Prioritisation](prioritisation.md) | Deciding what gets built, in what order, and what gets explicitly dropped | Deprecated → Stacks |
| [User Personas](user-personas.md) | Who we build for — counsellor, learner, trainer/admin, super-admin — and what each one actually needs | Deprecated → Stacks |
| [AI-Product Patterns](ai-product-patterns.md) | Features where a model proposes and a person decides — disclosure, provenance, human-in-the-loop, recording the "no" | Deprecated → Stacks |

**Maturity** was one of `Draft` (written, not yet battle-tested), `Adopted` (the team follows
it), or `Deprecated` (kept for history; says what replaced it). Every page in this section is now
`Deprecated`; Data Visualisation was the one page that had reached `Adopted`.

### Reference pages

Longer craft references that sit *under* a subsection rather than beside it. A subsection is
the short, opinionated rule set you hold in your head; a reference page is the detailed
lookup you open while building. Each one must name its parent subsection.

| Reference | Parent subsection | What it is |
|---|---|---|
| [Chart & Dashboard Design Principles](chart-dashboard-principles.md) | Data Visualisation | A constraints file for building charts and dashboards: how people read a chart, required anatomy, clarity/simplicity/colour rules, the persuasion-vs-deception boundary, chart-type lookup tables, dashboard composition, an acceptance checklist and an anti-pattern list. |

---

## 2. House rules (apply to every subsection)

These hold regardless of which subsection you are in. A subsection may add rules; it should
not contradict these.

1. **Name the persona before the feature.** "Users want X" is not a requirement. Which of the
   [personas](user-personas.md) — and what were they doing 30 seconds before this screen? A
   counsellor mid-session and a trainer reviewing last week's cohort are different products.
2. **Start from the job, not the surface.** Decide what the person is trying to accomplish
   before deciding whether it's a tab, a drawer, a chart, or a notification.
3. **Write the empty, loading, error, and "too much data" states in the spec.** They are not
   polish — they are most of the real-world experience of any Ally screen backed by a live
   voice session, an LLM call, or an async queue. See [UI & Interaction](ui.md).
4. **Design for the slowest path you actually ship on.** Ally's product surfaces sit on top
   of real-time voice, LLM generation, and queue-driven pipelines
   ([Architecture](../platform/architecture.md)); latency and partial results are product
   problems, not just engineering ones.
5. **Multi-tenant by default.** Ally is multi-tenant with permission-gated features
   ([ally-be](../repos/ally-be.md)). Every product decision needs an answer to: which roles
   see this, which tenants get it, and what does the screen look like for someone who has the
   page but not the permission?
6. **Clinical-adjacent means restraint.** Ally supports mental-health counsellors and their
   training. Tone, celebration, scoring, and comparison all land differently here than in a
   consumer app — be deliberate, especially in [Gamification](gamification.md).
7. **Privacy is a product constraint, not just a compliance one.** HIPAA and PHI rules shape
   what can be shown, shared, exported, or put in a leaderboard. When in doubt, show less.
8. **Localisation is not a phase-two.** The product ships in multiple Indian languages
   (English, Hindi, Kannada, Marathi, Tamil at time of writing —
   [ally-mobile](../repos/ally-mobile.md)). Copy length, number/date formats, and
   right-sizing of labels are design inputs, not translation chores.
9. **Decide what you are *not* doing, in writing.** A scope without explicit non-goals gets
   re-litigated in review. See [Prioritisation](prioritisation.md).
10. **Instrument the decision.** If a feature ships without a way to tell whether it worked,
    the next prioritisation conversation about it will be pure opinion.
11. ~~**File it back.**~~ *Superseded.* Product judgement calls no longer come back here — they
    go into the Stacks corpus. See
    [Planning with the Stacks MCP](../contributing/planning-with-stacks.md).

---

## 3. How to add or update a subsection

> [!WARNING]
> **Closed.** This section takes no new subsections and no new principles. Product judgement
> calls now go into the Stacks corpus — see
> [Planning with the Stacks MCP](../contributing/planning-with-stacks.md). The process below is
> retained only to document how these pages were built.

Follow the standard wiki [Ingestion Flow](../getting-started.md) plus these specifics:

1. **Create** `wiki/product/<kebab-case-topic>.md` with the frontmatter block
   (`title`, `tags` including `product`, `summary`).
2. **Structure it** like the existing pages so they stay scannable and diffable:
   - *Why this matters for Ally* — one short paragraph, no filler.
   - *Principles* — numbered, each one a decision rule you could actually apply.
   - *Checklist* — what to verify before calling the work done.
   - *Anti-patterns* — the mistakes we have actually made or nearly made.
   - *Ally-specific notes* — links into the platform/repo pages.
   - *Open questions* — what is unresolved, so the next session picks it up instead of
     re-deriving it.
3. **Register it** in the **Subsections** table above — or, if it is a long craft reference
   rather than a peer subsection, in the **Reference pages** table with its parent named —
   **and** under **Product Management** in [`wiki/index.md`](../index.md).
4. **Log it** in [`wiki/log.md`](../log.md) using `## [YYYY-MM-DD] action | Description`.
5. **Cross-link it** from at least one engineering page it touches, so the practice is
   reachable from the code side (e.g. a UI convention should be linked from
   [ally-web](../repos/ally-web.md)).
6. **Apply the public-content policy** — no secrets, credentials, customer names, real user
   quotes with identifying detail, PHI, internal hostnames, or unreleased commercial terms.

Keep pages **opinionated and short**. A practice nobody can hold in their head is a practice
nobody applies.

---

## 4. Backlog of subsections

**Abandoned** — these were never written here and will not be. They are left as a record of the
topics the team had identified as gaps; each is worth checking against Stacks when the question
next comes up.

- Onboarding & first-run experience
- Notifications, nudges & interruption budget
- Copy, tone of voice & terminology (incl. clinical language)
- Accessibility (deepening the [UI](ui.md) section into its own page)
- Pricing, packaging & tenant tiering
- Experimentation & A/B testing (what is even testable at our traffic)
- Feedback loops: support tickets, session reviews, trainer interviews
- Release comms & change management for existing tenants
- Sunsetting and deprecating features

---

*See also: [Cross-Repo Agent Guide](../platform/agent-guide.md) ·
[Platform Overview](../platform/overview.md) ·
[Contributing Guide](../contributing/guide.md)*
