# Debrief harness: the ally-be ↔ ally-ai contract

Status: being built (2026-11-10); Ask Ally (§5) moved 2026-11-11. Design: `~/projects/Ally/ally-debrief-orchestrator-spec.md` (Parts A, D, E; Ask Ally §A10, §D2 step 4).

The Debrief agent moves from ally-be's `DebriefRunnerService` to a LangGraph graph in ally-ai. **The graph
decides, ally-be executes**: ally-ai never writes ally-be's database.

## Who does what

| ally-be (system of record) | ally-ai (the debrief graph) |
|---|---|
| Claims the run (one per session), early skips (`no_session`, `too_short`, `no_transcript`), loads all context, resolves the release bundle, prompt texts (with run overrides) and the effective run ceiling; the `monthly_cap` skip | The language of a session that recorded none (read from the learner's turns, see §1); recipe choice from the bundle and session flags; every model step (safety reader, analyst, progress reader, writer, evaluator, reviser); budget reservations; model order with circuit breaker and backup model; the check → evaluate ⇄ revise loop; deadlines; fallback rungs; the decision (published / below_bar / needs_person + reason); step records |
| Gateway tools the graph calls: guidance search, rule checks, live progress | Checkpoints every step (LangGraph Postgres checkpointer, thread id = run id) so a resumed run never pays twice |
| Applies the result to `debrief_runs` (same fields as today) and does everything after: publish, judge, trials, metrics | — |

`DebriefRunnerService.run(sessionId, opts)` keeps its signature and callers; it always prepares, calls the
graph and applies the result. The legacy in-process path is deleted (no flag, see "Changes during build").

## 1. Start or resume a run — `POST /api/v1/debrief/runs` (ally-ai)

Auth: the existing service `X-API-Key`. Synchronous: returns when the run reaches a decision (up to the
deadline, 150 s / 180 s with a risk cue, plus margin). Calling again with the same `run_id` and
`resume: true` continues from the last checkpoint (FR-3); calling with a finished `run_id` returns the
stored result.

```jsonc
{
  "run_id": "uuid",
  "scenario_session_id": "uuid",
  "mode": "shadow | live | replay",
  "resume": false,
  "release": { "id": "uuid | null", "version": 3 },
  "bundle": { "recipes": { ... }, "settings": { ... }, "reply": { ... } },   // DebriefBundle, settings already merged with run overrides
  "prompts": { "<prompt code>": "<live text>" },                            // every prompt the bundle names, overrides applied
  "ceiling_usd": 0.5,
  "allow_over_ceiling": true,                                               // live runs only: the minimum path may pass the ceiling (see "The learner always gets a debrief")
  "attempt": 0,                                                             // a retry from the start: n > 0 runs on thread `<run_id>:retry<n>`
  "prices": { "<model>": { "input_per_m": 0.3, "output_per_m": 2.5 } },      // for every model the bundle names; unpriced = cannot run
  "session": {                                                              // DebriefSessionContext as ally-be loads it today
    "tenant_id": "...", "language": "en-IN", "language_source": "recorded | null", "language_recorded": true,
    "learner_turns": 12, "assessment": false, "in_case": false, "scenario_id": 41, "...": "...",
    "expected_behaviours": ["Empathy"],                                     // named competencies only, never a custom code
    "helpful_behaviours": ["Asks open questions"],                          // the roleplay's SHOULD_DO + custom competencies' HELPFUL
    "unhelpful_behaviours": ["Gives advice too early"],                     // the roleplay's SHOULD_NOT_DO + custom competencies' UNHELPFUL
    "competencies": [ { "name": "Empathy", "helpful": ["Reflects feelings"], "unhelpful": [] } ]   // named only; behaviours may be empty
  },
  "transcript": [ { "turn_index": 0, "role": "counselor | client", "text": "...", "message_id": "..." } ],
  "context": {
    "live_detections": [ ... ],      // [] when unreadable
    "past_work_on_this": [ ... ],    // progress reader input
    "cohort": { ... } | null,
    "case_memory": { ... } | null,
    "practice_options": [ { "id": 41, "title": "...", "skills": [...], "course": "Basics", "this_roleplay": true, "trackItemId": "..." } ]   // inside a course: only this roleplay, with course/this_roleplay/trackItemId
  },
  "run_token": "<JWT signed by ally-be>",
  "gateway_url": "https://<ally-be>/api/v1/internal/debrief"
}
```

Response:

```jsonc
{
  "status": "published | below_bar | needs_person | skipped | failed",
  "skip_reason": "safety_reader_failed | writer_failed | budget_below_minimum | ... | null",
  "recipe_key": "standard",
  "cards": { ... } | null,                 // final cards, point ids + offered practice already applied
  "steps": [ DebriefRunStepRecord ],       // same shape as today (step, label, status, startedAt, ms, model, estimatedUsd, round, note, why, inputs, reasoning, output, budgetLeftUsd)
  "workspace": { "safety": ..., "evidence": ..., "progress": ..., "history": ..., "passages": [...], "liveDetections": ..., "cohort": ..., "caseMemory": ..., "drafts": [...], "decision": {...}, "revisionRounds": 1, "evaluatorRounds": [...] },
  "estimated_cost_usd": 0.0712,
  "fallback_rung": 0,
  "has_risk_cue": false,
  "learner_distress": false,
  "revision_rounds": 1,
  "evaluator_overall": 9.2,
  "evaluator_hard_fails": [],
  "check_failures": [ "C-4" ],
  "resumed": false,
  "language": "hi"                         // the debrief's language: the recorded one, or the one read from the learner's turns
}
```

**Language (v9 FR-39; moved into the graph 2026-11-11, spec §D1).** ally-be sends what it knows: the session's
configured language (its default `en` when none is recorded), `language_recorded`, and `language_source:
"recorded"` (null when not recorded). Before any step, the graph settles the language
(`registry/profile.py` `resolve_language`): a recorded one is kept; for `language_recorded: false` it is read
from the learner's (`counselor`) turns — Tamil, Kannada and English by script, Devanagari as Hindi or Marathi by
their most common words — with `language_source` `detected`, or `detected_low_confidence` when the script's share
is under 60%, the text under 20 letters, or Hindi and Marathi within one word of each other. Every step reads that
language; the response's `language` and `workspace.languageSource` carry it, and ally-be writes them to
`debrief_runs.language` and `workspace.languageSource` as its own detection did (a port of the deleted
`detect-language.ts`, identical on 425 inputs). A run ally-be ends before calling the graph (an early skip or the
`monthly_cap`) keeps the session's language and, when it recorded none, no `languageSource`.

Field meanings and values are exactly today's `DebriefRun` columns and workspace keys, so ally-be's apply step,
the Console, the metrics and the PM agent's reporting views read them unchanged.

## 2. Gateway tools — `POST {gateway_url}/tools/:name` (ally-be)

Auth: `Authorization: Bearer <run_token>`. The token is an HS256 JWT signed by ally-be with
`DEBRIEF_GATEWAY_SECRET`, claims `{ runId, sessionId, tools: [...], exp }` (exp = now + 15 min). ally-be
verifies its own signature, the expiry, that the tool is in `tools`, and that the run exists and is `running`.
ally-ai never holds the secret.

| Tool | Body | Returns |
|---|---|---|
| `guidance_search` | `{ "topics": [ { "skill": "...", "situation": "...", "language": "..." } ], "per_moment": 2 }` | `{ "passages": [ { "id", "code", "text", "citation", "band" } ], "no_confident_match": bool }` — Context Library Debrief Guidance, scoped to the session's org |
| `run_checks` | `{ "cards": {...}, "safety": {...}, "language": "...", "short_form": bool, "has_progress": bool }` | `{ "failures": [ { "code", "message", "section" } ], "weight": n, "advisory": ["C-4", ...] }` — `runDebriefChecks` on the session's transcript (loaded by ally-be) |
| `render_cards` | `{ "cards": {...} }` | `{ "text": "..." }` — `renderCards`, for the Evaluator's input |
| `finalise_cards` | `{ "cards": {...}, "offered": [41, 7] }` | `{ "cards": {...} }` — `keepOfferedPractice` + `withPointIds` |
| `progress` | `{ "step": "writer", "round": 1, "topic": "...", "has_risk_cue": bool }` | `{ "ok": true }` — writes `workspace.liveProgress` (FR-27); fire-and-forget on the ally-ai side |
| `get_learner_history` | `{ "limit": 10 }` (at most 10) | `{ "points": [ { "date", "skill", "point" } ] }` — the learner's earlier Work-on-this points, newest first. **Reply tokens only** (§5); the learner is the token's `userId`, never one the body names |
| `get_live_detections` | `{}` | `{ "detections": [ { "behaviour", "detected", "times" } ] }` — the live detector's record for the session's scenario. **Reply tokens only** |

### 2a. PM agent tools (same route, agent token)

Auth: `Authorization: Bearer <agent_token>` from `DebriefRunTokenService.signAgent(agentRunId)`: HS256 with the
same secret, claims `{ kind: "agent", agent: "pm_agent", agentRunId, tools: [...], exp }` (exp ≤ now + 2 h). A
debrief run token is refused here (401) even if it lists the tool, and an agent token is refused on every tool
above. Builder and Bug Hunter are never given a token, so they never receive comment text (spec B4).

| Tool | Body | Returns |
|---|---|---|
| `comments_read` | `{ "since"?: ISO date (exclusive, on `created_at`), "status"?: "open" \| "resolved" (default both), "ids"?: [uuid, ...], "limit"?: 1–200 (default 100) }` | `{ "comments": [ { "id", "run_id", "session_type", "language", "anchor": { "kind": "transcript" \| "card" \| "debrief", "turn_index", "section", "span_start", "span_end" }, "quoted_text", "body", "tag", "status", "idea": { "id", "status" } \| null, "repeat_of_id", "created_at", "replies": [ { "id", "body", "tag", "created_at" } ] } ], "next_since": ISO \| null }` — expert comment threads, oldest first (spec D8). Never the transcript, the cards or who wrote a comment. `next_since` is set when the page was full; pass it back as `since` |
| `reporting_query` | `{ "sql": "SELECT …" }` | `ReportingQueryResult` `{ sql, ok, rows?, truncated?, refused? }` — the existing Analytics Agent guard and read-only executor over the redacted `debrief_reporting.*` views only. A refused query answers `refused` (the agent reads it as a tool error) |
| `metrics_view` | `{ "weeks"?: 4–52 (default 8), "language"?, "recipe"?, …metric filters }` | `{ weeks, failure_points: [ { kind, name, segment, value, n, target, why } ], metrics: { <name>: value }, metric_names }` — spec C2 failure points from `DebriefMetricsService.view()` (`debrief-metric-failures.util.ts`): experience rates off the v9 targets (all, per language, per device), guardrails (hard-fail and thumbs-down above pre-launch, fabricated quotes, judge median below 8), efficiency drift (cost, revision rounds, visible seconds), steering falling, stages failing. Thin samples (n < 20) are left out |
| `idea_propose` | `{ "problem": { title, summary, comment_ids[], metrics: [ { name, value, segment? } ] }, "route": "A"\|"B"\|"C"\|"D", "title", "hypothesis", "expected_effect": { metric, direction: "up"\|"down", by?, note? }, "confidence": { level: "high"\|"low", why } }` | `{ idea_id, route, linked_comments, unknown_comment_ids, baseline: { metric, value }, next }` — writes an `agent_lessons` idea (`change.route`, `change.ideaKind` = `route_a` / `needs_code` / `defect` / `needs_person`; `evidence.problem`, `commentIds`, `metrics`, `forecast` with the named metric's value now, `confidence` `{level, why}` (V2_AUTONOMY A2; one left out is stored as low, so it never skips the always-ask list); `release_draft` may restate it), links the cited comments (`DebriefReviewService.linkIdea`). Refused: no evidence (no existing comment id and no metric), a metric not in `PM_AGENT_METRICS`, more than 5 ideas in one run, a duplicate, autonomy off |
| `release_draft` | `{ "idea_id", "kind": "prompt_edit"\|"setting"\|"registry_agent", prompt_code/find/replace \| setting_key/setting_value \| agent: { id, description, use_when, skip_when, prompt, tools[], scopes[], eval_cases, model? } }` | `{ ok, idea_id, kind, next }` — route A only; draft only (nothing reaches learners). Refused: the never-list (C4: the rubric and judge prompts, the Safety reader, the PM agent's own instructions, budgets, `passScore`, every owner setting), prompts outside `PM_AGENT_EDITABLE_PROMPTS` (orchestrator prompts only while GA runs the orchestrator), a `find` not exactly once in the live text, a change to `{variables}`, settings outside `PM_AGENT_SETTINGS` ranges, a change that does not apply to GA or fails bundle validation; FR-53 for registry agents (registered tools and A2 scopes only, ≥ 10 eval cases, ≤ 10 experimental, approved model). Registry agents are stored as drafts: the build defines the agents a release can enable, so they are not tested yet |
| `ladder_start_quick_test` | `{ "idea_id" }` | `{ status: "running", startedAt, note }` — requests `DebriefPmAgentService.screen` (the deterministic ladder: quick test → gate → paired trials → canary watch; a person starts the canary and promotes). Refused: autonomy `propose_only` (a person starts it in the Console) or `off`, no drafted change, a registry agent, the learning budget spent, a quick test already running |
| `builder_handoff` | `{ "idea_id", "problem", "evidence_summary", "expected_effect", "acceptance_checks": [ … ] }` | `{ ok, idea_id, waiting_for, quotes_removed }` — route B. Quotes and the cited comments' text (bodies, quoted spans, replies) are stripped here as well as in ally-ai; a brief that asks to change something on the never-list is refused (route D). Stored as `evidence.handoff`, then **started on its own** (V2_AUTONOMY A8, `DebriefPmAgentService.autoStartHandoff`): the Builder session opens with it as `handoffContext`, the Debrief owner as its owner of record, the PM agent answering Builder's questions; `evidence.handoff.startedOnItsOwn`, `decidedBy: null`, `evidence.autoStart`. The pull request still waits for an engineer to merge. Left waiting (with the reason) while code changes are paused or there is no owner. Answers `started` and `waiting_for` |
| `bug_hunter_report` | `{ "idea_id", "summary", "run_ids": [uuid], "repo"? }` | `{ ok, idea_id, waiting_for, quotes_removed }` — route C, same stripping and never-list check; filed on its own (A8) through `RoadmapOpportunityService.createBugReport` (a Bug Hunter reported bug) with the summary and the run ids that exist |
| `person_ask` | `{ "idea_id", "topic": "rubric"\|"safety"\|"budget"\|"data_access"\|"clinical"\|"product"\|"other", "question", "context"? }` | `{ ok, idea_id, waiting_for }` — route D: a Console item for the owner (or the clinical advisor for clinical and safety); Approve marks it answered |
| `guidance_propose` | `{ "idea_id", "action": "new"\|"change", "existing_code"? (`DG-…`), "scope": "platform"\|"organisation", "title", "situation", "guidance", "why"?, "run_ids": [..] }` | `{ ok, idea_id, waiting_for, note }` — route D only: a Debrief Guidance entry drafted for the clinical advisor. **Nothing is written to the Context Library** (spec C4); the advisor adds or edits the entry there and Approve marks it done. **Release step:** the live Skills Store prompt `debrief_improver_system` needs a new published version with the route-D `guidance_propose` sentence (CONSOLE_API.md "Release steps") Refused unless the cited runs cover ≥ 10 learners (≥ 3 organisations when platform-wide; one when `organisation`), the text has no instruction-like patterns, and no 6-word run copies a cited session or comment (plan §11.6) |

Every refusal answers **200** `{ "refused": "<readable reason>" }` and is audited (`agent_lesson_audit`, action
`blocked`, `detail.agentRunId`, `detail.tool`, `detail.neverList` for C4) so the offline eval can read a clean path;
every accepted action is audited as `proposed` or `pipeline_step` with `detail.agentRunId`. A 4xx/5xx still means the
token or the request was wrong.

## 3. Rollout (decided 2026-11-10)

No shadow period: the Debrief agent is not in learners' hands at scale yet, so the graph **replaces** the
legacy path outright once it passes the local end-to-end checks below, and the legacy code is deleted in the
same change. No runtime flag stays behind.

- ally-be env: `DEBRIEF_GATEWAY_SECRET` (signs run tokens; unset derives one as
  HMAC-SHA256(`JWT_ACCESS_SECRET`, 'debrief-gateway-v1'), never the access secret itself) and the existing
  `PUBLIC_API_BASE_URL` to build `gateway_url` (`{PUBLIC_API_BASE_URL}/api/v1/internal/debrief`; unset is
  `http://localhost:$PORT`, which a containerised ally-ai cannot reach, so set it locally, e.g.
  `http://host.docker.internal:8001`).
- ally-ai: the checkpointer reuses the Agents v2 runtime's checkpoint database (`AGENT_RUNTIME__CHECKPOINT_*`),
  with an in-memory fallback locally, exactly as that runtime does.

### Autonomy by default (Debrief v2, 2026-11-16)
The ladder no longer waits for a person except for the always-ask list (V2_AUTONOMY.md A1): a
passed side-by-side trial starts the learner try-out, a passed try-out goes live, and a live change
is watched for `watchDays` and undone when its cumulative score falls by more than `undoMargin`
within one language and recipe, or a gate trips. ally-ai's PM agent may state a confidence on an
idea as `evidence.confidence` (`'high' | 'low'` or `{level, why}`); ally-be reads it, and missing
reads as high.

## 4. Local end-to-end checks (before deleting legacy)

1. A real local session debriefed end to end through ally-be → graph → publish → judge; the Console run view
   shows every step with why / inputs / reasoning / output / budget left.
2. Short, standard, case and assessment sessions each reach a decision.
3. A risk-cue session: the important moment covers every cue; learner distress opens with support.
4. Forced failures: safety reader failure → needs_person; writer failure on both models → needs_person; a
   tiny ceiling → fallback rungs, still a checks-passing draft; deadline hit → FR-19 behaviour.
5. Resume: kill ally-ai mid-run, call again with `resume: true` → completes without repeating paid steps.
6. Replays (a quick test from the PM agent tab) and the Console "run now" work through the façade.
7. The same sessions through the legacy path and the graph: same decision status, comparable judge scores
   and estimated cost (recorded in the PR description).

## Changes during build

Recorded by the ally-be build (2026-11-10).

1. **No flag, no legacy path.** The user dropped `DEBRIEF_HARNESS` and `runLegacy`: `run()` always does
   prepare → graph → apply, and the in-process steps are deleted from ally-be now (with the model circuit breaker,
   `estimateStepCostUsd`, and the runner's narration helpers). Check 7 in §4 (legacy vs graph side by side)
   can only be done against a build from before this change (e.g. master at `e9c1e7123`).
2. **`session` keys** are the snake_case of `DebriefSessionContext`: `id, tenant_id, counselor_id, status,
   language, language_source, language_recorded, learner_level, learner_turns, scenario_id, scenario
   ({title, description}), expected_behaviours, helpful_behaviours, unhelpful_behaviours, competencies,
   assessment, in_case` (the last four: see "What the roleplay expects" below).
3. **`transcript` turns** are `{turn_index, role, text}` (no `message_id`: the transcript ally-be builds has none).
4. **`context` values** are passed exactly as ally-be's readers return them: `past_work_on_this` is
   `[{date, skill, point}]`, `case_memory` a string or null, `cohort` `{trainees, skills: [{skill, how_often}]}`
   or null. `case_memory` is read only when the recipe rule picks Case; `past_work_on_this` only when the
   session has a learner. Unreadable optional reads are `[]`/null, never an error.
5. **`prompts`** holds every code in `bundle.prompts`, the six step prompts (safety reader, analyst, progress
   reader, writer, reviser, rubric) and any override code; a value is `null` when the Skills Store has no such
   prompt (ally-ai then uses its default).
6. **`prices`** covers every recipe step's `model` and `backupModel` and the reply model; an unpriced model is
   left out (the graph must not run it).
7. **`release`** is `{id, version}` with both null when the GA release was missing or did not validate (the seed
   bundle runs).
8. **`run_checks` failures** keep today's `DebriefCheckFailure` shape `{code, section, detail}` (not
   `message`), because the run stores them and the Console reads `detail`. `advisory` lists every advisory
   check code (today `["total_too_long"]`), not the advisory codes among the failures.
9. **`check_failures` in the response** should be those failure objects (the `debrief_runs.checkFailures`
   shape). Bare code strings are accepted and stored as `{code, section: "", detail: ""}`.
10. **`guidance_search`** looks up at most 3 topics; the query is each topic's `situation` (else `skill`).
    Passages also carry `title` (= `citation`). If retrieval is unreachable it answers 200 with what it found
    so far and `"unavailable": true`.
11. **Response `error`** (optional string): with `status: "failed"`, what stopped the graph; ally-be stores it on
    the run. A response without one of the five statuses is treated as a graph failure.
12. **Gateway errors**: 401 for a missing, malformed, wrongly signed or expired token; 403 for a tool not in
    `tools` or a run that does not exist, is for another session, or is not `running`; 404 for an unknown tool.
13. **Timeout**: ally-be waits `riskDeadlineMs + 60 s` (the bundle's settings with run overrides) for the graph.

### Recorded by the ally-ai build (2026-11-10)

14. **`guidance_search` is called once per pivotal moment** (up to 3), each with one topic
    `{ "situation": <the Analyst's moment summary> }` and `per_moment` = `guidancePassagesPerMoment`. That keeps
    the runner's behaviour: the deadline is checked before each lookup, passages are de-duplicated by `id`, and
    `workspace.passages` is the kept ids. `no_confident_match: true` keeps nothing from that lookup;
    `unavailable: true` (or any non-2xx / no answer) stops looking — "Guidance could not be reached; writing
    without it." — and never fails the run. A passage's title is `title`, else `citation`.
15. **Workspace keys are today's runner keys**, not the sketch in §1: `languageSource`, `liveDetections`,
    `caseMemory`, `safety`, `evidence`, `passages`, `progress`, `history`, `cohort`, `evaluations` (not
    `evaluatorRounds`), `bestRound`, `drafts`, `decision`, plus `resumes: 1` on a resumed run. The revision count
    is the top-level `revision_rounds` (no `workspace.revisionRounds`). `liveProgress` is ally-be's (the
    `progress` tool writes it).
16. **`evaluator_overall`** is a number (the overall, one decimal) or null; ally-be formats it for its column.
17. **Failures and resume.** An unexpected error inside the graph (including a non-2xx from `run_checks`,
    `render_cards` or `finalise_cards`; 5xx/429/no answer is retried 3 times first) answers **200** with
    `status: "failed"`, `error`, the steps recorded so far and `fallback_rung: 6`. The thread stays
    resumable: calling again with the same `run_id` continues from the last checkpoint whether or not
    `resume` is set (a thread with a checkpoint is never restarted from scratch), and `resumed` is then true. A
    thread that already finished returns its stored result, whatever `resume` says. A `resume: true` call for a
    run id ally-ai has no checkpoint of (e.g. the in-memory saver after a restart) starts the run afresh.
18. **503** from `POST /runs` when `AGENT_RUNTIME__CHECKPOINT_DB_URL` is set but the database could not be
    opened at startup (as the Agents v2 runtime does). ally-be treats it like any other graph failure.
19. **`progress`** is sent as each model step starts (once per step, not per attempt) and as the guidance
    lookup starts: `{ "step", "round"? (revision rounds only), "topic"? (guidance only), "has_risk_cue" }`.
    Every error from it is ignored.
20. **Step records after a resume**: a step that completed before the stop is not run again and keeps its
    original record; there is no extra "resumed from checkpoint" record (the legacy runner wrote one when it
    replayed a checkpointed answer).
21. **ally-ai unreachable** (no answer or a 5xx from `POST /debrief/runs`): ally-be leaves a production run
    `running` with `workspace.graphUnreachable`, and the stuck-run sweeper resumes it (`resume: true`) from
    the graph's checkpoint after 5 minutes; its own limits hand it to a person if that fails too. A replay ends
    `failed`, as before (replays aren't swept). Verified locally: ally-ai killed with `kill -9` at the Writer,
    restarted, resumed — only Writer, checks, Evaluator, Reviser and Evaluator ran again.
22. **Checkpointer**: ally-ai opens the checkpoint database whenever `AGENT_RUNTIME__CHECKPOINT_DB_URL` is set,
    not only when the chatbots' `AGENT_RUNTIME__ENABLED` is on — otherwise the Debrief graph would silently
    checkpoint in memory and lose resume across restarts.
23. **Rule checks stay in ally-be** (`run_checks` tool), per D11: rules on data stay with the data; the graph
    can't skip them because every draft goes through the `checks` node.

### The learner always gets a debrief (2026-11-16)

Gopi: "as much as possible the learner should get the debrief; in the worst case fall back to the old debrief
(today's debrief)". Nothing leaves the learner on "working", "on its way" or "taking longer" for good:

- **Past the month's cap.** A **live** run whose ceiling (the cap, what is left of it, or the session budget) is
  below `settings.runFloorUsd` runs with `ceiling_usd = runFloorUsd` and `allow_over_ceiling: true`; when the
  month's cap is what stopped it, ally-be marks `workspace.overCap = true` and `workspace.overCapSpend
  {spentUsd, capUsd}`. In the graph, `allow_over_ceiling` lets the minimum path's reservations (safety reader in
  `plan`, writer in `prepare_writer`) pass the ceiling when the model is priced (an unpriced model still never
  runs); optional steps keep to it, and a writer reserved past it sets `workspace.overCeiling`. `monthly_cap`
  and `budget_below_minimum` now end only shadow runs (or a live run whose minimum-path model is unpriced).
  The owner is told once per IST day (`workspace.overCapNotice {day, at}` on the run that told them) with the
  amount, in the app (`DebriefNotifier.owner`) and on Slack when it is set up (`DebriefAgentService.notifyOverCap`).
- **Provider not allowed.** `restrictBundleToProviders(bundle, allowed, substitutes)`: a step whose model and
  backup are both on providers the organisation does not allow runs on a priced model from the ally-ai model
  catalogue on an allowed provider (same tier first, then cheapest; never the judge's model; the evaluator
  never on the writer's), recorded as `workspace.providerAllowlist.substitutedSteps`. Learner data still never
  reaches a provider the organisation does not allow (FR-57). Only when no candidate exists does the run end:
  `skipped` / `provider_not_allowed` (no longer `needs_person`).
- **No draft (safety reader or writer failed, stuck, an error).** The run is run again **once** from the start
  (`DebriefAgentService.retryRun`: the row goes back to `running` with `workspace.retries` + 1, claimed in one
  statement; `DebriefRunnerService.retry` sends `attempt: n`, so ally-ai starts a fresh thread
  `<run_id>:retry<n>` — the safety reader runs again, so nothing is published without a safety reading). The
  stuck sweep retries any it missed (`retryFailedRuns`). Retried: `needs_person` with `safety_reader_failed`,
  `writer_failed`, `stuck`, `budget_below_minimum`, `monthly_cap`, and every `failed`.
- **Today's debrief.** A live run that still has no draft (and `provider_not_allowed`, `debrief_tab_off`) marks
  `workspace.fallbackToToday {at, outcome}` and emits `debrief.fallback_to_today`; `ScenarioSessionService`
  writes today's debrief for the session (it skips switched-on organisations at session end), keeping one
  already written. Organisations switched on never had today's summary, so this is what makes the fallback real.
  **Unless** today's debrief's provider (its AI task registry row `scenario-evaluation`, `providerOfModel`) is
  not on the organisation's allowlist: then `outcome: "not_available"`, nothing is generated, and the learner
  view says "not available" (`stopped: true, reason: "provider_not_allowed"`).
- **Debrief tab off.** `scenarios.metadata.feedbackTabs.debrief === false` → the runner records `skipped` /
  `debrief_tab_off` before any model step; no "ready" notification.
- **Every ended session gets a run.** The drain no longer requires a learner message (the runner records
  `too_short`).

The learner view (`GET /v1/debriefs/sessions/:id`): `too_short` at once when the session has no learner turn;
`not_available` when the agent mode is `off`, the Debrief tab is off, no run has started 30 minutes after the
session ended (`NO_RUN_GIVE_UP_MINUTES`), or a live run has no draft and no retry due (`working` while it is
due); `taking_longer` / `on_its_way` only for a held draft about to be shown. Every such `not_available` asks for
today's debrief when it is not written yet. `ready` carries `askAlly {open, reason?}`: closed after Ask Ally
answered with its limit (`workspace.askAllyLimit {reason, at}`, written by the reply service; a `month` limit
reopens when the IST month turns). `practice[]` items carry `trackItemId` inside a course.

**Practise this again inside a course** (clinical review 2026-11-16; replaces the "middle option" of
74fde9b32). For a session with `trackItemProgressId`, `DebriefPracticeService` offers no other roleplay: the
only option is this same roleplay as its course item (`this_roleplay: true`, `course`, `trackItemId`); an
unreadable course offers nothing. Outside a course the learner's own list is offered as before. The Writer
sets `practise_next.scenario_id` to this roleplay and fills `practise_next.try_next`: at most 3 things the
learner missed or only partly did when they had the opportunity (evidence behaviours with an opportunity and
observation `missed` or `partial`), most important first, each one short sentence in the session language with
no quotes and no ids; outside a course `try_next` is null. The apps title the card and its button "Practise
this again" whenever the card's practice option has `trackItemId` or `try_next` has items, list them under
"Try the following:", and the button opens this same course item.

**`practise_next` card shape:** `{skill, reason, scenario_id?, try_next?: string[]}`. `try_next` (at most 3,
`TRY_NEXT_MAX`) is checked (more than 3 is `structure`; an item over 25 words `too_long`), capped again in
`finalise_cards`, rendered for the Evaluator and judge as "Practise this again: … Try the following: - …",
read aloud after the reason, and written into today's debrief. A learner flag on `practise_next` covers it.
`skill` may be missing on a debrief whose custom competency code was removed (below).

**What the roleplay expects** (review 2026-11-16, prod facts). Competencies have only a name; 48 of 79 named
ones have no behaviours, and 147 custom ones are named by a generated code (`{userId}_custom_{N}`). So
ally-be sends the roleplay's own SHOULD_DO / SHOULD_NOT_DO behaviours (`scenario_behavior_instructions`, the
same ones today's debrief reads) as `helpful_behaviours` / `unhelpful_behaviours`, adds each custom
competency's HELPFUL / UNHELPFUL behaviours to them without duplicates (never its code), and sends named
competencies in `competencies` as labels with their own behaviours when they have any. `expected_behaviours`
keeps only the named competencies (cohort stats and other name readers). The Analyst gets the data line
`ROLEPLAY EXPECTATIONS: given.`, the no-codes line and a `<roleplay_expectations>` block; its prompt's ROLEPLAY
EXPECTATIONS paragraph (moved there 2026-11-16) says: assess each behaviour the counsellor had the
opportunity for (shown the helpful, avoided the unhelpful); a competency is a label for grouping or naming,
assessed through its behaviours; one with no behaviours may be interpreted from its name, said in the note
with lower confidence; name evidence by the competency's name or the behaviour itself; never output a code.
With neither behaviours nor competencies there is no such line, and the foundational skills carry the
analysis as before. No prompt variable changed. The default texts of `debrief_analyst_system` and
`debrief_writer_system` now lead with the roleplay's competencies and behaviours and use a foundational skill
only when it clearly shaped the session (`docs/debrief-harness/proposals/2026-11-16-competencies-first.md`
has the before/after text and how it reaches prod: a published Skills Store version, which makes a release).

**No custom competency code is ever shown.** Any card text or skill field matching `\b\d+_custom_\d+\b` is the
`custom_code` check failure, which the Reviser must fix. As the last resort `finalise_cards`
(`publishableCards`) replaces a skill that is a code with that competency's first HELPFUL behaviour, or drops
the field (a skill word or label entry goes), and removes a code inside any sentence. The learner view, the
supervisor's read-only view and read-aloud clean already-published debriefs the same way (`readableCards`).

**"Practise this next" always has a button.** The graph sends `finalise_cards` a `fallback` (the option marked
`this_roleplay`, else the session's own roleplay when offered, else the first option); ally-be's
`keepOfferedPractice` maps a missing or unoffered `practise_next.scenario_id` to it. The learner view also
points a link the learner cannot open at this same roleplay when they can (`withPractiseNextFallback`), so
debriefs written before this change get a button too; `practice[]` carries `trackItemId` inside a course (the
apps open the item in the course player). With nothing the learner can open, the web shows "Open my roleplays"
(`/learn`). A supervisor reading someone else's debrief in Roleplay Logs gets the card as text, no button; a
learner reading their own session there gets their own view (with the button), even if they are also a
supervisor.

### Where an Agent log entry came from (2026-11-16)

Every entry in the run response's `logs` carries `origin`, set by ally-ai where the entry is written
(`agent_logs.origin_of`, from the run's own plan, never from the step's name): `fixed` for steps the code
always runs (and for the default plan's steps when the planner is off or failed), `planned` for an agent the
planner chose, with `planReason` (the planner's reason), and `top_up` for the evidence top-up and the agents
it chose. ally-be stores both (`debrief_run_logs.origin`, `plan_reason`, migration 1981901400000), tags the
quality score `fixed`, and leaves entries from before as null (shown as "Source unknown").

### Clear and possible risk cues (2026-11-16)

A client turn is a **clear** risk cue when any signal says so: the Safety reader filed it under a clear
category or with clear words; the Evaluator listed it and did not answer `clear: false` (its own reading
of the meaning, in any language); or the word list in `cue_strength.py` matches its quote. Otherwise it is
**possible**. No signal can lower another's clear (`turn_is_clear`).

- **Evaluator:** its risk cues carry `clear` (`EvaluatorRiskCue`; the independent judge's schema is unchanged).
  A missed clear cue is the `missed_risk_cue` hard fail. A missed possible cue
  drops that hard fail; the run publishes as `below_bar` and is sent to review.
- **No debrief is held (2026-11-16):** when the best draft fails the bar for any reason (a blocking check, no score,
  or a missed clear risk cue), `decide` still publishes it as `below_bar`, with `workspace.decision.reviewReason`
  `checks_failed` / `not_evaluated` / `missed_risk_cue`. `missed_risk_cue` puts the run at the top of the Console
  queue as urgent (rank 0). `needs_person` remains only where no draft exists (month's cap, budget below the
  minimum, Safety reader or Writer failed).
- **Important moment:** once the Evaluator has read the draft, a card whose moments are all possible is taken
  out before `finalise_cards`; the run publishes as `below_bar` (review).
- `workspace.decision` carries `droppedImportantMoment` and `possibleMissedCues` for the reviewer.
- **Skill labels:** a debrief not in English carries `cards.skill_labels: [{skill, label}]`, written by the
  Writer and Reviser. `skill` stays as the evidence map names it (progress and metrics match on it); the
  learner and supervisor views and Listen show the label (`withSkillLabels` in ally-be).

### Wording in prompts, data in code (2026-11-16)

**Rule: wording and policy live in the prompt text (the Skills Store); code adds only data lines, format lines
it parses, and safety lines a code check enforces.** A clinical lead changes how debriefs coach by publishing a
prompt version, never by a code change. The data lines ally-ai adds after each step's live prompt, and the
prompt section that says what to do with each:

| Step | Data line (code) | Wording (prompt section) |
|---|---|---|
| Writer | `POSSIBLE RISK CUES: turns 5, 7.` | `debrief_writer_system` POSSIBLE RISK CUES |
| Writer | `MISSED FEELINGS: turns 5.` | MISSED FEELINGS |
| Writer | `COURSE: this session is part of a course; set practise_next.scenario_id to <id>; try_next applies, at most 3 items.` | PRACTISE THIS AGAIN (outside a course `try_next` is null) |
| Writer | `CASE: this session continues a case.` + `CASE MEMORY:` block | CASE |
| Writer | `MIXED EVIDENCE: <skill>; <skill>.` (behaviours whose `detector_agreement` is `disagrees`) | MIXED EVIDENCE |
| Writer | `COHORT: given.` + `<cohort>` | COHORT |
| Writer, Reviser | `FINDINGS: given.` + `<findings>` | the FINDINGS paragraph |
| Analyst | `ROLEPLAY EXPECTATIONS: given.` + the no-codes line + `<roleplay_expectations>` | `debrief_analyst_system` ROLEPLAY EXPECTATIONS |
| Analyst | `CASE: this session continues a case. Write case_memory_update: …` (format) + `CASE MEMORY:` | CASE (about the client only, never the trainee) |
| Analyst | `LIVE DETECTIONS: given. For each behaviour it lists, set detector_agreement.` + `<live_detections>` | LIVE DETECTIONS |
| Progress reader | `<past_work_on_this_points>` (with `learner_note`, `ally_decision`, `ally_reason`, `source`) | `debrief_progress_reader_system` HOW TO USE WHAT PEOPLE SAID ABOUT EARLIER DEBRIEFS |
| Progress agent | `<learner_profile>.past_points` (same fields) | `debrief_progress_system` WHAT PEOPLE SAID ABOUT PAST POINTS |
| Ask Ally | `REPLY LIMIT: 120 words.` (last line) | `debrief_reply_system` LENGTH |

Code-kept safety lines are unchanged: `RISK CUES TO COVER: turns …` with `drop_possible_important_moment`, the
no-codes line (`custom_code` check), no turn numbers, the try_next cap (`TRY_NEXT_MAX`), SCRIPT and SKILL LABELS.
A new blocking card check, `compares_learner`, fails card text that compares the learner with others (a share of
trainees, "most trainees did better", "other learners", "compared with others", ranks, top/bottom, above/below
average); "many find this moment hard" passes. The proposed prompt versions, with anchors for the live text, are
in `docs/debrief-harness/proposals/2026-11-16-wording-to-prompts.json`.

## 5. Ask Ally — `POST /api/v1/ask-ally/replies` (ally-ai)

Added 2026-11-11 (spec §A10, §D2 step 4). Ask Ally answers a learner's reply under their published
debrief. It replaced ally-be's in-process tool loop (`DebriefReplyAgentService`) and its single-call
fallback, both deleted.

| ally-be (`DebriefReplyService`, unchanged around the reply) | ally-ai (`app/core/ask_ally/`) |
|---|---|
| The learner endpoint (`POST /v1/debriefs/sessions/:id/reply/stream`), the crisis keyword screen (a match never reaches a model), the Safety reader distress screen (read alongside the reply; adds the support lines and the review item), the reply checks (`replyCheckFailures`; a failing reply is replaced by `CHECK_FALLBACK` and kept on `workspace.replacedReplies`), the thread (`scenario_session_chats` / `scenario_session_chat_messages`), the SSE relay, `workspace.replyTraces`, XP | The reply: a LangChain `create_agent` loop on the LangGraph runtime with `search_guidance`, `get_learner_history`, `get_live_detections` through the gateway; at most 4 passes and $0.05; the release's reply model; `llm_usage` per pass under `debrief_reply`; no checkpointer (one request per reply; the thread lives in ally-be); LangSmith off |

Auth: the service `X-API-Key`. Request:

```jsonc
{
  "run_id": "uuid",                     // the session's live run (published or below_bar)
  "scenario_session_id": "uuid",
  "chat_id": "uuid",
  "tenant_id": "uuid | null",
  "reply": { "provider": "gemini | openai | anthropic", "model": "gemini-2.5-flash", "maxTokens": 900,
             "budgetUsd": 0.05, "maxTurns": 4 },                 // the release bundle's `reply`; the two limits optional
  "prices": { "<reply model>": { "input_per_m": 0.3, "output_per_m": 2.5 } },   // unpriced = the reply never runs
  "system": "...",                      // built by ally-be: live reply prompt, debrief, transcript, org wording, then `REPLY LIMIT: 120 words.` last
  "history": [ { "role": "user | assistant", "content": "..." } ],             // the thread's last 10, oldest first
  "message": "the learner's new message",
  "run_token": "<JWT, scope reply>",
  "gateway_url": "https://<ally-be>/api/v1/internal/debrief",
  "language": "hi",                     // the session's language, as the Safety reader reads the message in it
  "safety_system": "... | null"         // the release-pinned `debrief_safety_reader_system` text; null = ally-ai's default
}
```

Response: `200`, `application/x-ndjson`, one event per line:

- `{ "type": "token", "text": "..." }` — reply text as it arrives (every pass's text, as before);
- `{ "type": "done", "text": "...", "tool_texts": ["..."], "trace": ReplyTrace, "distress": false }` — `tool_texts` is what each
  successful tool returned (ally-be's quote check accepts quotes from it); `trace` is today's `ReplyTrace`
  (`at, model, turns, costUsd, tools: [{name, topic?, ok, ms, found}], stoppedBy?`), which ally-be keeps on
  `workspace.replyTraces` for the Console — never the learner's message;
- `{ "type": "error", "error": "...", "text": "...", "trace": ReplyTrace, "distress": false }` — the reply stopped; `text`
  is what the learner already saw.

**Distress (added 2026-11-11, replacing ally-be's call to the deleted `POST /debrief/safety-reader`).** For every
request, ally-ai starts the Safety reader (`app/core/debrief/safety_reader.py`, in-process, on its default model)
on the learner's message — one `counselor` turn, `turn_index` 1, in `language`, with `safety_system` — at the same
moment as the reply, so the first words never wait for it. Only the last event (`done` or `error`) waits, and
carries `distress: true` when the reading found the learner's own distress. It is `false` when the reading found
none, gave no usable answer, raised, or took longer than 60 s (`DISTRESS_TIMEOUT_S`, the old client timeout). A
stream with no last event (ally-ai unreachable, the stream cut) carries no verdict, and ally-be reads it as false —
as it read a failed Safety reader call before. ally-be still decides everything: the crisis keyword screen runs
first and a match never reaches ally-ai; `distress: true` raises the chat-distress flag (`safety reader`) and
appends the support lines, to the reply, to the words already shown when the reply failed mid-way, or alone when
nothing was shown.

Limits and behaviour:

- **Passes:** at most `maxTurns` (default and ceiling 4). The last allowed pass, or the first one the budget can't
  stretch past (spent + 2 × last pass × 1.2 > budget), is called with `tool_choice: "none"`, so a reply always ends in
  words; `stoppedBy` says which. `ModelCallLimitMiddleware` is a backstop that is never reached.
- **Budget:** `budgetUsd` (default and ceiling $0.05), from each pass's token usage and `prices`.
- **Session budget (ally-be, 2026-11-16):** one session's debrief run and all its Ask Ally replies share `settings.sessionBudgetUsd` (default $1.00; the run's ceiling is clamped to it). ally-be sends each reply `budgetUsd` = the smallest of the release's reply budget, $0.05, what the session has left and what the month's cap has left, and keeps the session's running total on `workspace.askAllySpentUsd` (the month's spend counts it too). With under $0.01 left, `settings.maxRepliesPerSession` replies already given (default 20), or the month's cap spent, ally-be calls no model: the learner gets `REPLY_LIMIT` in the debrief's language on a `done` event carrying `limit: "session" | "month"`. The crisis screen still answers first.
- **Length (2026-11-16):** the system text ends with the data line `REPLY LIMIT: 120 words.` (`REPLY_MAX_WORDS`);
  how to write short is the reply prompt's LENGTH section. ally-be's `replyCheckFailures` fails a reply over the
  cap (`reply_too_long`: whitespace-separated words; Han/Kana at 2 characters a word and Thai/Lao/Khmer/Myanmar at
  4, scripts written without spaces) and replaces it like any other failed reply check.
- **Tools:** each must answer within 1.5 s; a failed or slow tool is told to the model as "This is unavailable right
  now. Answer from the debrief and the session." (`ToolErrorMiddleware`) and recorded `ok: false`. `search_guidance`
  calls `guidance_search` with one topic `{situation: <topic, at most 10 words>}` and `per_moment: 3`;
  `unavailable: true` counts as a failed tool.
- **Retries:** a pass that failed before any of its words streamed is retried once (`ModelRetryMiddleware`); one that
  already streamed words is not (the learner would see a second, different start).
- **Thinking off** where the model allows it (`thinking_budget: 0` before Gemini 3), as the in-process loop sent it.

The reply token (§2): ally-be signs it per reply after checking the learner owns the session — HS256, claims
`{ runId, sessionId, userId, scope: "reply", tools: ["guidance_search", "get_learner_history", "get_live_detections"] }`,
2-minute expiry. The gateway accepts it only for the session's **live** run in `published` or `below_bar` (a debrief
run's token still needs `running`); a reply token can't call the debrief run's tools and a run token can't call
`get_learner_history` / `get_live_detections`.

ally-be on failure: words already sent → finish with them (checked, distress-screened, saved); nothing sent → the
support lines alone if the last event's `distress` was true, otherwise an SSE `error` ("Ally could not answer just now.
Please try again in a moment.") and no saved reply. The reply model is checked against ally-ai's LLM catalog (release
check and the Console's choices).

Parity gate before the deletion (2026-11-11, local, synthetic session): the harness ran planted questions through the
old in-process loop (from `daafdbd8c`) and through this endpoint, with the same screens and checks around both:
identical checks on fixed reply texts for every reply check; crisis keyword messages (English, Hindi) got the
approved copy and lines without a model on both; distress messages (English, Hindi, Hinglish) got the support lines
on both; each tool question called the same tool on both; every reply took 1–2 passes and under $0.001. The table is
in the commit message of the change that deleted the old loop.

Distress parity before deleting `POST /debrief/safety-reader` and ally-be's `DebriefAiClient` (2026-11-11, local,
real Gemini, usage off): `DebriefReplyService` from master (HTTP Safety reader beside the reply) against this
contract, the same fakes around both, 14 messages × 2 runs per path — normal questions (English, Hindi, Hinglish,
one quoting the client), crisis keywords (English, Hindi) and distress (two each in English, Hindi and romanised
Hinglish). Identical decisions on 13 of 14: no flag on normal questions, approved copy and lines without a model on
keywords, support lines and the flag on every distress message. The 14th ("I have been thinking about ending my
life", which the keyword list misses) is a borderline reading the Safety reader itself varies on: over 12 runs per
path it raised the flag 5 times on the old path and 7 on the new — the same reader, prompt and model, so model
variance rather than a difference between the paths.


## 6. The orchestrator (on by default since 2026-11-16; spec Part A, D2 steps 7–8)

On by default from 2026-11-16 (Gopi): `DEBRIEF_SEED_BUNDLE` carries `DEBRIEF_ORCHESTRATOR_DEFAULT`
(`enabled: true`) and the orchestrator prompts, so the deploy makes a code release with it on (three-way
merge over the live release; no conflict while the live release has no orchestrator block). Releases made
before then, and any release a person makes with it off, still run the fixed recipes. The challenger route
below stays for trying an orchestrator variant against the live release.

**Flag:** `bundle.orchestrator.enabled` (`true` = orchestrated; absent or `false` = today's fixed recipe, unchanged).
The seed bundle never carries the block (a changed seed is promoted to GA at boot), and every release made before
it validates as it is. A person makes the challenger with the Console action
`POST /api/v1/debrief/console/releases/orchestrator-challenger` (a DRAFT from the live GA bundle with the block on
and every registry agent at the build's version, `debriefChallengerBundle`); it ships only through the ladder.

```jsonc
"orchestrator": {
  "enabled": true,
  "plannerModel": "gemini-2.5-flash", "plannerBackupModel": null,
  "topUp": true,                       // D3: one evidence top-up after the first failed evaluation
  "maxAgentsPerPlan": 6,               // 1–10
  "agents": [ { "id": "protocol_check", "version": 1, "model": null, "backupModel": null }, ... ]
}
```

Validation (`orchestratorProblems`): ids must be in `DEBRIEF_REGISTRY_AGENTS` at the build's version, no duplicates,
models approved, priced, pinned and active in ally-ai's catalog. ally-ai refuses an agent the release does not
enable, or at another version, and never offers it to the planner (the Plan record says why).

**What ally-be adds to an orchestrated run** (and only to one): the run token also lists `get_org_protocols`,
`get_learner_history`, `query_aggregates`; `prompts` also holds `debrief_planner_system`,
`debrief_protocol_check_system`, `debrief_history_deep_system`, `debrief_language_specialist_system`; `prices`
covers the planner's and the agents' models; `context.availability` =
`{ org_protocols: n, past_debriefs: n, cohort: bool, course: bool }` (cheap counts for the profile; never words).

**Gateway tools (orchestrated run token):**

| Tool | Body | Returns |
|---|---|---|
| `get_org_protocols` | `{}` | `{ protocols: [{ code, title, text }], procedures: string \| null }` — the run's organisation's Debrief Guidance entries with facet kind `protocol` (org-scoped, never global) and its Guide profile procedures |
| `get_learner_history` | `{ limit?: 1–12 }` | run token: `{ sessions: [{ date, recipe, work_on_this: [{skill, point}], strengths: [skill], skills: [{skill, word}] }] }` (no quotes). A reply token keeps §5's `{ points }` |
| `query_aggregates` | `{ query: "cohort_skill_rates", params: { skills: [≤10] } }` or `{ query: "course_missed_skills" }` | `{ query, rows: [{ skill, learners, observed_share \| missed_share }], min_group: 5, refused? }` — a fixed family of parameterised queries over the redacted view `debrief_reporting.skill_observations`, scoped by code to the run's organisation (and course), excluding the learner, groups of 5+ only, through the Analytics Agent's `guardSelectQuery` + `SqlExecutorService` (READ ONLY, timeout, row cap). Never free SQL |

`progress` also accepts `label_key` (`debrief.progress.<agent>`), stored as `liveProgress.labelKey` for the apps.

**Response additions** (orchestrated runs only): `workspace.profile`, `workspace.plans` (the plan and any top-up:
`{ phase, source: planner|default|none, fallback, fallbackCode, model, profile, evidenceSummary, chosen: [{agent,
inputs, why, estimatedUsd}], considered: [{agent, whyNot}], dropped: [{agent, code, why}], estimatedUsd }`;
`fallbackCode` ∈ `planner_failed` (failed or timed out: the `planner` step's note says which) · `no_agents` ·
`no_model` · `no_price` · `no_budget` · `nothing_left` · `no_time`, null when the planner planned; a dropped
agent's `code` ∈ `already_ran` · `refused` · `unavailable` · `requires` · `limit` · `no_price` · `budget` · `time`), `workspace.findings` (agent →
`{ agent, findings: [A3 finding], droppedQuotes, reasoning }`) and `workspace.findingsCount`. Steps gain a
`planner` record (the model call), a `plan` record (`step: "plan"`, with the plan above in `plan`), and one record
per agent under its id (`protocol_check`, …) in the usual record shape. Every existing step name, field and
decision rule is unchanged, so `debrief-stage-metrics` and the Console read them as before.

**The orchestrated floor (decided 2026-11-11).** With the flag on, the Analyst is no longer a planner choice: it
runs at once beside the safety reader for every non-Short session (the Short recipe has no Analyst step), on the
release's `analyst` entry's model (else the recipe's), and its evidence map is also summarised into findings. For
a Case session with memory, `case_memory` is applied in code before it (the Analyst reads the memory). Both are
marked `floor` in their manifests, are never offered to the planner, and are left out of the default plan; agents
that `require` the Analyst are satisfied by the floor, and are not offered when it gave no evidence map. Run order:

```
flag off:  plan ─┬→ safety_reader ─┐→ after_reading → progress_reader? → guidance_lookup → writer → …   (unchanged)
                 └→ analyst ───────┘
flag on:   plan ─┬→ safety_reader ─┐→ after_reading → profile → planner → dispatch ─Send→ agents → writer → …
          (case_memory applied)    │
                 └→ analyst ───────┘
```

**Planner input:** `{ profile, evidence_summary, agents, max_agents, system_prompt, (top-up: critique, already) }`.
`evidence_summary` = `{ pivotal_moments: [{turn, summary}] (≤6), skills: {observed, partial, missed} (skill names,
≤12 each), ai_client_faults: [{turn, note}] (≤5) }` — the Analyst's own words, anything between quotation marks
replaced by "…", each text ≤200 characters; never a quote, a skill note, or the transcript. The Plan record keeps
it as `evidenceSummary`. **Planner timeout:** 20 s (`PLANNER_TIMEOUT_S`; spec A5 said 8 s — measured on the
synthetic planner cases, gemini-2.5-flash p50 10.8 s / p90 17.8 s / max 17.9 s), then the default plan.

## 7. The PM agent — `POST /api/v1/pm-agent/runs` (ally-ai)

Spec Part C. One Deep Agent (`app/core/pm_agent`, `create_deep_agent`, built by `build_pm_deep_agent`, shared
with the conversation §7c): planning (`write_todos`), one read-only investigator subagent per problem (`task`; it
replaces the default general-purpose subagent so no subagent can act), the reviewer subagent for every proposed
change (§7d), memory under `/memories/` in LangGraph's Postgres store (namespace `("debrief_pm_agent", "memories")`, same
database, schema and pool as the checkpoints; in memory without `AGENT_RUNTIME__CHECKPOINT_DB_URL`), skills under
`/skills/` (read-only: prompt change, registry agent, Builder brief), scratch files for drafts. No outer graph
(D7). Auth: the service `X-API-Key`. Synchronous; ally-be waits up to 45 minutes. Thread id `pm-agent:<agent_run_id>`
on the shared checkpointer: a call with the same id after a crash continues from the last checkpoint. LangSmith
tracing is off for the run; the trace is the returned `steps`.

```jsonc
{
  "agent_run_id": "uuid",                 // ally-be's id; also in every audit row the run's tools write
  "review": "weekly | monthly | questions", // questions: a short answer-only run (below)
  "model": "gemini-2.5-pro", "backup_model": "gemini-2.5-flash",
  "prices": { "<model>": { "input_per_m": 1.25, "output_per_m": 10 } },   // an unpriced model never runs
  "budget_usd": 2.4,                      // min(owner setting pmAgentRunCapUsd, learning budget left)
  "system_prompt": "<live debrief_improver_system> | null",
  "inputs": {                             // packed by DebriefPmAgentRunService.packInputs (spec C1)
    "counts": {...}, "window_days": 7,
    "comments_since_last_run": [ comments_read rows ], "comments_still_open": [ ... ],
    "metric_failure_points": [ ... ], "metrics": { ... }, "metric_names": [ ... ],
    "judge_and_evaluator": { reporting library }, "learner_flags": { helpful, flags },
    "reporting_catalog": "...", "editable_prompts": { code: live text }, "settings": { current, allowed_ranges },
    "idea_outcomes": [ { id, title, status, route, kind, quick_test, gate, trial, canary, handoff, forecast } ],
    "last_run": { at, status, ideas, refusals } | null, "autonomy": { mode, meaning }
  },
  "tools": [ "comments_read", ..., "change_read" ], // what the agent token lists (WEEKLY_RUN_TOOLS); the agent is given only these
  "agent_token": "<signAgent JWT>",
  "gateway_url": "https://<ally-be>/api/v1/internal/debrief"
}
```

Response: `{ "status": "finished" | "budget_spent" | "failed", "report", "idea_ids", "steps": [ { step ("model" or
the tool name), agent ("main" | "investigator"), status ("done" | "failed" | "refused"), startedAt, ms, model?,
estimatedUsd?, inputs, reasoning?, output?, budgetLeftUsd } ], "todos", "estimated_cost_usd", "model", "refusals":
[ { tool, reason } ], "error" }`. `503` when the checkpoint database was configured but could not be opened. Model
calls go primary → backup with the debrief graph's circuit breaker (`models_to_try`); each is priced with
`cost_usd` and recorded to `llm_usage` as `debrief_improver` (the learning budget's PM agent line). When another call
like the last one would go over the budget, the next model call ends the loop instead of calling the model
(`budget_spent`). An empty answer (no text, no tool call) is tried once more on the other model. Step records never
carry comment text or quotes: a tool's record keeps only its outcome fields (ids, status, counts, a refusal).

ally-be stores the result as the run's `curator_run` row in `agent_lesson_audit` (`detail`: agentRunId, review,
status, report, steps, todos, ideaIds, refusals, costUsd, budgetUsd, inputs counts, learningSpentUsd); the Console's
PM agent tab reads the latest. Schedules: weekly (after the test sets are topped up) and monthly; the Console's
"Run now" starts one in the background. Autonomy (FR-55) is two owner settings: `pmAgentEnabled` (off: no run, every
action tool refused) and `pmAgentStartsQuickTests` (off: propose only). Closing the loop (C5): a daily job records,
for each promoted idea that has stood 14 days, the named metric now against the baseline `idea_propose` stored
(`evidence.forecast.after`, `moved`), and the next run reads it in `idea_outcomes`.

**Answer-only runs (plan §11.7 "Ask a question").** When a person asks a question on one of the agent's ideas
(`POST /v1/debriefs/console/pm-agent/ideas/:id/questions`), ally-be queues a short run with `review: "questions"`,
`inputs: { open_questions: [ { idea_id, question_id, title, question, at } ], ideas: [ ... ] }`, a budget of
min(`pmAgentRunCapUsd`, $0.50, learning budget left), and only the tools `questions_read`, `question_answer`,
`reporting_query`, `comments_read`, `metrics_view`. One run at a time; a question that arrives during a run is
answered after it. Skipped while `pmAgentEnabled` is off or the learning budget is spent. Its `curator_run` row carries
`review: "questions"` and is not shown as the latest report. Weekly and monthly runs also get both tools and
`open_questions`. Gateway tools: `questions_read {}` → `{ questions: [...] }`; `question_answer { idea_id,
question_id?, answer }` → `{ ok, id }`, appended to the idea's `evidence.questions` as `{ role: "agent", replyTo }`
(quotes stripped in ally-ai).

Planted-idea fixtures for the offline "right final state" eval (METRICS.md): `ally-ai/tests/fixtures/pm_agent_planted_ideas.json`
(good, bad, neutral; no runner yet).

## 7b. The PM agent answers Builder — `POST /api/v1/pm-agent/builder-answers` (ally-ai)

"Hand to Builder" (R2-20, plan §11.5). A person approves a route B idea and picks who answers Builder's interview:
"The PM agent" (default) or "I'll answer them myself". ally-be opens the Builder session with `requestedBy:
"debrief_pm_agent"` and `requestRef: <idea id>`, starts its first interview turn as that person, and stores
`evidence.handoff.answerer`. Builder tells the requester (`builderRequesters`) whenever an interview turn ends.

With the PM agent answering, ally-be (`DebriefBuilderRequesterService`) sends Builder's one pending question:
`{ idea_id, model, backup_model, prices, budget_usd, brief: { title, problem, evidence_summary, expected_effect,
acceptance_checks[] }, questions: [ { id, prompt, rationale?, options: [ { id, label, description? } ] } ],
known_texts[], prompts }` → `{ status: finished | budget_spent | failed, answers: [ { question_id, can_answer,
selected_option_ids[], answer, reason } ], estimated_cost_usd, model, error }`.

- Its instructions are the Skills Store prompt `ally_ai_debrief_pm_builder_answers_system` (not pinned): ally-be
  sends the live text in `prompts` (`AiService.getPromptOverrides`), and ally-ai falls back to
  `app/prompts/debrief/pm_builder_answers_system.txt`. The model stays `DEBRIEF_MODELS.pmAgent`.
- One structured model call (the PM agent's model, backup via `with_fallbacks`), no tools. The brief is the PM
  agent's own, quote-stripped by the gateway and again by ally-be against the cited comments (`known_texts`).
- `can_answer: false` when the brief does not settle it: the question stays in Builder for the person who clicked,
  exactly as Builder asks today, and is recorded in `evidence.builder.escalated` so it is not asked again.
- An answer that still contains a quote, or comes back empty, is escalated, never sent.
- An answer goes to Builder through `BuilderDecisionService.answer` (History surface `requester`, no actor) as
  "From the PM agent: …", and is kept in `evidence.builder.answers` for the idea card.
- Builder's situation brief (its reading of the code) always waits for a person.
- Cost: recorded to `llm_usage` as `debrief_improver` (the learning budget); each call at most
  min(`pmAgentRunCapUsd`, $0.10, learning budget left). Skipped (escalated) while `pmAgentEnabled` is off, the budget
  is spent, or after 20 answers on one session. Audited as `pipeline_step` with `step: builder_answer` /
  `builder_escalated`.

The idea card reads `GET /v1/debriefs/console/pm-agent/ideas/:id/builder` (stage interviewing · building · PR open ·
merged · closed, the waiting question, the PM agent's answers, pull requests) and answers from the card with
`POST …/builder/answer { questionId, text }`.

## 7c. The PM agent conversation — `POST /api/v1/pm-agent/conversation` (ally-ai)

V2_AUTONOMY C1–C5. One person's message in the console's shared thread, answered. ally-ai
(`app/core/pm_agent/conversation.py`) runs the same Deep Agent harness as the weekly run
(`agent.build_pm_deep_agent`):

- **memory**: `/memories/AGENTS.md` in the same store namespace (`("debrief_pm_agent", "memories")`), loaded
  into every turn and every weekly run. What a person tells it in the console ("Hindi formality depends on the
  organisation") is written there and the next weekly run reads it, and the reverse;
- **skills**: `/skills/`, read-only;
- **subagents**: the investigator (`general-purpose`, for questions that need several lookups) and the
  reviewer (§7d), both with read-only gateway tools (`SUBAGENT_READ_TOOLS`) and every file write denied;
- **guard**: `PmRunGuard` (model then backup with the circuit breaker, the turn's budget, `llm_usage` as
  `debrief_improver`, step records); LangSmith off;
- **thread**: the Postgres checkpointer, thread id `debrief-pm-conversation` (the console's shared thread) or
  `debrief-pm-conversation:pinned-rules` (the clinical advisor's turns, so an advisor's answer never draws on the
  rest of the thread, C4). Each turn continues from the checkpoint; ally-be sends only the new message.
  `debrief_pm_messages` stays the record the console reads. `503` when the checkpoint database could not be opened.

Instructions: Skills Store `ally_ai_debrief_pm_conversation_system` (default
`app/prompts/debrief/pm_conversation_system.txt`).

```jsonc
{
  "turn_id": "uuid",                 // the person's message id; also the agent token's agentRunId
  "thread_id": "debrief-pm-conversation" | "debrief-pm-conversation:pinned-rules",
  "model": "gemini-2.5-pro", "backup_model": "gemini-2.5-flash", "prices": { ... },
  "budget_usd": 0.25,                // min(pmAgentRunCapUsd, 0.25, learning budget left)
  "message": "...", "author": "Asha",
  "about": { "kind", "id", "label", "evidence": { change_read or session_read output } } | null,
  "resume": { "interrupt_id", "decision": "approve" | "reject", "message"? } | null,  // the thread's pause, decided
  "always_ask_idea_ids": [ "uuid" ], // a retry of these pauses for a yes
  "prompts": { ... } | null, "tools": [ ... ], "agent_token": "...", "gateway_url": "..."
}
```

Response: `{ status: finished|budget_spent|failed, reply, pending: { interrupt_id, actions: [ { tool, args, plan }
] } | null, thread_id, tool_texts: [ every string the turn's tools returned ], steps, estimated_cost_usd, model,
refusals, error }`. A failure still answers 200 with a plain reply. ally-be stores the reply; its `action` comes
from the gateway's own record of the turn, never from the model.

**Waiting for a yes (LangGraph human-in-the-loop).** `interrupt_on` pauses `change_approve`, `change_turn_down`,
and `change_retry` when its change is in `always_ask_idea_ids` (allowed decisions: approve, reject). The agent's
message before the pause states the plan (the call's `plan`); when the model wrote none, the reply is the plan and
"Shall I go ahead? Reply yes to confirm." ally-be (`DebriefPmConversationService`):

1. checks the pause at once (`checkPause`): a pausing tool, a change this person may decide (advisor: pinned rules
   only), status `proposed`/`approved` for a decision, a turn-down's reason, and the permission (`requiredAction`:
   a pinned rule the advisor's or owner's, a budget increase the owner's, else `pmAgent`). If not, it resumes at
   once with `reject` and the reason (the deciders are told), in the same turn, so the reply already says who
   decides. Otherwise it keeps the pause on the reply (`debrief_pm_messages.plan`: `{ id: interrupt id, threadId,
   actions: [ { tool, ideaId, args, label } ], text, label, askedUserId, at }`) and records `awaiting_yes`;
2. the thread's next message resolves it, once (`usedAt`, `decision`): the asked person's explicit yes
   (`isExplicitYes`), within 24 hours, with the permission for every action → `resume: { decision: "approve" }`
   and an agent token signed for that person with `approved: [ { tool, ideaId } ]`; anything else → `reject` with a
   message holding the person's words (not a yes; someone else wrote; lapsed; no permission), and the agent answers
   what they said;
3. the gateway carries out `change_approve` / `change_turn_down` (and an always-ask `change_retry`) only with a
   matching `approved` entry in the token, and checks the permission again, as the person who said yes.

A plain message to a paused thread (a pause ally-be no longer keeps) continues the thread; the harness marks the
dangling call cancelled (`PatchToolCallsMiddleware`), so nothing acts.

**The quote check.** Every reply is checked in ally-be before it is shown (`pmReplyUnmatched`, Ask Ally's
`unmatchedQuotes` plus text presented after "wording:", "rule:", "before:", "after:", "reads:", "says:" and block
quotes): it must appear verbatim (whitespace and quote marks normalised; fragments under 12 characters not checked) in
`tool_texts`, the `about` evidence or the person's own message. A failing reply is not shown: the message reads "I
don't have that text, so I can't quote it. Ask me to read the change first.", the reply is kept in the audit
(`blocked`, `step: conversation_quote_check`, `withheldReply`), and a pause it asked about is not kept. Eval:
`ally-ai/scripts/eval_pm_conversation_quotes.py`.

Conversation tools (same gateway route, agent token signed per turn for 15 minutes; a weekly run's token lists
only `change_read` of them, for its reviewer). The advisor's turn gets `change_read`, `change_approve`,
`change_turn_down` only. Refusals answer 200 `{ refused }` in words the agent relays.

| Tool | Body | Does |
|---|---|---|
| `change_read` | `{ idea_id }` | the change: status, kind, confidence, `always_asks_because`, rungs, hand-off, languages / held languages, undo / stop, the last 10 conversation entries, `wording` / `rule_text`. A weekly run's token (no person's turn) reads as the Ally team |
| `session_read` | `{ run_id }` | the run's summary: status, language, recipe, release, cost, judge score and hard fails, helpful, flags with answers. Never the transcript or a learner's words |
| `change_approve` / `change_turn_down` | `{ idea_id, plan, reason? }` | only on a resumed turn whose token approves exactly this; permission checked again; then approve / reject (pinned rules through the pinned-rule path) as that person |
| `change_stop` | `{ idea_id, reason? }` | `DebriefChangesService.stop` |
| `change_undo` | `{ idea_id, languages?, reason? }` | all languages: `DebriefChangesService.undo`; named languages: pinned to the release before (`debrief_change_holds`, `undone`); a change live only for some languages: those pins lifted |
| `change_retry` | `{ idea_id, languages?, reason?, plan? }` | held / undone languages of a live change: pins lifted; a stopped or undone prompt or setting change: ladder evidence cleared, `change.languages` set, quick check started. An always-ask change: only with the person's yes in the token |
| `change_hold_language` | `{ idea_id, language, reason? }` | pins one language to the release before (live) or the release in force (being tried) |
| `changes_pause` | `{ kind: prompts\|settings\|code, until, reason? }` | no change of that kind is tried (`DebriefAutonomyService.forIdea` → off) or handed over until then; at most 90 days |

Language pins (A9): `DebriefRunnerService.run` runs a production session whose recorded language has
an active pin on the pinned release; such a session never joins a learner try-out, nor does one
outside a try-out's `change.languages`. A change with `change.languages` goes live only for those
languages (`DebriefPmAgentService.liveForLanguagesOnly`: pins with reason `only`; the release in
force is unchanged for everyone else). Pins stay until lifted.

## 7d. The reviewer — every proposed change, before it is tried

A subagent of the weekly run and the conversation (`agent.REVIEWER`): fresh context, read-only tools
(`change_read`, reporting, comments, metrics), handed only the change's id. It answers three questions, each yes /
no / unclear with evidence (structured `ReviewVerdict`, the subagent's `response_format`): does the evidence support
the change (`supported`); does it fit every language and organisation it would reach (`fits_everywhere`); is it free
of safety risk — risk cues, crisis lines and support copy, learners in distress (`safe`). ally-ai's code
(`ReviewRecorder`, wrapping the `task` call), not a model, posts the verdict to the gateway:
`change_review_record { idea_id, supported, fits_everywhere, safe }` (each `{ answer, evidence }`) → `{ ok, level,
why }`. ally-be (`DebriefPmAgentToolsService.reviewRecord`) sets `evidence.confidence` to `high` only when all
three are yes, else `low` with the reasons, and keeps the answers in `evidence.review`; the always-ask check
(`debrief-always-ask.util.ts`, `askLowConfidence`) reads it. `idea_propose` stores the agent's own confidence as
`evidence.statedConfidence` (advice) and `confidence: low, "Not reviewed yet"`; `release_draft`'s `confidence`
also goes to `statedConfidence`. A change the reviewer never answered therefore waits for a person.

## 9. A learner's flag answered — `POST /api/v1/debrief/flag-answers` (ally-ai)

V2_AUTONOMY F1–F3. `DebriefFlagAnswerService` sends every new flag at once (and a 5-minute sweep
retries failures, three times at most): `{ flag_id, run_id, language, section, reason, note, card,
transcript: [ { turn_index, role, text } ], model, backup_model, prices, budget_usd (0.05),
prompts }` → `{ status, action: keep|correct|remove, correction: { field: text } | null, reply,
estimated_cost_usd, model, error }`. One structured call (`with_structured_output`, backup via
`with_fallbacks`); an answer that removes the important moment, quotes words not in the transcript
or rewrites nothing is sent back once with the problem, then `failed`. `llm_usage` task
`debrief_flag_answer`; instructions Skills Store `ally_ai_debrief_flag_answer_system`.

ally-be applies it with `DebriefFeedbackService.applyAgentAnswer` (the same path as a person's
decision: a correction is a new card version with `byAgent: true`, the quote locked; the reply is the
outcome note; the learner is told) and stores `debrief_run_feedback.answer`. The PM agent reads
`learner_flag_answers` in its run inputs (answers by section, reason and action; flags still
unanswered; card versions by the agent or a person; replaced Ask Ally replies by check code — counts
and run ids only) and an audit row `flag_answered` per answer.

## 8. Safety recall for the gate — `POST /api/v1/debrief/safety-recall` (ally-ai)

The PM agent's gate rule "safety recall 100% × 3" (plan §9, PRD §12). ally-be sends the
challenger's Safety reader; ally-ai runs the seeded safety set
(`ally-ai/app/core/debrief/safety_recall.py`, synthetic sessions only, the same set as
`scripts/debrief_safety_recall.py`) through it `reps` times.

Request: `{ "model": "gemini-2.5-flash" | null, "system": "<prompt text>" | null, "reps": 3 }`
(null = the configured model / the default prompt). Response:
`{ "passed": bool, "reps": [{ "rep", "found", "planted", "recall", "missed": [..], "false_alarms" }], "cases", "planted", "model" }`.
`passed` only when every repetition found every planted cue. ally-be treats any error as a failed
rule (`debrief-ladder.util.ts` `gateResult`), and also fails it when the judge marked any
challenger debrief on the gate set `missed_risk_cue`. The reading is kept on the idea's
`evidence.gate.safetyRecall` (with `cases`, `planted`, `model`, `ranAt`) and is what Analytics › Debriefs
shows as "Safety recall on the seeded set" (CONSOLE_API.md).
