---
title: AI Lab — Prompt Workbench & Human Evaluation
tags: [platform, ai-lab, prompts, evaluation, human-eval, admin]
summary: The admin AI Lab — author prompt Skills with variables, execute Runs against OpenAI or Anthropic models, and collect structured human and LLM-judge evaluations of the outputs.
last_reconciled: 2026-10-21
---

# AI Lab — Prompt Workbench & Human Evaluation

**AI Lab** is an internal workbench in the admin dashboard for prompt engineering and
output evaluation. It lets the team author reusable prompt templates, run them against
production LLMs with different inputs, and gather structured judgements on the results —
both from human evaluators and from an LLM judge.

The code lives in [ally-web](../repos/ally-web.md) (`apps/ally-admin-dashboard`, under
`src/pages/AILab/`) and [ally-be](../repos/ally-be.md) (the `src/lab/` NestJS module,
which owns the Postgres tables). This page is the conceptual overview; the code is the
source of truth.

---

## 1. Concepts

- **Skill** — a named prompt template. Its `content` holds `{{variable}}` placeholders and
  it may pin a specific model (picked from the platform LLM catalog, which the picker limits to
  OpenAI and Anthropic models); otherwise the run uses the platform's reasoning-tier default
  model. A skill can also carry an optional system prompt and generation parameters (below).
- **Variable** — a named slot referenced by skills (e.g. `{{transcript}}`).
- **Value** — a candidate value for a variable (a value can be a long block such as a whole
  transcript; the picker shows a one-line label).
- **Run** — one execution of one skill: its placeholders are resolved with chosen values, the
  prompt is sent to the skill's model, and the output (or error) is stored as a log row.
  Runs launched together share a `batchId`.
- **Question set** — a reusable, named list of evaluation questions that can be imported when
  publishing a run.
- **Evaluator** — a human reviewer with an email + generated password who signs in to the
  `/evaluate` portal (a route of the same admin app) to score published runs.

## 2. Flow

1. **Author** skills, variables, and values in their respective tabs; the same screen also holds
   the Runs, Evaluators and Question Sets tabs.
2. **Run** — pick one or more skills, choose a value for each referenced variable, and execute.
   Each skill becomes its own log row (one per value combination for a matrix run) that moves
   through `RUNNING → COMPLETED | FAILED`, with `PENDING` in front when it is queued (see §4).
3. **Publish** a completed run, once, with an evaluation questionnaire — written from scratch or
   imported from a question set. Question types: **RATING** (a 1–N numeric scale, N up to 10),
   **YES_NO**, and **TEXT**, plus **DESCRIPTION**, explanatory text the evaluator reads but does not
   answer. Questions are frozen at publish time.
4. **Assign** the published run to one or more evaluators. Assigning is add-only; an assignment
   that has not been submitted can be removed. Publishing and assigning both work in bulk from the
   Runs tab.
5. Evaluators sign in to the portal and **submit** answers (all answerable questions required;
   submissions are immutable). The portal shows the evaluator the skill, the model, the resolved
   prompt, the variable values and the output, so a rating is not blind to which model produced it.
6. **Results** aggregate per question — rating distributions & averages, yes/no counts, and
   free-text answers — plus a record-level normalized score (0–100) that pools the rating
   questions across differing scales.

## 3. Security & multi-tenancy notes

- AI Lab is gated by dedicated admin permissions (view, edit, delete — created by the
  `AddAILabPermissions` migration) **and** by the per-user `ai_lab` feature toggle; every admin route
  needs both.
- Evaluator accounts are **not** platform users: they live in their own table with no roles,
  tenant or groups, and their JWTs carry a distinct `kind` claim that the evaluator portal requires.
  A per-account token version revokes outstanding tokens when a password is regenerated. Login runs
  a constant-cost password compare (even for unknown emails) to avoid user enumeration, and the
  portal login is rate-limited by IP.
- Skills/variables/values/runs are system-wide (not tenant-scoped) — this is an internal tool.

## 4. Recent improvements

A round of improvements landed across `ally-be`, `ally-web`, and `infra`:

- **Per-skill generation params** — temperature, max output tokens, and an optional system
  prompt, applied per provider (temperature only where the model supports it).
- **Model choice is explicit.** The model a run uses is the skill's, or else the reasoning-tier
  default, and it is never silently substituted if that provider fails. It is recorded on the run.
  Runs and judge calls are one row in the AI task registry
  (`ally-be/src/llm/constants/ai-task-registry.constants.ts`, shown in the admin **AI Tasks** tab) and
  record their usage under the `ai-lab` feature.
- **Token & cost tracking** — completed runs record prompt/completion/total tokens and an
  estimated USD cost from a per-model pricing table; shown in the run detail drawer and the batch
  comparison. A model missing from the table records tokens but no cost.
- **Asynchronous execution** — when a lab-run SQS queue is configured (`SQS_LAB_RUN_QUEUE_URL`
  and `SQS_LAB_RUN_DLQ_URL`), runs are queued (PENDING) and executed by a worker; the runs log polls
  for live status. A message that keeps failing lands in the DLQ, whose handler marks the run
  FAILED with a generic dead-lettered error — the provider's real error is not kept on that path.
  With no queue configured, runs execute synchronously inside the request and store the real error.
- **Matrix runs** — pick multiple values per variable to run a skill across the cartesian
  product of a value set (one row per combination, shared batch id, fanned out from the browser with
  a cap per submission), with a **side-by-side batch comparison** view that only sees the runs on the
  page currently loaded.
- **Automated (LLM-as-judge) evaluation** — score a completed run's output against a free-text
  rubric with a judge model (default: the reasoning-tier model). It runs synchronously in the
  request at temperature 0 and returns a 0–100 score with a rationale. A run can have several, and
  they are stored apart from human results, never blended into them.
- **Results analytics** — CSV and JSON export (built in the browser; the CSV is a per-question
  summary) and a per-question agreement indicator: the share of responses that chose the most
  common answer, for rating and yes/no questions. It is not a kappa or alpha.
- **UX & delivery** — per-skill failure surfacing when creating runs, evaluator invite emails
  (sent on create and on password regenerate), paginated runs, and tests for the run, auto-eval and
  evaluator services plus the create-run drawer.

### Still open
- Move AI Lab's panels onto the shared, focus-trapped `SidePanel` in `ui-shared`. The trap exists
  there, but the four CRUD tabs use the admin's own `EntitySidePanel` and every run and question-set
  drawer is a hand-rolled overlay; none of them traps focus.
- Extend pagination to the Skills / Variables / Values / Evaluators / Question Sets tabs. They send
  no page parameters, so a long list is silently cut at the backend's default page size — search
  still finds the rest.
- Make sure both queue URLs are set wherever async execution should be live, and set the DLQ one
  with the queue: without it a run that exhausts its retries is never marked failed. With neither
  set, runs stay synchronous.
