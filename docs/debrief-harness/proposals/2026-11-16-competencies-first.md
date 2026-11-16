# Proposal: competencies first, foundational skills loosely (2026-11-16)

Status: **ships with this release** (owner decision 2026-11-16: too few users for the PM agent's
ladder). The "after" text below is now the default in Git: `ally-be/src/prompts/debrief/analyst_system.txt`,
`ally-be/src/prompts/debrief/writer_system.txt` and `DEFAULT_ANALYST_SYSTEM` / `DEFAULT_WRITER_SYSTEM` in
`ally-ai/app/core/debrief/steps.py`. This file stays as the before/after record.

**A default in Git does not change what prod runs.** Prod runs whatever the GA debrief release names
for each prompt code (`bundle.prompts`; `null` means the Skills Store's current version), and the
prompt sync on deploy never changes an existing prompt's live version. To make prod use this text:

1. Deploy the code first (ally-ai, then ally-be), so the `<roleplay_expectations>` block exists
   before any text refers to it.
2. A person pushes each text as a new Skills Store version (`node scripts/prompts/prompts.mjs pull
   <code>`, apply the change below to the live text, then `push <code> --remote prod --note "..."`),
   or uses **Save as new version** in the Skills Store. That makes a draft.
3. A person **publishes** each draft in the Skills Store. The publish creates a debrief release that
   pins the new version (`DebriefReleasesService.fromPublish`). It goes live at once, unless it would
   undo a promoted PM-agent or person-proposed change to that prompt; in that case it stays a draft
   to promote under Debrief > Releases.

`make sync-prompts` is not the route: it pushes ally-ai's own prompts, and like every sync it never
changes a live version. A fresh store (a new environment or a local clone) seeds version 1 from the
Git defaults, so it starts on this text.

## Why

Agreed by the product owner after a review with a clinical lead. A debrief should lead with what
**this roleplay** asked of the counsellor: its own helpful and unhelpful behaviours and its
competencies. The 14 foundational helping skills should come in only when one clearly shaped the
session, not as a checklist run on every roleplay.

What is already in code (commit "the Analyst reads what the roleplay expects"): the Analyst is sent
`helpful_behaviours`, `unhelpful_behaviours` and named `competencies` in a `<roleplay_expectations>`
block, with a code-owned ROLEPLAY EXPECTATIONS line telling it how to read them. With neither
behaviours nor competencies, nothing changes. That line says how to assess the roleplay's
expectations. It does not change how much weight the foundational skills get. That is this proposal.

The "before" passages are the repo defaults (`ally-be/src/prompts/debrief/*.txt`, mirrored in
`ally-ai/app/core/debrief/steps.py`). Before drafting the version, diff them against the live text
in the Skills Store (`prompts` CLI pull). If the live text differs, apply the same change to it.

No prompt variable changes, so the contract stays as it is and the text can ship in any order with
the code.

## `debrief_analyst_system`

### Before

> - behaviours: for each expected behaviour or competency listed, and any of the foundational
>   helping skills that clearly mattered (Verbal communication; Explain and promote
>   confidentiality; Rapport-building and self-disclosure; Exploration and normalisation of
>   feelings; Empathy, warmth and genuineness; Assessment of harm and developing a response plan;
>   Connect to social functioning and impact on life; Explore the client's explanation for the
>   problem; Involvement of family and significant others; Collaborative goal-setting; Promote
>   realistic hope for change; Incorporate coping mechanisms and prior solutions; Psychoeducation
>   with local terminology; Elicitation of feedback), named exactly as written here: was there an
>   opportunity, was it observed, partial or missed, how confident you are, how important it was
>   in THIS session (3 = most), and the counsellor turn and exact words that show it. Quote
>   exactly as written; never invent or translate a quote.

### After

> - behaviours: first, what THIS roleplay expects: each of its helpful and unhelpful behaviours
>   and each competency listed, assessed through its behaviours and named by the competency's name,
>   or by the behaviour itself when it belongs to no named competency. These come first and carry
>   the debrief. Add a foundational helping skill (Verbal communication; Explain and promote
>   confidentiality; Rapport-building and self-disclosure; Exploration and normalisation of
>   feelings; Empathy, warmth and genuineness; Assessment of harm and developing a response plan;
>   Connect to social functioning and impact on life; Explore the client's explanation for the
>   problem; Involvement of family and significant others; Collaborative goal-setting; Promote
>   realistic hope for change; Incorporate coping mechanisms and prior solutions; Psychoeducation
>   with local terminology; Elicitation of feedback), named exactly as written here, only when it
>   clearly shaped this session and the roleplay's own expectations do not already cover it. When
>   the roleplay lists no behaviours and no competencies, use the foundational skills that
>   mattered. For each item: was there an opportunity, was it observed, partial or missed, how
>   confident you are, how important it was in THIS session (3 = most), and the counsellor turn
>   and exact words that show it. Quote exactly as written; never invent or translate a quote.

The rest of the prompt is unchanged.

## `debrief_writer_system`

### Before

> - what_worked: 1 to 3 strengths, the most important first.
> - work_on_this: 1 to 3 points, the most important first. A missed clear risk cue always comes
>   first. Each says why it mattered and gives one concrete line the trainee could try saying next
>   time.
> - practise_next: the one skill to practise next and why.
> - skill_words: for each skill in the evidence map, strength, keep_practising or didnt_come_up.

### After

> - what_worked: 1 to 3 strengths, the most important first. Prefer what this roleplay asked
>   for: its competencies and behaviours in the evidence map. Use a foundational skill only when
>   it clearly shaped the session.
> - work_on_this: 1 to 3 points, the most important first. A missed clear risk cue always comes
>   first. After that, prefer a behaviour this roleplay expected that the trainee missed or only
>   partly did when they had the chance. Each says why it mattered and gives one concrete line the
>   trainee could try saying next time.
> - practise_next: the one skill to practise next and why, preferring one of this roleplay's
>   competencies or behaviours.
> - skill_words: for each skill in the evidence map, strength, keep_practising or didnt_come_up.

The rest of the prompt is unchanged. Two things are already code-owned and need no prompt text:
a course session's "Practise this again" with `try_next`, and the rule that a custom competency code
is never written.

## How to test (PM agent ladder)

- Fixtures: roleplays with SHOULD_DO / SHOULD_NOT_DO behaviours, a named competency with no
  behaviours (e.g. QPR), a custom competency, and one roleplay with none of these.
- Expected: evidence-map skills are mostly the roleplay's competencies or behaviours. A
  foundational skill appears only with a clear moment behind it. The roleplay with none still gets
  foundational skills. No `custom_code` check failures. Judge scores hold (no regression on
  accuracy or actionability).
- Clinical sign-off before release, as for any Debrief prompt change.
