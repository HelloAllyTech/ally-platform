---
title: Debrief Agent
tags: [platform, debrief, agents, langgraph, evaluation, metrics]
summary: The Debrief agent family — the post-roleplay coaching debrief, Ask Ally replies, expert review, the orchestrator and the PM agent — where each piece lives, how releases work, and how the family is measured and evaluated.
last_reconciled: 2026-11-11
---

# Debrief Agent

After a roleplay, the learner gets a **debrief**: what worked, what to work on, one thing to practise
next, and a reflective question, each point anchored to the learner's own words. The **Debrief
family** is everything that writes, answers, checks and improves that debrief.

This page is the overview. The engineering contracts live with the code:
`docs/debrief-harness/CONTRACT.md` (how ally-be and ally-ai talk, the orchestrator, Ask Ally, the PM
agent) and `docs/debrief-harness/METRICS.md` (every number each agent is measured on, and where it is
read) in the monorepo.

> **Status (2026-11-11):** built and released, **not switched on for any organisation**. Nothing is
> enabled (live or shadow) until the evals are in place; see [Evals](#5-evals).

---

## 1. The pieces

| Piece | What it does | Code |
|---|---|---|
| **Debrief graph** | Writes one debrief per ended session. A LangGraph graph: a recipe of steps (safety reader, analyst, progress reader, guidance lookup, writer, rule checks, evaluator, reviser), each with a pinned model and a backup model, a run budget, deadlines and a fallback ladder. | ally-ai `app/core/debrief_graph/` (`POST /debrief/runs`) |
| **Orchestrator** (off by default) | A planner picks extra agents for the session (protocol check, deeper history, language specialist, cohort and course patterns, case memory, assessment anchoring) from a registry, in dependency waves, under the run's budget and time; a top-up adds agents when the first draft falls below the bar. The analyst and case memory always run (the "floor"). | ally-ai `debrief_graph/orchestrator.py`, registry in code |
| **Ask Ally** | Answers a learner's reply under their debrief, streamed. A short tool loop (learner history, guidance search, live detections) with code checks and an in-request distress check; a reply that fails a check is replaced by a safe fallback. | ally-ai `app/core/ask_ally/` (`POST /ask-ally/replies`) |
| **Expert review** | Clinical experts read the roleplay and the debrief side by side, comment on exact words, tag the comment, and give a verdict with hard fails. This is the ground truth the judge is calibrated against and what the PM agent learns from. | admin Debriefs → a session's Review panel (select words to comment) |
| **PM agent** | Weekly (and on demand), one Deep Agent reads expert comments, metric failure points and redacted reporting views, and proposes ideas (prompt edits, setting changes, bug reports). Each idea climbs a ladder: quick test on the open set → full gate test → paired trial on real sessions → canary — and reaches learners only after a person promotes it. | ally-ai `app/core/pm_agent/` (`POST /pm-agent/runs`), tools served by ally-be |
| **System of record** | Runs, releases, settings, reviews, metrics, filters, test sets, the eval runner. ally-ai is stateless per call; ally-be prepares every input and stores every output. | ally-be `src/debrief/` |

Prompts for every step live in the **Skills Store** (see [Auto-Improve](auto-improve.md) for the
store's model). A prompt's `.txt` in code is only its first version; changing a live prompt means
publishing a new version in the store.

## 2. Releases

A **release** (`agent_releases`, agent `debrief`) pins the exact prompt versions, models, recipes and
settings a run uses. Runs record the release version they ran on, so any number can be cut by it.

- The bundle in code seeds the first release. **While every release is seed-authored, a deploy whose
  code bundle changed promotes the new bundle to live** — it is not a draft. Author a release (from the
  Console) before relying on drafts.
- A challenger is created as a **draft** from the Console (e.g. the orchestrator challenger) and only
  goes live when a person promotes it; rolling back puts an earlier release live on the next run.

## 3. Where people see it

- **Admin → Debriefs** (the Debrief Console): the home list of sessions ("Needs a person" first),
  each session's page (roleplay, debrief, Review panel with comments, verdict and score by hand),
  the PM agent (ideas, releases with their steps and models, test sets) and Settings (organisations,
  budgets, autonomy, pinned rules, guidance). Old `?tab=` links redirect.
- **Admin → Analytics → Debriefs**: the live metrics as charts — headline tiles, the north-star
  uptake lift, pass and hard-fail rate by week with 95% bands, pass rate by language, guardrails,
  experience, and each agent.

## 4. Measurement

"Right" is defined **once, in ally-be code** (`src/debrief/util/debrief-outcome.util.ts`), and the
paired eval, stored results and the live Analytics tab all use that one definition:

- **Debrief pass:** the debrief reached the learner (published, or below the bar), with no blocking
  check failure and no hard fail from the independent judge. Unjudged or skipped-by-design runs have
  no verdict and are left out — never counted as failures. Outages are counted apart.
- **Ask Ally pass:** the reply passed its checks and the judge finds no unsupported claim.
- **PM agent:** an idea reaches the right final state by a clean path; live, a promotion that still
  stands 14 days later.
- Every rate carries **n and a 95% Wilson interval**; every version comparison is **paired** on the
  same cases and reports how many got better and how many got worse (exact McNemar p). Rates under 20
  are shown as "too few to read".

**Filters.** Page-wide (narrow every metric): organisation, language, learner level, debrief type,
release version, judge version, and the time range. **Pass-rate segments** (narrow only the pass rate,
shown under its heading): skill, scenario, course, session length, step model, client risk cue.

**Calibration.** Debrief quality and safety judging is calibrated by a **clinical expert**: expert
verdicts and a people-rated sample, with agreement (κ) against the judge. The PM agent may only change
live things without approval once agreement clears κ ≥ 0.6. (The "no hand-labelled sets" rule of
[Language-Quality Evaluation](language-quality-eval.md) is for language evals only.)

## 5. Evals

- **Test sets** (built from production sessions by the PM agent's weekly run): **open** (tune on it),
  **gate** (report on it), **sealed** (never tuned on, rotated monthly). Voice-to-voice test sessions
  are excluded.
- **Paired eval runner** — ally-be `scripts/debrief-eval.js`: arms `no_guidance`, `ga` (the live
  release) and `draft` (the newest draft release, optionally with a candidate prompt file), the same
  cases through each, judged with the same pinned judge, written as JSONL with ids and codes only.
- **Gates** (exit 1 on a miss): planted-fault perturbations for the quality judge
  (`ally-ai/scripts/debrief_quality_perturbations.py`) and planted risk cues for the safety reader
  (`ally-ai/scripts/debrief_safety_recall.py`, strict recall on every repetition).
- **Synthetic fixtures** for the orchestrator's planner and the PM agent's planted ideas, so their
  metrics are wired before real data exists.
- **Open (as of 2026-11-11):** where eval runs are stored and the admin surface that shows them; a
  cross-family judge; the evaluator's agreement with the judge on missed risk cues (low). Every eval
  costs model spend: size the test sets before a full pass.

## Related

- [Auto-Improve](auto-improve.md) — the Skills Store and judged prompt versions.
- [Language-Quality Evaluation](language-quality-eval.md) — a different eval system with different
  rules.
- [ally-ai](../repos/ally-ai.md), [ally-be](../repos/ally-be.md), [ally-web](../repos/ally-web.md).
