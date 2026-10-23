---
title: User Personas
tags: [product, best-practices, personas, users, research, roles]
summary: DEPRECATED 2026-08-07, superseded by the Stacks MCP — kept for history. Who Ally is built for — counsellor, learner, trainer/admin, tenant admin, super-admin — as working sketches tied to real permission roles, plus the rules for keeping personas honest.
last_reconciled: 2026-07-28
---

# User Personas

*Part of [Product Management Best Practices](best-practices.md).* **Maturity: Deprecated (2026-08-07) — was Draft.**

> [!WARNING]
> **Deprecated — superseded by the Stacks MCP.** Product guidance is now retrieved from the
> external Stacks corpus at planning time; see
> [Planning with the Stacks MCP](../contributing/planning-with-stacks.md). This page is kept for
> history and because other pages cite its principles by number — do not add new principles here,
> and treat anything that conflicts with current Stacks guidance as superseded.

> [!NOTE]
> These are **working sketches derived from the product's roles and workflows**, not
> research-validated personas. They are useful for keeping design conversations concrete and
> for the hub rule *"name the persona before the feature"*. They should be corrected against
> real interviews and usage data — see **Open questions** at the foot of this page.

## Why this matters for Ally

Ally serves several genuinely different people through one platform, and their needs conflict.
The learner wants safe, low-stakes practice; the trainer wants comparable evidence of
progress; the counsellor in a live session wants near-zero cognitive load; the tenant admin
wants control and reporting. A feature that is obviously right for one is often wrong for
another — which is why "users" is a banned word in an Ally spec.

Personas also map to **real permission roles** in [ally-be](../repos/ally-be.md), so naming
the persona immediately answers the gating question from the
[house rules](best-practices.md).

## The personas

### 1. The Counsellor (in the work)
- **Roughly maps to:** counsellor-permission users on the helpline dashboard and mobile app.
- **Context:** on a live or just-finished session with a real person in distress. Time-poor,
  emotionally loaded, often on a phone.
- **Wants:** to not be interrupted; help that arrives without being asked for; notes and
  documentation that take seconds, not minutes.
- **Fears:** missing something clinically important; the tool adding to the load; anything
  that makes them look away from the person.
- **Design implications:** glanceable, interruption-budgeted, forgiving of poor connectivity;
  never a modal mid-session; assistance is suggestive, never directive.

### 2. The Learner (in training)
- **Roughly maps to:** learner-permission users running simulations.
- **Context:** practising a scripted or AI-driven roleplay with a simulated client, often
  before or between real shifts; may be new to counselling entirely.
- **Wants:** realistic practice, clear feedback on what to do differently, and a sense of
  getting better.
- **Fears:** being judged, being ranked publicly, discovering they're bad at this in front of
  peers.
- **Design implications:** private-by-default performance data, improvement framing over
  ranking, humane failure states — see [Gamification](gamification.md).

### 3. The Trainer / Supervisor (admin dashboard)
- **Context:** responsible for a cohort. Builds or configures scenarios, reviews sessions,
  decides who is ready.
- **Wants:** comparable evidence across learners and time; fast drill-down from "something's
  off" to the exact moment in a session; authoring tools that don't require an engineer.
- **Fears:** making a readiness call on a bad number; spending the week doing manual review.
- **Design implications:** dense desktop layouts, drill-down over summary-only,
  sample-size-honest charts ([Data Visualisation](data-visualisation.md)), and authoring
  surfaces with real preview/test loops.

### 4. The Tenant Admin (the customer's owner)
- **Roughly maps to:** tenant-scoped admin roles.
- **Context:** owns the relationship with Ally on the customer side — users, permissions,
  configuration, and reporting upward to their own leadership.
- **Wants:** control over what their organisation's users can do and see; roll-out without
  surprises; exportable reporting.
- **Fears:** a change appearing for their users that they didn't approve; data leaving their
  boundary.
- **Design implications:** per-tenant toggles rather than global flips, change communication
  before behaviour changes, exports that carry their context.

### 5. The Ally Super-Admin (internal)
- **Roughly maps to:** the internal super-admin tiers.
- **Context:** the Ally team operating the platform across tenants — configuration, prompts,
  evaluation, support and debugging.
- **Wants:** power and visibility; ability to reproduce and diagnose a specific session.
- **Design implications:** internal tools optimise for capability and speed over polish, but
  still need destructive-action safety and an audit trail. Internal-only surfaces are still
  bound by tenant isolation and PHI rules — see [AI Lab](../platform/ai-lab.md) for an example
  of an internal workbench done as a first-class surface.

### 6. The Simulated Client (not a user — a designed character)
The AI persona a learner practises against is an *artefact we design*, not a user of the
product, but it deserves the same rigour: its behaviour, difficulty, language and emotional
register are product decisions with real training consequences. Its construction lives in
[ally-ai-learn](../repos/ally-ai-learn.md); the quality bar for how it speaks is in
[Language-Quality Evaluation & RCA](../platform/language-quality-eval.md).

## Principles

1. **Name the persona in the spec's first paragraph.** No "users".
2. **A role is not a persona, but it constrains one.** Check what the permission set actually
   allows before designing for the person — and remember one human can hold several roles
   (counsellor *and* learner is common), so never gate on a single role string.
3. **Design for the conflict, not the average.** When two personas want opposite things, say
   which one wins for this feature and why. Averaging them serves neither.
4. **Personas expire.** A sketch that has never been checked against a real conversation is a
   hypothesis. Date them and correct them.
5. **Keep them anonymous.** Personas are composites. No customer names, no real quotes with
   identifying detail, nothing PHI-adjacent — this wiki is public.
6. **Language and locale belong in the persona.** A Kannada-speaking learner on a low-end
   Android device is a different design target from an English-speaking trainer on a desktop.

## Checklist

- [ ] The spec names one primary persona (and any secondary ones).
- [ ] Their role/permission reality checked, including multi-role users.
- [ ] Conflicts with other personas surfaced and resolved explicitly.
- [ ] Device, connectivity and language assumptions stated.
- [ ] Any claim about what they want is either sourced or labelled as an assumption.

## Anti-patterns

- **"Users want…"** — which of the five?
- **Persona = role name**, with no context, motivation or fear attached.
- **The persona nobody has met**, invented to justify a feature already decided on.
- **Designing for the super-admin** because that's whose account we all test with.
- **Personas written once and never revisited** as the product and customer base change.

## Open questions

- When did we last interview a working counsellor and a first-week learner, and where are
  those notes?
- Do we have usage data per role to check these sketches against?
- Is "trainer" genuinely distinct from "tenant admin" at our current customers, or are they
  usually the same person?
