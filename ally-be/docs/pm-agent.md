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
`pm_agent_lane_<lane>`, `pm_agent_critic`, `pm_agent_ranker`, under `src/prompts/pm_agent/`.

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
- `POST /run` answers `{ runId: null, started: false, reason }` with `reason` one of `disabled`,
  `already_running`, `budget_exhausted`, `queue_full`, or `pipeline_unavailable` until the generation pipeline
  provides `PM_AGENT_RUN_TRIGGER` (default provider is a no-op).
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
- Not built here (pipeline / later phases): lanes, critic, ranker, daily scheduler, budget reservation,
  exemplars, lessons job, impact read-outs, revert.
