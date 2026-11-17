# PM Agent

An admin feature: an AI product manager that studies Ally's analytics, code, roadmap and strategy and
outputs a feed of at most N (default 5) **cards** — each either one _recommendation_ or one _question_ — for an
admin to accept, reject or redirect. Accepted recommendations are compiled into a Builder session and built,
merged and released. It replaces Analytics → Suggestions.

Design record: plans/ai-product-manager.md (v3) in the parent ally-code workspace, outside this repo. This file is the **contract** between backend and
admin UI plus the operating notes. Ships **off** (`pm_agent_settings.enabled = false`); nothing is spent until an
admin turns it on.

## Principles (do not break)

- Deterministic code owns state, queue, budget, scheduling and **all DB writes**. LLM calls only analyse, inside
  bounded lanes (`maxSteps`, token cap, timeout), return **schema-validated** output through a forced tool call,
  and have **no write tools**. Unparseable output is discarded, never persisted.
- Every claim on a recommendation cites evidence items created **in the same run** (`pm_agent_evidence`).
- Content from learners, tenants, code comments or the web is untrusted data (fenced, never instructions).
  Compiled PRDs/issues/PRs are for a **public repo**: aggregate and anonymised only (no tenant names, user
  content, raw metrics with small groups, secrets).
- Budget is **reserve-before-spend**; cap-full runs exit before any paid call and cost nothing.
- Card state transitions are conditional updates (`UPDATE … WHERE status = :from`); 409 on a lost race.

## Enums

`PmCardKind`: `recommendation | question`
`PmCardCategory`: `ui_ux | product | architecture | code_health | infra | cost | strategy_content`
`PmCardStatus`: `draft | open | accepted_pending | queued | designing | building | pr_open | merged | released |
failed | needs_attention | merged_not_released | handed_off | rejected | feedback_closed | answered | skipped |
expired | superseded`
`PmAgentState` (derived, for the UI): `disabled | idle | running | queue_full | budget_exhausted | paused`
`PmRiskLevel`: `low | medium | high`; `PmCardSize`: `S | M`

## Card payload (jsonb, versioned `schemaVersion: 1`, validated by class-validator + length limits)

Recommendation: `title` (≤12 words, imperative), `whyHeadline` (≤25 words, one cited number), `change[]` (≤3 bullets
≤15 words), `problem`, `plan` { `steps[]`, `files[]`, `acceptanceCriteria[]`, `testPlan[]`, `defaultsChosen[]` },
`size`, `risk`, `riskWhy`, `rollbackNote`, `impactMetric` { `name`, `direction` }, `alternativesDropped[]`,
`repos[]` (each one of `ally-be | ally-web | ally-ai | ally-ai-learn`), `evidenceIds[]`.
Question: `title`, `askedBecause`, `usedFor`, `options[2..4]` { `label` ≤8 words, `consequence`, `suggested?` },
`scope` (`global|feature|tenant`).

## REST (all under `/v1/pm-agent`, `@RequireFeatureToggle(FeatureToggleKey.PM_AGENT)`)

| Method + path                              | Body / query                                                                                                            | Returns                                                                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /state`                               | –                                                                                                                       | `{ agentState, stopReason?, settings, budget:{monthlyBudgetUsd,spentUsd,reservedUsd}, queue:{open,cap,needsYou}, lastRun?, nextRunAt?, autoBuildPaused:boolean }`     |
| `GET /cards`                               | `status?` (csv), `kind?`, `limit?`                                                                                      | `{ cards: Card[] }` ordered for review (needs-you, questions that unblock, then rank)                                                                                 |
| `GET /cards/:id`                           | –                                                                                                                       | `Card` incl. `evidence: Evidence[]`, `events: CardEvent[]`                                                                                                            |
| `POST /cards/:id/accept`                   | `{ path:'builder'\|'download' }`                                                                                        | `Card` (builder: status `accepted_pending`, `undoUntil` = now+10s; download: `handed_off`)                                                                            |
| `POST /cards/:id/undo`                     | –                                                                                                                       | `Card` back to `open` (only while `accepted_pending` and before `undoUntil`; 409 otherwise)                                                                           |
| `POST /cards/:id/reject`                   | `{ reason?: string, reasonChip?: 'not_priority'\|'already_planned'\|'wrong_idea'\|'too_risky'\|'other' }`               | `Card` (`rejected`)                                                                                                                                                   |
| `POST /cards/:id/reason`                   | `{ reasonChip?, reason? }`                                                                                              | `Card` (add/replace reason after a reject within 30 s)                                                                                                                |
| `POST /cards/:id/feedback`                 | `{ text: string, chips?: string[], reviseNow?: boolean }`                                                               | `Card` (`feedback_closed`; creates revision task)                                                                                                                     |
| `POST /cards/:id/answer`                   | `{ optionIndex?: number, customText?: string }`                                                                         | `Card` (`answered`; writes a memory fact)                                                                                                                             |
| `POST /cards/:id/skip`                     | –                                                                                                                       | `Card` (`skipped`; same question not re-asked for 14 days)                                                                                                            |
| `GET /cards/:id/plan.md`                   | –                                                                                                                       | `text/markdown` compiled plan (same text Builder gets)                                                                                                                |
| `GET /tracking`                            | –                                                                                                                       | `{ needsYou: Card[], inProgress: Card[], shipped: Card[], other: Card[] }` with `delivery:{status,prs:[{url,state,ciStatus,merged,releaseState,releaseTag}],costUsd}` |
| `POST /cards/:id/retry`                    | –                                                                                                                       | `Card` (needs_attention/failed → queued)                                                                                                                              |
| `POST /cards/:id/dismiss`                  | –                                                                                                                       | `Card` (leaves needs-you list)                                                                                                                                        |
| `POST /run`                                | –                                                                                                                       | `{ runId, started:boolean, reason? }` run now (respects kill switch, budget, queue cap)                                                                               |
| `GET /runs`                                | `limit?`                                                                                                                | `{ runs: Run[] }`                                                                                                                                                     |
| `GET /settings` · `PATCH /settings`        | `enabled, monthlyBudgetUsd, queueCap(1..10), runHourIst(0..23), mandate, pauseAutoBuild, slackNotify, categoryWeights?` | settings                                                                                                                                                              |
| `GET /memory`                              | –                                                                                                                       | `{ facts: Fact[], lessons: Lesson[] }`                                                                                                                                |
| `PATCH /memory/:id` · `DELETE /memory/:id` | `{ value?, active? }`                                                                                                   | fact                                                                                                                                                                  |
| `GET /history`                             | `limit?`                                                                                                                | cards in `rejected/feedback_closed/answered/skipped/expired`                                                                                                          |
| `GET /health`                              | –                                                                                                                       | `{ acceptRate7d, acceptRate30d, shippedRate, costPerAcceptedCardUsd, spendByLane, repeatedRejectionRate }`                                                            |

`Card` = `{ id, kind, category, status, version, versionHash, title, payload, rank, evidenceFreshness, createdAt,
decidedAt?, decidedBy?, undoUntil?, needsYou?:{reason,actions[]}, delivery?, revisedFromCardId? }`.
Errors: 409 lost race / wrong state, 422 invalid body, 403 toggle off.
Realtime: gateway namespace `/pm-agent` emits `card.updated` `{ cardId }` and `state.updated`; the UI also polls
`GET /state` every 30 s as fallback.

## Run pipeline

`Scheduler (daily, redis lock) → RunGuard (enabled, budget reserve, free slots) → Lanes (analytics, ux_signals,
code_health, infra_cost, strategy_content, revisions) → candidates (≈3× free slots) → deterministic gate
(schema, size, evidence ids, repo/release constraints, secret/PII scrub) → dedupe (open/accepted/rejected cards,
roadmap, bug findings) → critic LLM (rubric) → ranker (impact × evidence ÷ effort, category diversity) →
Persister`. Revisions (pending feedback) run first. Questions appear when context is thin or a candidate is blocked
on missing knowledge.

## Accept → Builder (`path: builder`)

Card → `accepted_pending` (10 s undo window; the outbox row is not due until `undoUntil`) → outbox worker:
`createSession` (userId = accepting admin, no tenantId, `requestedBy: 'pm_agent'`, `requestRef: cardId`) → file roadmap
item + `openSession` → `patchPrd` with the **deterministic compiled PRD** (template of the card's fields; anonymised) →
`updateSession({repos})` → `startDesign` → system auto-approves design → `startBuild`. Builder concurrency full →
`queued` (drain job retries). Status derives from `BuilderSession.status` + `builder_pull_requests`
(`getDeliveryState`). PM-agent sessions run with a **per-session autonomy override** (`auto`: merge + release) in
Builder's `considerAutoMerge` / `considerRelease`; other sessions keep their global settings. Controls: `pauseAutoBuild`
(stops _starting_ builds), circuit breaker (N consecutive failed builds or a failed release health check → auto-pause
until an admin resumes). Cards may only target repos with a release pipeline (not ally-mobile; not `libs/`-only).

## Learning (v1 scope)

Captured from day one: decisions, reason chips, decision latency, outcomes (build/merge/release flags; impact-metric
read-outs are a follow-up). Used now: memory facts and rejection reasons (top-k retrieval per lane), exemplar bank
(nearest accepted-and-shipped / rejected cards as few-shot), per-category lane stats with exploration floor (≥15% of
slots, no category below a minimum share, min 8 decisions before weights move, time decay). Follow-ups (not in v1):
weekly lessons job with eval gate, critic calibration reports, +14/+30 d metric read-outs, one-click revert.

## Tables (migration `1982000000000-CreatePmAgent`)

`pm_agent_settings` (singleton), `pm_agent_runs`, `pm_agent_run_steps`, `pm_agent_cards`, `pm_agent_card_events`,
`pm_agent_evidence`, `pm_agent_memory`, `pm_agent_feedback`, `pm_agent_outbox`, `pm_agent_signals`,
`pm_agent_outcomes`, `pm_agent_lane_stats`. DB-level uniqueness on `outbox(cardId, action)` and
`pm_agent_cards.builderSessionId`; CHECK constraints on enums.

## Registry and prompts

Every model call has a row in `src/llm/constants/ai-task-registry.constants.ts` (CLAUDE.md rule). Prompt codes:
`pm_agent_lane_<lane>` (six) and `pm_agent_critic`, under `src/prompts/pm_agent/`; registry ids
`pm-agent-lane-<lane>` and `pm-agent-critic`, all with usage label `pm_agent`. The ranker is deterministic code, so
there is no `pm_agent_ranker` prompt or row.

## Implementation notes (backend foundations, 2026-11-17)

Code: `src/pm-agent/` (module `PmAgentModule`). Per-table detail: `DATA_SCHEMA.md` §3.23.

Additive to the contract (nothing above was renamed or removed):

- `POST /cards/:id/accept` also takes an optional `versionHash`; when sent and it no longer matches, 409.
- `Card` also carries `reasonChip` and `reason` (needed by History and the reason toast).
- `GET /state` → `settings` additionally returns `autoBuildPaused`, `autoBuildPausedReason`,
  `autoBuildPausedAt`, `updatedAt`. `PATCH /settings` additionally takes `autoBuildPaused: false` to resume
  after the circuit breaker (`true` is refused: only the breaker pauses). Turning `pauseAutoBuild` off does
  NOT clear the breaker.
- `needsYou.actions` values are `retry | open_pr | dismiss` (Revert is a follow-up).
- `POST /run` answers `{ runId, started: true }` (the run continues in the background) or
  `{ runId: null, started: false, reason }` with `reason` one of `disabled`, `already_running`, `budget_exhausted`,
  `queue_full`.
- POST action routes answer **200** (not Nest's default 201).
- `GET /cards` with no `status` returns `open` plus needs-you cards not dismissed. `GET /memory` returns all
  facts/lessons (active and inactive), newest first.

Behaviour worth knowing:

- `agentState` precedence: `disabled > running > budget_exhausted > queue_full > paused > idle`; `paused` means
  auto-build is paused (`pauseAutoBuild` or the breaker) — cards are still generated.
- Budget spent = `llm_usage` rows with task `pm_agent` or `pm_agent_*` since 00:00 IST on the 1st, priced at
  read time with the shared pricing table; `reservedUsd` = open reservations of `running` runs.
- Accept → Builder runs in the outbox worker (30 s drain, advisory lock `(1982000, 1)`, row leases). Steps:
  `create_session → file_roadmap → patch_prd → set_repos → start_design → await_design → start_build`.
  The roadmap item is linked to the PM Agent's session **before** `RoadmapBuilderService.openSession` (which
  would otherwise create its own session without the requester/override); roadmap filing is best-effort and
  uses the first product goal. The design is auto-approved as user 0 (the platform) unless it has open
  decisions. Builder full / switched off / `pauseAutoBuild` / breaker → the row parks (`waiting`, 5 min) and
  the card stays `queued`/`designing`. Builder refusals (PRD review not passed, design failed) →
  `needs_attention` with Builder's reason; Retry resumes at the step it stopped.
- Status reconcile (shared 5-min tick) maps `BuilderSession.status` + `builder_pull_requests` rows; `failed` and
  `needs_attention` are re-read too, so a card recovers when Builder does.
- Circuit breaker: 3 consecutive failed builds (only transitions this tick won are counted) or a PR whose release
  is `unhealthy` → `autoBuildPaused`, one Slack message if `slackNotify`.
- Per-session autonomy override: `builder_sessions.autonomyOverride` (`auto` for `requestedBy = 'pm_agent'`).
  `BuilderPullRequestService.settingsForSession` applies it to **review, fix, approve, merge and release** (not
  only merge/release — without auto-review no review ever passes on the head, so nothing could merge). The global
  kill switch, CI green, review-passed-on-head, `mergeable_state = clean`, nothing actionable, and the release
  health hold are unchanged. An unreadable override falls back to the global settings.
- The `pm_agent` Builder requester's `turnEnded` deliberately does nothing (PM Agent sessions do not interview).
- Card payloads are validated by `validateCardPayload` (`dto/pm-card-payload.dto.ts`); unknown keys are rejected.
- Compiled PRD / plan.md: `util/compile-plan.ts` (deterministic) + `util/scrub.util.ts` (tenant names from
  `tenants`, emails, phones, tokens/keys, internal hosts, URLs with query strings, UUIDs, IPs, long quotes).
  Evidence snapshots are never included, only the evidence count.
- Not built yet (later phases): lessons job, critic calibration, impact read-outs, revert, shadow mode.
  (Impact read-outs: since built, see "Implementation notes (impact checks)".)

## Implementation notes (generation pipeline, 2026-11-17)

Code: `src/pm-agent/pipeline/` (orchestrator, model port, store), `lane/` (definitions, tool belt, runner),
`gate/` (deterministic + dedupe, critic, ranker), `learning/` (lane selection, memory/exemplar retrieval). No new
tables. `PmRunPipeline` is framework-free (ports: `PmLlmPort`, `PmToolbox`, `PmPipelineStore`); `PmAgentRunService`
wires it to Nest and provides `PM_AGENT_RUN_TRIGGER`.

Run order: RunGuard → revisions → lane selection (+ degradation) → lanes → gate 1 → gate 2 → critic → ranker →
Persister.

- **RunGuard** (`PmRunPipeline.start`): `enabled` → no `running` row → free slots (`queueCap` − `open` cards; nothing
  else counts) → run cap = min(monthly − (spent + open reservations), monthly ÷ 20). A cap under $0.02 is
  `budget_exhausted` and nothing is called. Skips are recorded as `skipped` runs with `stopReason`
  (`disabled` only for manual runs, `queue_full`, `budget`); `already_running` records nothing. The run row's
  `reservedUsd` is its cap (counted in `GET /state` while it runs); `spentUsd` is updated after every lane.
- **Stop reasons** on a finished run: `queue_full` (slots filled), `budget`, `timeout` (20 min run clock),
  `no_candidates`, `error` (run `failed`), `abandoned` (a `running` row older than 45 min, failed by the scheduler);
  `null` when it ran normally with slots left.
- **Scheduler** (`PmAgentRunSchedulerService`): a 10-minute tick under advisory lock `(1982000, 2)` runs once per IST
  date when the IST hour ≥ `runHourIst` and no `scheduled` run (or skip) exists for the date. Run now is
  `trigger=manual`; Revise now is `trigger=revision`, the revisions lane only, for that feedback row.
- **Budget** (`src/pm-agent/util/run-ledger.ts`): every model pass reserves its worst case (prompt chars ÷ 3 + tool overhead at the
  input rate, `maxTokens` at the output rate; unknown models at $5/$25 per 1M) before calling, then settles to the
  actual. Caps: run; the critic's 20% held back from lanes; per lane (max(1/n, 50%) of the lane budget); per call
  4,000 (lane) / 3,000 (critic) output tokens; 6 passes per lane; 90 s per call; 4 min per lane. Degradation is decided
  before spending (`src/pm-agent/pipeline/pm-degrade.ts`): drop lowest-weight lanes → FAST-tier model → half the candidates → stop.
- **Models** (`src/pm-agent/pipeline/pm-agent-llm.service.ts`): the prompt row's model in Skills Store, else the REASONING tier; a
  provider with no key here uses the tier model; a failing call (401/403/404/408/429/5xx, socket) retries once on the
  tier model over OpenAI. Each call writes one `llm_usage` row (task `pm_agent`, metadata `runId`, `lane`,
  `promptCode`) and one `pm_agent_run_steps` row (prompt version pinned, tool calls, cost, reservation, outcome).
  Shared context (mandate, Vision & strategy page, product map) is one `cache: true` system block.
- **Lanes**: `analytics`, `ux_signals` (skipped when `pm_agent_signals` has nothing from the last 45 days),
  `code_health`, `infra_cost`, `strategy_content`, `revisions`. Each = its prompt + an allow-list of read-only tools
  (`src/pm-agent/lane/pm-lane-definitions.ts`). Tools: `analytics_section` (the 15 AnalyticsModule aggregates, compacted),
  `ux_signals_list` (`pm_agent_signals` only — UX Signals internals are not imported), `llm_usage_summary`,
  `ai_task_registry`, `product_goals`, and the roadmap copilot's read tools (roadmap, interviews, Bug Hunter findings,
  docs, GitHub code, wiki) resolved lazily from `RoadmapCopilotToolsService`. Left out: `analytics_ask` (a second
  billed agent), Context Library principles (attributed to the copilot), the AWS logs proxy (`LogsService` is not
  exported for this). Every tool call records `pm_agent_evidence` rows as it fetches; results are fenced as
  `<tool_data … trust="untrusted-data">` with tag-like sequences neutralised. A tool outside the allow-list is
  refused without running.
- **Lane output**: one `submit_candidates` call (it is the only tool on the final pass; current Claude models reject
  a forced `tool_choice`). Each candidate is validated by `validateCardPayload` plus "every evidence id was returned
  in this run"; invalid ones are sent back once (valid ones kept), then discarded. Cut-off (`max_tokens`) passes are
  ignored. Revisions: one successor per pending feedback row, category forced to the original's, `revisedFromCardId`
  set; feedback goes `pending → in_progress → done` (with `successorCardId`), back to `pending` only when the lane
  could not run (budget, provider, clock), `cancelled` after 14 days.
- **Gate 1** (`src/pm-agent/gate/pm-gate.ts`): payload contract, evidence from this run, repos with a release pipeline, not
  `libs/`-only, no `ally-mobile`; any string the public-repo scrubber would change fails the candidate (dropped, not
  edited); instruction-shaped text fails. Skipped question keys are suppressed for 14 days.
- **Gate 2**: token-Jaccard / containment / trigram similarity ≥ 0.6 against cards (open, accepted, in progress,
  shipped, answered), roadmap opportunities (new → released, latest 400), open Bug Hunter findings, and within the
  batch. A near-duplicate of a rejected card passes only if it cites evidence with a source/label the rejected card
  did not. A revision never matches its own original.
- **Gate 3 (critic)**: one `pm_agent_critic` call over the best 12, rubric `grounded, scoped, no_open_decisions,
  sensible_defaults, consistent_with_memory_and_strategy, buildable, honest_risk`, answered via `submit_verdicts`.
  Fail-closed: no verdict, budget or provider failure → nothing passes. A `missingKnowledge` verdict becomes a
  question candidate (layers 1–2 again).
- **Ranker** (`src/pm-agent/gate/pm-ranker.ts`): impact (category weight × risk × named metric) × evidence strength (sources,
  items, age) ÷ effort (S 1, M 1.6); greedy with diversity (each card already chosen in a category halves the next;
  no category above 60% of slots) and a question cap (⌊slots ÷ 3⌋, min 1, once memory holds ≥ 10 active facts).
- **Persister** (`PmAgentPipelineStore.persistCard`, the only card writer): one transaction under advisory xact lock
  `(1982000, 3)`: skip if the version hash exists in this run or among open cards; stop at the cap; insert the card
  (`open`, `openedAt`, `versionHash`, `questionKey`, `rank`, `evidenceFreshness`, version = original + 1 for a
  revision) and a `created` event whose `detail.lane` is what lane learning reads; mark cited UX signals `used`.
  Then `card.updated`/`state.updated`.
- **Learning**: each run recomputes per-category and per-lane scores from `pm_agent_outcomes` (180-day lookback,
  30-day half-life; accepted = +1, shipped +1.5, failed/reverted/rejected = −1, feedback = +0.25/−0.75; questions
  excluded) into `pm_agent_lane_stats.decayedScore`, and bumps `shown` per category and lane when a card is created
  (the card service already bumps accepted/rejected/feedback per category). Lane selection: lanes whose categories
  are all weighted 0 never run; a lane absent from the last 10 runs is forced in; ≥ 15% of slots (≥ 1) explore
  uniformly; the rest by a Thompson-style draw (only after 8 decisions) × mandate weight × a coverage boost.
  Memory: top 8 active facts per lane by keyword relevance (answers/manual boosted). Exemplars: 2 nearest
  shipped-and-merged and 2 nearest rejected/reverted cards by text similarity, fenced as data.

## Contract addendum: impact checks and weekly lessons (v1.1)

### Impact checks (+14 / +30 days)
- A recommendation payload gains an optional `metricRef` (schemaVersion stays 1; additive): `{ source: <catalog key>, params?: object, unit?: 'percent'|'count'|'ms'|'usd'|'ratio', betterWhen: 'up'|'down' }`. `source` must be a key of the **measurable-metric catalog** (`src/pm-agent/impact/metric-catalog.ts`): a closed allow-list of read-only Analytics services / aggregates that can be read as one number for a window. Lanes are told the catalog and may pick one; a card without a valid `metricRef` is shown as "impact not measurable". `impactMetric { name, direction }` stays as the human label.
- When a card's delivery reaches `released` (reconcile job), the baseline is captured (the metric read over the 14 days **before** release), stored in `pm_agent_outcomes` (new migration adds columns / rows kind `impact`), and two reads are scheduled at release + 14 d and + 30 d (each read covers the 14 days ending then). A daily job performs due reads; reads are metered (no LLM) and never throw into the pipeline.
- Verdict per read: `improved | flat | worse` using `betterWhen` and a minimum relative change (default 3%) plus a minimum-sample guard (`insufficient_data` if the window has too little volume); `not_measurable` / `unavailable` are terminal statuses.
- `Card.delivery.impact` (in `GET /tracking`, `GET /cards/:id`): `{ metricName, direction, unit?, baseline?: number, checks: [{ day: 14|30, status: 'pending'|'measured'|'insufficient_data'|'unavailable', value?: number, readAt?: string, dueAt: string, verdict?: 'improved'|'flat'|'worse' }], summary?: string }` where `summary` is plain text like `Next-day return: 38% to 44% (improved)`; absent when no `metricRef`.
- Learning: a measured `improved` read at +14 d adds +1 to the card's category/lane score (and marks the exemplar positive-effective); `worse` adds −1 and marks it a negative exemplar; `flat`/`insufficient_data` are 0.
- `GET /health` adds `impactMeasuredCount`, `impactImprovedRate`.

### Weekly lessons
- Lessons are `pm_agent_memory` rows with `kind='lesson'` (no new table). Shape returned in `GET /memory` → `lessons: Lesson[]`: `{ id, text, scope: 'global'|'category'|'lane', category?, status: 'proposed'|'active'|'expired'|'removed', source: 'weekly_job'|'manual', supportCount, supportRatio, evidenceCardIds[], evalResult?: { passed: boolean, agreementBefore: number, agreementAfter: number, sampleSize: number }, requiresConfirm: boolean, createdAt, lastSupportedAt, expiresAt }`.
- A weekly job (daily scheduler tick on the configured weekday, advisory lock) reads the last 90 days of decisions + outcomes + reasons, asks a reflection prompt (`pm_agent_lessons`) for candidate lessons, validates each against the data in code (minimum 5 supporting decisions and ≥ 75% consistency, else dropped), and runs the **eval gate**: replay the critic over up to 20 past decided cards with the lesson added to its rubric and require agreement with the admin's real decisions not to decrease (reserve-before-spend, counts toward the budget; a budget shortfall leaves the lesson `proposed`, never active). Lessons that pass auto-activate **unless** `requiresConfirm` (any lesson that forbids or de-prioritises a whole category, changes the mandate, or concerns risk/size limits): those stay `proposed` until an admin confirms.
- Active lessons are injected (fenced as guidance, never instructions) into lane prompts via memory top-k and into the critic rubric context. A lesson expires (`expired`) 60 days after `lastSupportedAt` unless re-supported by the next weekly run.
- Endpoints (same base): `POST /lessons/:id/confirm` (proposed → active, 409 otherwise), `PATCH /memory/:id` `{ value?, active? }` (existing; editing a lesson's text re-marks `source:'manual'`, keeps it active), `DELETE /memory/:id` (existing → `removed`), `POST /lessons/run` (run the weekly job now; returns `{ started, reason? }`; respects kill switch/budget). Settings gains `lessonsEnabled` (default true) and `lessonsWeekday` (0–6, default 1 = Monday).
- `GET /health` adds `activeLessons`, `proposedLessons`, `lessonAgreementDelta`.

## Implementation notes (impact checks, 2026-11-17)

Code: `src/pm-agent/impact/` — `metric-catalog.ts` (the catalog, `metricRef` validation, `readMetric`),
`impact-verdict.ts` (windows, verdict, formatting, tunables `PM_IMPACT`), `pm-agent-impact.service.ts`,
`pm-agent-impact.scheduler.ts`, `pm-impact.store.ts`, `pm-metric-sources.service.ts`. Migration
`1982000000500-PmAgentImpactOutcomes`; table detail in `DATA_SCHEMA.md` §3.23. No model call anywhere, so no
AI task registry row.

- **Catalog** (closed; platform-wide, never a tenantId; each a windowed summary figure of an existing
  AnalyticsModule service): `roleplay_completion_rate` (%, completion rate), `returning_user_rate` (%, overview
  retention), `active_users`, `simulations_completed` (counts, overview), `roleplay_median_quality` (median judge
  composite, score distribution), `learner_avg_rating` (1–5), `coaching_share_rate` (%, coaching loop),
  `scribe_sessions` (count), `voice_latency_p95_ms` (ms, better down), `llm_cost_usd` (`params.task` optional) and
  `llm_cost_per_call_usd` (`params.task` required, an `LlmTask` value), both from `llm_usage` priced with the shared
  table. Left out: activation rate and the six all-time sections (the window does not move them). Each entry has a
  `minSample` (10–200) on the volume behind the number.
- **`metricRef`**: validated by `validateCardPayload` (so gate layer 1 and the lane repair pass reject an unknown
  source, unknown/missing params, a unit other than the entry's, or a bad `betterWhen`). The lanes see the catalog
  as a code-appended context block (not a template variable), and the lane `.txt` defaults gained one rule line.
  `plan.md` / the PRD state the measured metric ("Measured after release: …") or "Not automatically measured".
- **Rows**: at the reconcile transition to `released`, `onReleased` inserts (insert-if-missing on UNIQUE
  (`cardId`,`kind`,`day`), so a second call is a no-op) day 0 / 14 / 30 `impact` rows and reads the baseline at
  once. Release time = the latest `builder_pull_requests.releasedAt` (now if unrecorded). Windows are whole UTC
  days, both ends inclusive: baseline = the 14 days before the release day; +d = the 14 days ending on release
  day + d, due at the start of the next day (so the release day itself is in no window). A card whose
  `metricRef` no longer validates gets `not_measurable` rows; a card without one gets none.
- **Daily job** (`PmAgentImpactScheduler`, 04:00 IST, advisory lock `(1982000, 5)`, one pass of ≤ 200 due rows,
  runs even when the agent is off — it spends nothing): baseline before checks; a check waits while its baseline
  is `pending` and becomes `unavailable` when the baseline is terminal. A failed or timed-out read (60 s) stays
  `pending` with `attempts`/`lastError` and is retried the next day; the third failure is terminal `unavailable`.
  Verdict: `insufficient_data` when either side has no value or is under the entry's `minSample` (the value is
  still stored); else |relative change| < 3% → `flat`, otherwise `improved`/`worse` by `betterWhen` (exactly 3%
  counts; a zero baseline judges by sign). Each read emits `card.updated` and mirrors the value onto the
  decision row's `baselineValue`/`value14d`/`value30d`.
- **API**: `delivery.impact` is added by the presenter wherever a card is presented with a delivery (so also
  `GET /cards`), exactly the contract shape; `not_measurable` rows are presented as `unavailable`; `baseline` is
  present once the baseline read has a value; `summary` comes from the latest read check with a value
  (`… (not enough data)` for `insufficient_data`) and is absent before that. A measurable card not yet released
  has `checks: []`. `GET /health` adds `impactMeasuredCount` (measured +14 d checks) and `impactImprovedRate`
  (improved ÷ measured, null at 0).
- **Learning**: `PmOutcomeRow.impactVerdict` = the measured +14 d verdict. Lane/category scores: improved adds
  +1 (positive), worse adds −1 (negative) on top of the shipped credit. Exemplars: positive requires merged AND
  not worse; worse makes it a negative exemplar. **Anything reading decisions from `pm_agent_outcomes` must filter
  `kind = 'decision'`** (the pipeline store does).

## Implementation notes (lessons, 2026-11-17)

Code: `src/pm-agent/lessons/` (job `pm-lessons-job.ts`, framework-free behind `PmLessonsStore` and `PmLlmPort`;
deterministic checks `pm-lesson-data.ts`; eval gate `pm-lesson-eval.ts`; prompt injection `pm-lessons-context.ts`;
admin patches and the `Lesson` shape `pm-lesson-admin.ts`; Nest wiring `pm-lessons.service.ts`,
`pm-lessons.controller.ts`, `pm-lessons.store.ts`). Migration `1982000000600-AddPmAgentLessons` adds lesson-only
columns to `pm_agent_memory`, widens its `scope` (`category`, `lane`) and `source` (`weekly_job`) CHECKs, and adds
`lessonsEnabled`, `lessonsWeekday`, `lessonsLastRunDate`, `lessonsLastRun` to the settings. Prompt
`pm_agent_lessons` (`src/prompts/pm_agent/lessons.txt`), registry row `pm-agent-lessons`.

- **Schedule**: `PmAgentLessonsScheduler` ticks on the run scheduler's 10-minute cadence (its own cron, not the run
  tick) and runs once per IST date when the IST weekday is `lessonsWeekday` and the IST hour ≥ `runHourIst`, while
  `enabled && lessonsEnabled`. The date is claimed (`lessonsLastRunDate`, conditional update) before the job runs, so a
  budget-skipped or failed week is not retried every tick. One job at a time: advisory lock `(1982000, 6)` on a
  dedicated connection, for scheduled and manual runs alike. `POST /lessons/run` answers `{ started: true }` (the job
  continues in the background, then `state.updated`) or `{ started: false, reason }` with `reason` one of
  `disabled`, `lessons_disabled`, `already_running`, `budget_exhausted`. The last job's counts land in
  `pm_agent_settings.lessonsLastRun` (not exposed in the API yet).
- **Budget**: the job cap is the run-cap formula (min(month left, monthly ÷ 20)); under $0.02 → `budget_exhausted`
  with no call. A ledger holds 60% of the cap back for the eval gate; every call reserves its worst case first
  (`PmAgentLlmService`), writes `llm_usage` (task `pm_agent`, metadata `lane: 'lessons'`), and writes **no**
  `pm_agent_run_steps` row (`noTrace`): the job has no `pm_agent_runs` row and must not take the card run's
  one-running slot. Consequence: lessons spend is in the month's budget and `GET /state` spend, but not in
  `GET /health` `spendByLane`, and a card run started while the job runs does not see the job's open reservation.
- **Data pack**: last 90 days of `pm_agent_outcomes` joined to cards, recommendations accepted / handed off /
  rejected / feedback only (questions excluded). Each card is `c1…cN` with category, lane, size, risk, ≤ 6 scrubbed
  title words, decision, reason **chip** (never the free-text reason), feedback chips, outcome flags and an impact
  verdict when the impact checks recorded one (any `*verdict*` field in the outcome row; +14 d preferred; tolerated
  absent). Fenced as `<tool_data … trust="untrusted-data">`, neutralised. Fewer than 5 eligible decisions →
  `not_enough_decisions`, no call.
- **Reflection** (`submit_lessons`, only tool, 3,000 output tokens): each lesson is `{ text, expects: accept|reject,
  predicate: { categories?, lanes?, sizes?, risks?, words? }, citedRefs? }`. Unknown fields (a model-declared
  `requiresConfirm`, say), instruction-shaped text, markup, anything the public scrubber would change and empty
  predicates fail; one repair pass for the failures (valid ones kept), then discarded.
- **Validation in code**: support is recomputed from the rows matching the predicate — supporting = accepted and not
  build-failed / reverted / impact `worse` (for `accept`), or rejected / feedback / accepted-but-went-wrong (for
  `reject`). Kept only with ≥ 5 supporting and ≥ 75% of the matching rows. Scope is derived (one category →
  `category`, one lane → `lane`, else `global`). Dedupe (text similarity ≥ 0.6 or the same predicate signature): a
  fact → dropped; a `removed` lesson → dropped (an admin's removal sticks); an `active`/`proposed` lesson →
  **re-supported** in place (`lastSupportedAt`, support, evidence, `expiresAt` = +60 d; no re-eval); an `expired` one is
  re-evaluated and revived in place. `requiresConfirm` is a keyword + category check: sizes/risks in the predicate,
  risk/size or mandate/strategy/priority words in the text, a `reject` lesson that narrows only by category/lane, or
  forbidding words with a whole-category scope or a category name in the text.
- **Eval gate**: the real critic (its prompt, model and fail-closed parsing) is replayed over up to 20 past decided
  recommendations (≤ 10 accepted + ≤ 10 declined, topped up from the larger side) with their stored evidence: one
  baseline call with the current active lessons, then one call per candidate with it added. Agreement = critic pass
  ⇔ the admin accepted (a missing verdict is a fail). Passed = `after ≥ before` with `sampleSize ≥ 8`. Fewer than 8
  replayable cards, a critic failure, or no budget → no `evalResult` → `proposed`. Pass + not `requiresConfirm` →
  `active`; pass + `requiresConfirm` → `proposed`; fail → nothing stored.
- **Expiry**: at the end of every job (also a skipped one), `weekly_job` lessons that are `active`/`proposed` and
  not re-supported for 60 days → `expired`. Lessons an admin edited (`source: manual`) never expire.
- **Use**: `isActiveLesson` (status `active`, `active`, unexpired). Lanes get global lessons plus those scoped to the
  lane or one of its categories (scoped first, then support × consistency), the critic gets all active ones; at most 8
  per prompt, fenced as `<memory kind="lesson">` under a header that says the rules, rubric and hard limits win. The
  deterministic gates never read lessons.
- **Admin actions** (no card exists, so the audit is the row's `lessonEvents` jsonb, not `pm_agent_card_events`):
  `POST /lessons/:id/confirm` is a conditional `proposed → active` (409 otherwise, 404 unknown; `expiresAt` = +60 d).
  `PATCH /memory/:id` on a lesson: `value` → `source: manual`, `active`, no expiry (409 on a `removed` lesson unless
  `active: true` is sent too); `active: false` → `removed`; `active: true` → `active`. `DELETE /memory/:id` on a lesson
  → `removed` (soft). Every change emits `state.updated`. PATCH/DELETE on a lesson answer the `Lesson` shape.
- **Settings**: `lessonsEnabled`, `lessonsWeekday` (whole number 0–6) in `GET`/`PATCH /settings` (and `GET /state`).
- **Health**: `activeLessons`, `proposedLessons`, `lessonAgreementDelta` (mean `agreementAfter − agreementBefore` over
  active lessons with an eval, 3 dp; null when none).
