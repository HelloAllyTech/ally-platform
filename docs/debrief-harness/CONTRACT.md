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
  "prices": { "<model>": { "input_per_m": 0.3, "output_per_m": 2.5 } },      // for every model the bundle names; unpriced = cannot run
  "session": {                                                              // DebriefSessionContext as ally-be loads it today
    "tenant_id": "...", "language": "en-IN", "language_source": "recorded | null", "language_recorded": true,
    "learner_turns": 12, "assessment": false, "in_case": false, "scenario_id": 41, "...": "..."
  },
  "transcript": [ { "turn_index": 0, "role": "counselor | client", "text": "...", "message_id": "..." } ],
  "context": {
    "live_detections": [ ... ],      // [] when unreadable
    "past_work_on_this": [ ... ],    // progress reader input
    "cohort": { ... } | null,
    "case_memory": { ... } | null,
    "practice_options": [ { "id": 41, "title": "...", "skills": [...] } ]
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
| `idea_propose` | `{ "problem": { title, summary, comment_ids[], metrics: [ { name, value, segment? } ] }, "route": "A"\|"B"\|"C"\|"D", "title", "hypothesis", "expected_effect": { metric, direction: "up"\|"down", by?, note? } }` | `{ idea_id, route, linked_comments, unknown_comment_ids, baseline: { metric, value }, next }` — writes an `agent_lessons` idea (`change.route`, `change.ideaKind` = `route_a` / `needs_code` / `defect` / `needs_person`; `evidence.problem`, `commentIds`, `metrics`, `forecast` with the named metric's value now), links the cited comments (`DebriefReviewService.linkIdea`). Refused: no evidence (no existing comment id and no metric), a metric not in `PM_AGENT_METRICS`, more than 5 ideas in one run, a duplicate, autonomy off |
| `release_draft` | `{ "idea_id", "kind": "prompt_edit"\|"setting"\|"registry_agent", prompt_code/find/replace \| setting_key/setting_value \| agent: { id, description, use_when, skip_when, prompt, tools[], scopes[], eval_cases, model? } }` | `{ ok, idea_id, kind, next }` — route A only; draft only (nothing reaches learners). Refused: the never-list (C4: the rubric and judge prompts, the Safety reader, the PM agent's own instructions, budgets, `passScore`, every owner setting), prompts outside `PM_AGENT_EDITABLE_PROMPTS` (orchestrator prompts only while GA runs the orchestrator), a `find` not exactly once in the live text, a change to `{variables}`, settings outside `PM_AGENT_SETTINGS` ranges, a change that does not apply to GA or fails bundle validation; FR-53 for registry agents (registered tools and A2 scopes only, ≥ 10 eval cases, ≤ 10 experimental, approved model). Registry agents are stored as drafts: the build defines the agents a release can enable, so they are not tested yet |
| `ladder_start_quick_test` | `{ "idea_id" }` | `{ status: "running", startedAt, note }` — requests `DebriefPmAgentService.screen` (the deterministic ladder: quick test → gate → paired trials → canary watch; a person starts the canary and promotes). Refused: autonomy `propose_only` (a person starts it in the Console) or `off`, no drafted change, a registry agent, the learning budget spent, a quick test already running |
| `builder_handoff` | `{ "idea_id", "problem", "evidence_summary", "expected_effect", "acceptance_checks": [ … ] }` | `{ ok, idea_id, waiting_for, quotes_removed }` — route B. Quotes and the cited comments' text (bodies, quoted spans, replies) are stripped here as well as in ally-ai; a brief that asks to change something on the never-list is refused (route D). Stored as `evidence.handoff` (`status: "waiting"`); a person's Approve in the Console opens the Builder session with it as `handoffContext` |
| `bug_hunter_report` | `{ "idea_id", "summary", "run_ids": [uuid], "repo"? }` | `{ ok, idea_id, waiting_for, quotes_removed }` — route C, same stripping and never-list check; Approve files it through `RoadmapOpportunityService.createBugReport` (a Bug Hunter reported bug) with the summary and the run ids that exist |
| `person_ask` | `{ "idea_id", "topic": "rubric"\|"safety"\|"budget"\|"data_access"\|"clinical"\|"product"\|"other", "question", "context"? }` | `{ ok, idea_id, waiting_for }` — route D: a Console item for the owner (or the clinical advisor for clinical and safety); Approve marks it answered |

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
   ({title, description}), expected_behaviours, assessment, in_case`.
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
  "system": "...",                      // built by ally-be: live reply prompt, debrief, transcript, org wording, length rule
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


## 6. The orchestrator (challenger releases only; spec Part A, D2 steps 7–8)

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

Spec Part C. One Deep Agent (`app/core/pm_agent`, `create_deep_agent`): planning (`write_todos`), one read-only
investigator subagent per problem (`task`; it replaces the default general-purpose subagent so no subagent can
act), memory under `/memories/` in LangGraph's Postgres store (namespace `("debrief_pm_agent", "memories")`, same
database, schema and pool as the checkpoints; in memory without `AGENT_RUNTIME__CHECKPOINT_DB_URL`), skills under
`/skills/` (read-only: prompt change, registry agent, Builder brief), scratch files for drafts. No outer graph
(D7). Auth: the service `X-API-Key`. Synchronous; ally-be waits up to 45 minutes. Thread id `pm-agent:<agent_run_id>`
on the shared checkpointer: a call with the same id after a crash continues from the last checkpoint. LangSmith
tracing is off for the run; the trace is the returned `steps`.

```jsonc
{
  "agent_run_id": "uuid",                 // ally-be's id; also in every audit row the run's tools write
  "review": "weekly | monthly",
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
  "tools": [ "comments_read", ... ],      // what the agent token lists; the agent is given only these
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

Planted-idea fixtures for the offline "right final state" eval (METRICS.md): `ally-ai/tests/fixtures/pm_agent_planted_ideas.json`
(good, bad, neutral; no runner yet).
