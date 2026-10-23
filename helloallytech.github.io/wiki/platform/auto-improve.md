---
title: Auto-improve — Rubric-Judged Testing for System Skills
tags: [platform, auto-improve, skills, prompts, evaluation, llm-judge, admin, experiments]
summary: How System Skills' Auto-improve works — which skills can run it, the loop (designer drafts a challenger, the router splits live traffic, an LLM judge scores against an admin's rubric), what the target means, why a loop pauses, what Apply does, and the limits to know before trusting a winner.
last_reconciled: 2026-10-21
---

# Auto-improve

**Auto-improve** takes one System Skill — a prompt an admin can edit — and keeps trying to
make its outputs better, on real traffic, against a rubric an admin wrote. An AI *designer*
drafts a revised version of the skill's text; a share of live calls runs the draft; an AI
*judge* scores every output; the better text wins and the loop drafts again. It stops when
the best version reaches the admin's target, then waits for a person to apply it.

It is **off for every skill until an admin turns it on**, and it can only run on skills
whose call site reports what it produced. This page is the conceptual overview. The
mechanics and the recipe for connecting a skill live with the code in
[ally-be](../repos/ally-be.md) (`ally-be/docs/skill-experiments.md`, module
`ally-be/src/skill-experiment/`); the admin screen is in [ally-web](../repos/ally-web.md)
(`ally-web/apps/ally-admin-dashboard/src/pages/PromptManagement/experiments/`). The code is
the source of truth.

---

## What it is for

Prompt edits in System Skills are judged by eye on a handful of examples. Auto-improve
replaces that with a measurement: the same rubric applied to every output the skill
produces in production, compared between the current text and a candidate with a
significance test. It does not write skills from scratch and it does not decide what "good"
means — the rubric does, and an admin owns the rubric.

---

## Connected skills

A skill is **connected** when its call site asks the router which text to run and hands the
result back to be recorded. Every other skill shows as not connected in the admin, rather
than a switch that would collect nothing. Today the connected skills are the open-ended
quiz grader in Tracks (runs in ally-be) and the two roleplay debrief prompts (run in
[ally-ai](../repos/ally-ai.md); one with the learner's previous-session memory, one without).

Connecting another skill is a few lines at its call site plus an entry in a constants
file, described in `ally-be/docs/skill-experiments.md`. Skills in the live voice agent
([ally-ai-learn](../repos/ally-ai-learn.md)) are not connectable yet: their text ships once
per session in the room metadata, and their "output" is a whole conversation.

---

## The loop

```
off ──turn on──▶ baseline ──enough outputs judged──▶ testing ──target reached / budget spent──▶ paused
                                                      ▲   │                                       │
                                                      └───┘ challenger wins or loses → next draft │
                                                                                   resume ◀───────┘
```

| Part | What it does |
|---|---|
| **Router** | On each call of a connected skill, decides which text runs. It is the only part on the request path, and it is built to be invisible when anything goes wrong: on any error the skill simply runs its own text. |
| **Judge** | An LLM scores each recorded output 1–5 on every rubric criterion. It is **blind**: it sees the rubric, the input, the output and the skill's *original* instructions, never which version produced the output and never the version's text. |
| **Designer** | An LLM drafts the next challenger from the current best text, the criteria it scores worst on, its lowest-scoring real examples with the judge's reasons, and a history of earlier attempts so it does not repeat them. |
| **Engine** | A background loop on the shared five-minute scheduler. Each pass judges a bounded batch of waiting outputs, recomputes each version's stats, and advances the state. |

The judge and the designer are themselves System Skills, editable in the admin like any
other, and both are rows in the AI task registry, with their usage metered per experiment.

### Baseline

The skill's current text is snapshotted as the run's **Original** and serves all traffic
while its outputs are judged. Once enough are judged, the run learns the **output shape**
from them (JSON with a fixed set of keys, or plain text). If the original already meets the
target, the loop pauses with nothing to improve; otherwise the designer drafts the first
challenger.

### Testing

The **champion** (the best version so far, initially the original) serves most calls and
one **challenger** serves the rest. When both have enough judged outputs:

- the challenger **wins** if it leads by at least the minimum improvement *and* the lead is
  statistically significant (a one-sided test at 95%) — both, because a significant
  half-point gain is not worth replacing a prompt for, and a large gain on noise is not a
  gain;
- it **loses** if it is significantly worse, or has had twice the minimum sample without
  winning;
- it is **retired early** if at least three of its outputs, and more than a fifth of its
  sample, broke the expected format or failed outright, or it trails the champion by 15 or
  more points after a third of the minimum sample.

A winner becomes the champion and the loser is retired. Either way the designer drafts the
next challenger from the current champion. One challenger runs at a time.

### What "target" means

The **target** is a score from 0 to 100 that the champion's average judged score must
reach for the loop to stop. A criterion's 1–5 score maps linearly onto 0–100 (1 is 0, 5 is
100) and criteria are averaged by weight, so the default target of 85 is an average of
roughly 4.4 out of 5 across the weighted rubric.

It is checked at two moments: when the baseline completes, and each time a challenger is
crowned. Reaching it means *the judge scores this version that high against this rubric* —
not that the output is proven good for learners.

### Why a loop pauses

When a loop pauses, **the champion serves all traffic** and nothing more is recorded, until
an admin acts. The admin sees the reason first:

| Pause reason | Meaning |
|---|---|
| Target reached | The champion's average reached the target. |
| Baseline meets target | The original already met the target; nothing to improve. |
| Variant budget spent | The run drafted as many challengers as it was allowed. |
| No progress | Too many challengers in a row failed to beat the champion. |
| Designer failed | The designer could not produce a draft that kept the runtime placeholders intact, several rounds running. |

---

## What an admin does

The screen is **System Skills → Auto-improve**: every connected skill with its status, best
version and score, target and last activity, paused skills first because they are waiting on
a person. Opening one shows the status in a sentence, the rubric, the settings, the locked
placeholders, each version with *what changed* and *why it should score higher*, the judged
outputs behind its score, a timeline, and the spend on judge and designer calls.

- **Rubric.** One or more criteria, each with a description of what a 5 looks like and a
  weight. The judge uses the *saved* rubric, so it must be saved before turning the loop on.
- **Settings.** Target score, outputs judged per version, challenger traffic share, variant
  budget per run, losses in a row before pausing, minimum improvement, and optionally a
  pinned judge and designer model. Defaults at the time of writing: target 85, 30 outputs per
  version, 30% challenger traffic, a budget of 8 variants, 3 losses in a row, 2 points. The
  form and the API enforce bounds on all of them.
- **Turn on / Turn off.** Turning on starts a baseline. Turning off sends every call back to
  the skill's own text at once; versions and scores stay for reference, and turning on again
  starts a new run.
- **Resume.** Continues a paused loop from its current best, with a fresh variant budget.
- **Apply.** Writes the champion's text to the skill as a **new System Skills version**
  (the previous text stays in the version history) and turns the experiment off. It needs
  both the experiment-edit and prompt-edit permissions, and is unavailable while the
  original is still the best version.

Two rules keep the admin in control. **An admin's edit wins:** if the skill's text changes
in System Skills while a run is live, the next pass restarts the run from the new text (the
skill's side panel warns about this). And **the rubric and judge are fixed for a run**,
because scores from a different rubric or judge are not comparable.

---

## Guardrails

- **The runtime contract is locked.** Every placeholder the code fills in when the skill
  runs must survive in a draft exactly as written, and no new one may appear. A draft that
  drops, renames or adds one is retried with the errors fed back, then stored as rejected
  and **never served**. Drafts must also differ from the current best and stay within a
  sensible length of it.
- **The output shape is locked.** If nearly all of the original's outputs were JSON objects,
  a challenger's output must be a JSON object with every key they shared. One that is not,
  or a call that failed outright, scores 0 without a judge call.
- **A failing challenger never costs a user their result.** The connected call sites retry
  once on the skill's own text if the challenger's call throws; the failure still counts
  against the challenger.
- **Nothing on the request path can fail.** The router reads a short-lived in-memory
  snapshot rather than the database, and recording never rejects. Recording also stops
  while a large backlog of unjudged outputs waits, so a traffic spike cannot become an
  unbounded judging bill.
- **A kill switch.** An environment setting freezes every loop: experiments keep serving
  their current split, but nothing is judged or drafted.

---

## Data and access

Each judged execution is stored with its **raw input and output** — for the debrief that is
the roleplay transcript and the debrief itself — and kept indefinitely, with the tenant
stamped on every row. An experiment belongs to the skill, which is shared by every tenant,
so its observations span tenants. Reading experiments therefore needs a dedicated
permission, granted only to roles that can already edit prompts; multi-tenant admins who
can merely view prompts do not get it.

---

## Known limits

Read these before trusting a winner.

- **The traffic split is random per call.** Each call independently draws the challenger
  with the configured probability. It is not sticky per user, session or tenant, so the
  same learner can see different versions on different calls, and the two arms see
  *different inputs* rather than matched pairs. The significance test and minimum sample are
  what absorb that noise, which means a low-volume skill can take a long time to reach a
  verdict.
- **The only signal is an LLM judge against an admin's rubric.** Nothing in the loop reads a
  learner's or trainer's own rating of an output, and each output gets a single judge call.
  A version that games the rubric, or a rubric that misses what matters, produces a
  confident winner. The human check is Apply: read the winner's text and judged outputs
  before applying.
- **Only the skill's text varies.** Model, temperature and the rest of the skill's settings
  are the same in every arm, so the loop cannot discover that a different model would do
  better.
- **Judging has a throughput ceiling.** Each pass judges a bounded batch per experiment, so
  a skill with heavy traffic still decides at a bounded pace, and recording pauses while the
  backlog is large.
- **Only connected call sites take part**, and only ally-be and ally-ai skills can be
  connected today (see above).
- **ally-ai dashboard overrides have a known gap.** The way ally-be sends System Skills
  overrides to ally-ai does not line up with how ally-ai looks prompts up, so an ordinary
  System Skills edit to an ally-ai skill does not reach ally-ai today. Connected skills are
  sent under their full prompt code, which is what makes an experiment's variants — and an
  applied winner — actually run. Widening that to every ally-ai skill would switch on every
  silently-unapplied dashboard edit at once, so audit them first.
- **Some prompt text in ally-ai never varies.** The debrief's supervisor-note section is
  composed in ally-ai from a shared template (`shared/supervisor_note`) that the runtime
  loads from disk and that is not itself a connected skill. An experiment on the debrief
  skills can change the instructions around that section — its `{SUPERVISOR_NOTE_SECTION}`
  slot is a locked placeholder — but not the template.

---

## Related

- [ally-be](../repos/ally-be.md) — the `skill-experiment/` module and its invariants.
- [ally-web](../repos/ally-web.md) — the admin dashboard that hosts the screen.
- [ally-ai](../repos/ally-ai.md) — the runtime for the debrief skills.
- [AI Lab](ai-lab.md) — the other prompt workbench in the admin; it is for human-run
  experiments, where Auto-improve is for automatic ones on live traffic.
