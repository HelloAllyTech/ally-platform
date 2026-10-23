---
title: AI-Product Patterns
tags: [product, best-practices, ai, llm, human-in-the-loop, disclosure, provenance]
summary: DEPRECATED 2026-08-07, superseded by the Stacks MCP — kept for history. How Ally builds features where a model proposes and a person decides — disclosure, provenance, human-in-the-loop review, recording the "no", and never letting an unvalidated model answer become stored data.
last_reconciled: 2026-07-31
---

# AI-Product Patterns

*Part of [Product Management Best Practices](best-practices.md).* **Maturity: Deprecated (2026-08-07) — was Draft.**

> [!WARNING]
> **Deprecated — superseded by the Stacks MCP.** Product guidance is now retrieved from the
> external Stacks corpus at planning time; see
> [Planning with the Stacks MCP](../contributing/planning-with-stacks.md). This page is kept for
> history and because other pages cite its principles by number — do not add new principles here,
> and treat anything that conflicts with current Stacks guidance as superseded.

## Why this matters for Ally

A growing share of what Ally shows people was written by a model: session summaries, drift
verdicts, scribe notes, roadmap critiques, and now product suggestions drawn from the
platform's own analytics. Each of those is a *claim*, and the product's job is to keep the
claim checkable and the decision human. The failure mode is not a model that is wrong — that
is expected — it is a surface that presents a guess with the same confidence as a measurement,
or writes one into a table nobody can trace back.

This page covers features where **a model proposes and a person decides**. It does not cover
the live roleplay actor, whose whole point is to be in character.

## Principles

1. **A model output is a proposal until a person accepts it.** Anything a model produces that
   will become a durable record — a roadmap item, a taxonomy value, a published note — passes
   through a human decision first. The reviewer's edited version is what gets stored, not the
   draft. This is the difference between a suggestion engine and an unattended writer.
2. **Pin the provenance on the artefact, not the run.** Every AI-derived card, score or note
   states what it was derived from (the data window, the source set) and which model wrote it,
   stored per row rather than recomputed. A suggestion read a month later without its window is
   unfalsifiable, and models change under you.
3. **Never let an unvalidated model answer become stored taxonomy.** When a model classifies
   into an existing set — a product goal, a competency, a tag — check its answer against the
   live set and discard a miss to `null`. Do not coerce to a nearest match and do not fall back
   to a default. Ally has the scar: a backfill whose classifier fell back to a default category
   wrote that category to 241 rows and reported success, and roughly half the roadmap's goal
   data has been meaningless since.
4. **"Nothing to propose" is a first-class answer.** If the evidence supports three
   suggestions, return three; if none, return none. Never pad a list to a target count, and give
   the empty result its own copy so it does not read as a failure. A padded list costs the reader
   more than a short one, and it teaches them to stop trusting the top of the list.
5. **Distinguish "the model had nothing" from "the run broke."** These need different copy and
   different handling. An empty successful result is a finding; a failed run must say so and
   store nothing, so a broken pipeline can never be read as a healthy product with no ideas.
6. **Say what the model could not see.** When the input is assembled from several sources and
   one is unavailable or was truncated, name it on the surface. Absence has to be visible, or a
   reader will read a partial answer as a complete one — and the model, told to reason only from
   what it was given, cannot flag the gap itself.
7. **Record the rejection, with a reason, and feed it back.** A "no" that is only a UI action
   gets re-proposed on the next run. Capture the reason (optional, but say why it matters in the
   helper text), store it, and put it in the next prompt as a standing decision. This is
   [Prioritisation](prioritisation.md) principle 12 applied to a generator that never gets tired.
8. **Latency is part of the design, not an implementation detail.** A model call that reads a
   lot before it writes takes real seconds. Give it a bounded progress narrative that changes as
   it goes, and disable the trigger while it runs — a reader who cannot tell *working* from
   *stuck* starts a second run. See [UI & Interaction](ui.md) principle 3.
9. **Thin evidence gets stated or suppressed.** A model given a small sample will still write a
   confident paragraph. Tell it the sample floors, and hold its output to the same
   [Data Visualisation](data-visualisation.md) rules the charts obey — a claim resting on a
   handful of sessions says so or does not ship.
10. **Keep the prompt editable, and keep the data out of it.** Prompts live as files synced to
    the database so a non-engineer can revise the wording; the payload travels as a separate
    message. An admin improving a prompt must not be able to delete an interpolation slot and
    silently break the feature.
11. **AI assists degrade silently; AI decisions do not.** A best-effort helper (duplicate
    detection, a wording critique) returns empty and stays out of the way when its service is
    down — it must never block the human action it was meant to support. A feature whose whole
    output is the model's answer reports its failure instead.
12. **Meter every call.** An un-metered LLM call is a billing blind spot. Record provider,
    model, tokens and a feature label so cost per feature is answerable later, and make the
    metering fire-and-forget so it can never fail the user's request.

## Checklist

- [ ] Every durable record from a model passes a human review step, and the stored value is the reviewed one.
- [ ] Each AI-derived artefact shows its data window (or source set) and model, stored with the row.
- [ ] Classifications are validated against the live set; a miss stores `null`, never a default.
- [ ] Zero results are possible, designed, and worded as a finding.
- [ ] Failed runs are distinguishable from empty ones, and store nothing.
- [ ] Unavailable or truncated inputs are named on the surface.
- [ ] Rejections are stored with an optional reason and fed into later runs.
- [ ] Loading, slow (> ~3 s), empty, error and thin-evidence states are all designed.
- [ ] Sample floors are in the prompt and honoured in the output.
- [ ] The prompt is a synced file with no required placeholders; the payload is a separate message.
- [ ] Assists degrade to empty; decision features surface their failure.
- [ ] The call is recorded in `llm_usage` with a feature label.

## Anti-patterns

- **The confident guess.** An AI-written figure or claim rendered exactly like a measured one,
  with no window, no model, and no way to check it.
- **Auto-filing.** A model proposal that lands directly in a shared backlog, board or note
  without a person having read it. It is the same defect whether the model is good or bad: the
  record has no owner.
- **Padding to the round number.** Ten suggestions because the field said ten. The tail is
  filler and the reader learns to skim the whole list.
- **Silent truncation.** Cutting a series or dropping a section from the model's input without
  saying so. The output reads as complete and cannot be corrected by a reader who cannot see
  the gap.
- **Fallback taxonomy.** "If the classifier fails, use the catch-all" — the exact shape of the
  roadmap goal-data loss above.
- **The unbounded spinner.** A long model call behind a spinner with no ceiling and no
  explanation, so the reader reloads and doubles the work.
- **Reject-as-delete.** Dismissing a proposal with no record, so the generator re-proposes it
  every run and the reviewer re-decides it every run.
- **Prompt-as-code.** A prompt buried in a constant that only an engineer can revise, or one
  whose required `{{placeholders}}` make it unsafe for anyone else to edit.

## Ally-specific notes

- **Analytics → Suggestions** (`ally-be/src/analytics-suggestions`, admin
  `pages/Analytics/tabs/suggestions/`) is the reference implementation of this page: a
  super-duper-admin picks a window, the platform's own analytics services are read through the
  same code the dashboard uses, and the model returns at most ten suggestions. Accept opens a
  prefilled, editable form and files a normal roadmap opportunity; reject asks for an optional
  reason that later runs are told to respect. Batches accumulate, and each card carries its
  window and model.
- **Prompt storage** — `ally-be/src/prompts/<subdir>/<name>.txt`, synced at boot and overridable
  from Prompt Management. See [ally-be](../repos/ally-be.md).
- **Validated classification** — `RoadmapAiService.classifyGoal` is the pattern for principle 3,
  and its docblock records the incident behind it.
- **Metering** — `LlmUsageService` plus the `LlmTask` enum, which is a cross-repo contract with
  the Python services; the AI-cost tab reads it.
- **Where the elevated gate belongs** — a feature that reads the whole platform *and* writes
  into another team's backlog is a different privilege from reading a chart. Both the Analytics
  Agent and Suggestions tabs are super-duper-admin only, and hidden rather than disabled, per
  [UI & Interaction](ui.md) principle 5.

## Open questions

- **Do accepted items need a visible AI provenance marker on the destination surface?** Today an
  accepted suggestion becomes an ordinary roadmap opportunity with no marker — deliberately, so
  it competes on merit, and the suggestion row keeps the link. If we later want "how much of the
  roadmap came from Suggestions?" that needs a field on the destination.
- **Should a rejection ever expire?** A reason recorded against last quarter's data may be wrong
  once the data moves. Currently rejections are permanent and the prompt allows one explicit
  "new data contradicts this past rejection" suggestion. Unclear whether that is enough.
- **Is there a point at which a synchronous model call should become a job?** Suggestions runs
  in about 40 seconds locally and is bounded at two minutes. The escalation path is a queued run
  with a progress feed; the trigger for taking it has not been set.
- **How should we show model disagreement?** Nothing here runs the same question twice. If a
  future feature does, the surface needs a way to show a split verdict rather than picking one.
