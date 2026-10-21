---
title: Analytics Agent — Natural-Language Questions Over Platform Data
tags: [platform, analytics, agent, text-to-sql, admin, super-duper-admin, llm, security]
summary: The Analytics Agent tab — ask an analytics question in English, get a narrated answer with the SQL that produced it. How the plan → guard → execute → narrate pipeline works, and the three-layer trust boundary that makes generated SQL safe to run.
last_reconciled: 2026-07-30
---

# Analytics Agent — Natural-Language Questions Over Platform Data

The **Analytics Agent** is a sub-tab of the admin **Analytics** page. A reader types an
analytics question in English; the platform turns it into a read-only SQL query over an
allowlisted subset of the primary database, runs it, and answers in prose with the rows, a
chart where the data supports one, and **the query it ran**.

It exists because the rest of the Analytics page cannot grow fast enough. Every other tab
answers a question somebody anticipated and an engineer built a panel for. Most real
questions are asked once — "which orgs started a track but never finished one?" — and are
not worth a panel. This tab covers the long tail without adding a chart for each of them.

The code lives in [ally-web](../repos/ally-web.md)
(`ally-web/apps/ally-admin-dashboard/src/pages/Analytics/tabs/AnalyticsAgentTab.tsx`),
[ally-be](../repos/ally-be.md) (`src/analytics-agent/`) and
[ally-ai](../repos/ally-ai.md) (`app/core/analytics_agent/`). This page is the conceptual
overview; the code is the source of truth.

---

## 1. Who it is for, and why the gate is narrower

Gated on **SUPER_DUPER_ADMIN** — the elevated tier — not on the pair of super-admin roles
that the rest of `/v1/analytics` accepts.

The reason is a difference in kind, not degree. Every other analytics endpoint answers one
fixed, reviewed question. This one answers whatever question the reader types, across every
readable table, at platform scope. That is a broader privilege than "can view the analytics
dashboard", so it gets its own gate: ally-be gates both endpoints on the elevated tier, and
ally-web **hides the tab** for a plain SUPER_ADMIN rather than rendering a tab whose every
request would 403 ([UI & Interaction](../product/ui.md), principle 5).

---

## 2. The pipeline

```
question ──▶ [ally-ai: plan] ──▶ [ally-be: guard] ──▶ [ally-be: execute] ──▶ [ally-ai: narrate] ──▶ answer
             writes the SQL       refuses or passes    READ ONLY + timeout    prose + chart spec
```

**ally-be owns the data and the trust boundary. ally-ai owns the language.** ally-ai never
sees a connection string, never chooses what is readable, and never touches Postgres — it
receives a schema catalogue ally-be rendered and rows ally-be decided to send. This is the
same seam as the [language-quality](language-quality-eval.md) and drift judges: ally-be
selects and persists, ally-ai transforms.

The consequence worth stating: everything that could expose data lives in three files in
ally-be (`ally-be/src/analytics-agent/constants/analytics-agent.constants.ts`, `ally-be/src/analytics-agent/util/sql-guard.util.ts`,
`ally-be/src/analytics-agent/service/sql-executor.service.ts`). The LLM half can be re-prompted, re-tuned, or moved to
a different model without reopening the security question.

### Two LLM calls, not one

Planning and narration are separate calls, deliberately:

- The **planner** writes SQL and never sees result rows. Shown the rows, it starts writing
  the answer instead of the query.
- The **narrator** describes a result and cannot change the query that produced it. The
  number on screen always came from the SQL displayed next to it.

Both run at temperature 0, so the same question over unchanged data gives the same answer —
a reader comparing two answers a minute apart can tell a data change from a sampling wobble.

### The planner can decline

The planner returns one of three intents, and two of them are not SQL:

| Intent | When | What the reader sees |
|---|---|---|
| `sql` | The question is answerable | The answer, the rows, the query |
| `clarify` | Ambiguous in a way that changes the answer — an unstated period, a metric with two defensible definitions | One short clarifying question |
| `refuse` | The data is not in the catalogue, or the request is not aggregate analytics | A sentence saying what is missing |

This is the most important behaviour in the feature. A text-to-SQL tool that always
produces a query will sometimes produce a plausible query over the wrong column, and a
confident wrong number is worse than no answer — it gets quoted in a meeting.

---

## 3. The trust boundary — three independent layers

Generated SQL is executed against the primary production database. Three controls, because
any one of them can be argued around:

**1. Table allowlist.** The agent can read only the tables named in
`ALLOWED_TABLES`. An allowlist, not a denylist: a table added by next month's migration is
unreachable until someone deliberately lists it. Deliberately excluded — tables holding
credentials or hashes; every table carrying conversation or message content (help-seeker
speech is PHI-adjacent by default here); and the audit log, which carries IP addresses and
user agents.

**2. Denied columns.** Identifiers that may never appear in a query *at all*, even inside an
aggregate: secrets and tokens, direct personal contact details, and the free-text columns
that can carry session content. Enforced on identifiers anywhere in the query, including
inside quoting — "just counting" a column still reads it, and a `WHERE content ILIKE '%…%'`
turns an aggregate into a search over conversation text. Rows leave the database twice here
(to the screen, and to the model that narrates them), which is why this tool is restricted
to aggregate analytics ([Data Visualisation](../product/data-visualisation.md), principle
10; house privacy rule 7).

**3. The execution envelope.** Every query runs inside a `READ ONLY` transaction with a
`statement_timeout`, wrapped in an outer row cap, and is always rolled back:

- *READ ONLY* is Postgres itself refusing to write, so a gap in the guard's pattern-matching
  is a wrong answer rather than a lost table.
- *statement_timeout* matters because a generated query can accidentally cross-join two
  large fact tables — without it that is not a slow answer but a connection held against the
  database that also serves live voice sessions.
- The cap is fetched as **cap + 1 rows**, which is how "exactly at the cap" is told apart
  from "cut short" — the difference between a total and a lower bound, and the answer has to
  say which it is.

### What the guard is, and is not

The guard is a **gate, not a repair shop**: a query that breaks a rule is refused with a
reason, never rewritten. Rewriting would mean the SQL shown beside the answer is not the SQL
that produced it, which defeats the point of showing it.

It is deliberately not a full SQL parser. A parser would know which identifier belongs to
which table; it would also be a large dependency whose disagreements with Postgres's grammar
are exactly the gap the guard exists to close. Every rule is conservative — it refuses
things a legitimate analytics query would not contain (comments, dollar quoting, a second
statement, system catalogs, filesystem and sleep functions).

On a refusal, ally-be **re-plans once** with the refusal as context, then stops. Most
rejections are one fixable slip and telling the planner what was wrong fixes them; a loop
would spend a minute and several model calls converging on the same refusal while hiding
that the question needs rephrasing.

Every question that reaches the database, and every refusal, is written to the audit log
(`ANALYTICS_AGENT_QUERY`). A surface that reads platform-wide data from a free-text prompt
needs a record of what was actually read, not only that the tab was opened.

---

## 4. The schema catalogue is introspected, not written down

The column list sent to the planner is read from `information_schema` at runtime (cached in
memory for 15 minutes), filtered through the denied-column policy, and paired with a
one-line hand-written statement of *what each table is for*.

Introspection is not an optimisation here, it is a correctness requirement: column naming in
this schema is genuinely mixed — most columns are snake_case, but several entities keep
camelCase columns (`promptTokens`, `compositeScore`, `occurredAt`). A hand-maintained
catalogue would be wrong for exactly the tables people ask about most, and wrong in the way
that is hardest to notice — the planner emits a column that does not exist and the reader
sees a database error instead of an answer. It also means a migration that renames a column
changes what the agent is told on the next refresh, with no second place to update.

What introspection *cannot* provide is semantics, so those are the hand-written part:
`scenario_sessions.counselor_id` is the **learner** who practised, call duration is in
seconds, `track_item_progress` rows exist for every item from enrollment so a `LOCKED` row
means "not reached" rather than "not enrolled". Those sentences change which query gets
written far more than the column list does.

---

## 5. What the answer looks like

Each answered turn renders, in this order: the answer prose, its caveats, a chart where one
is warranted, the rows, and the SQL behind one click. The screen's job is not to make an
answer look confident — it is to make one **checkable**.

**Charts are chosen from the question, then validated against the data.** The narrator picks
a form (change over time → line; comparison across categories → bar; part-to-whole over time
→ stacked bar; two measures → scatter; a single number → none) and names the result columns
for each axis. Deterministic code then drops the chart if it names a column that is not in
the result, if there are fewer than three rows to plot, or if the rows are a truncated
sample — a partial plot reads as the whole population, and an empty plot reads as a broken
panel. **"No chart" is a first-class answer**; a scalar and a short table read better as
text.

**Missing measurements stay missing.** A null or non-numeric measure becomes a gap in a line,
not a zero, and a bar is omitted rather than drawn at zero with the count of omissions stated
under the chart. An unmarked flat line at zero is indistinguishable from a measured plateau
and reads as the good news it isn't
([Data Visualisation](../product/data-visualisation.md), principle 13).

**Every answer carries its provenance** — the planner model, the narrator model, and the
prompt version — because an answer that gets screenshotted should say what wrote it, and
comparisons are only valid within one (model, prompt version) pair (principle 11).

Caveats sit directly under the answer, never in a tooltip: small samples, a truncated result
whose total is therefore a lower bound, an in-progress period that can only rise, a metric
with more than one defensible definition. They are the part a reader most needs and least
seeks out.

### The four non-answers are four different screens

`clarify` and `refuse` render as *information*, `rejected` as a warning, `failed` as an
error — and a failed turn stays in the thread rather than appearing as a toast that vanishes
before it is read. A clarifying question styled red teaches readers to distrust the tab.
A timeout says so and suggests narrowing the question, which is the one failure the reader
can act on.

---

## 6. Conversation state lives in the browser

The server is **stateless**: the client sends the turns it wants considered with each
question, and only *answered* turns become context (replaying a failure teaches the planner
to repeat it).

That is a deliberate trade. "Reset chat" is a `setState` with nothing to clean up, two tabs
cannot fight over one conversation, no migration was needed, and a reload starts clean
instead of resuming something half-finished. The cost is that history is client-asserted —
acceptable because history is only ever *context for writing a query*, never authority:
every query it produces goes through the same guard and the same read-only envelope, so a
tampered history can at most produce a differently-worded question from a reader who could
already ask it directly.

Resetting is the one confirmed action on the screen, because the thread exists only in that
tab and clearing it cannot be undone ([UI & Interaction](../product/ui.md), principle 4).

---

## 7. Cost

Two LLM calls per question, emitted to the token-usage accounting as
`analytics_agent_plan` and `analytics_agent_answer` — separate labels because the planner
carries the whole schema catalogue and the narrator carries result rows, so their token
profiles differ and the AI-cost tab should not average them together. The planner may run on
a stronger model than the narrator: choosing the wrong column is a wrong number, while
describing rows well is comparatively easy.

---

## 8. Limits and non-goals

- **Aggregate analytics only.** No message content, no transcripts, no contact details — by
  construction, not by prompt instruction.
- **No writes, ever.** There is no mode, flag, or phrasing that makes this tool modify data.
- **One question, one query.** The agent does not chain queries or fan out; a question needing
  three joins gets one query with three joins, and a question needing two passes gets a
  clarification.
- **Not a replacement for a reviewed panel.** A number somebody checks weekly should become a
  panel on one of the other tabs, where its definition is fixed and reviewed. This tab is for
  the questions asked once.
- **Row-capped.** A result larger than the cap is labelled as truncated and its totals are
  lower bounds — export and pagination are not offered, deliberately, because a "download
  everything" path over generated SQL is a different feature with a different risk profile.

---

*See also: [Architecture & Data Flow](architecture.md) ·
[Data Visualisation](../product/data-visualisation.md) ·
[AI Lab](ai-lab.md) · [ally-be](../repos/ally-be.md) · [ally-ai](../repos/ally-ai.md) ·
[ally-web](../repos/ally-web.md)*
