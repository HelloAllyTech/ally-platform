# Design: `EVENTS_OFF_GATE` — take non-branching event work off the voice critical path

**Status:** Proposed · **Repo:** `ally-ai-learn` · **Related:** `BEHAVIORS_OFF_GATE`, `ORCHESTRATION_ASYNC_SQS`

## Context & problem

When the trainee stops speaking, `process_events` ([nodes.py:485](../app/core/graph/nodes.py)) is one
**synchronous** node whose edge to the sync barrier is **unconditional** ([graph_builder.py:162](../app/core/graph/graph_builder.py)),
so the spoken reply (`generate_response`) cannot start until it finishes. That node awaits, in order:

1. **Detection of ALL `permitted_events`** — `_detect_events` ([nodes.py:107](../app/core/graph/nodes.py)),
   up to 8 concurrent classifiers, 10s each.
2. **Orchestration of all triggered events** — `orchestrate_events` ([event_orchestrator.py:530](../app/core/events/event_orchestrator/event_orchestrator.py)),
   bounded by `ORCHESTRATION_TIMEOUT=20s`.
3. Only *then* a split into branching vs non-branching (`_split_events_by_type`, [nodes.py:282](../app/core/graph/nodes.py)).

Only **branching + guardrail + termination** events actually shape the reply. The rest (non-branching
scoring + UI feedback + Core/SQS send) gate it for no reply-relevant reason. This doc specifies how to
move that work off the critical path.

## Key finding that reframes the win (verified)

`orchestrate_events` makes **no LLM calls** — the long-standing comment in `process_events`
(~[nodes.py:344](../app/core/graph/nodes.py), "runs its own LLM calls (branching resolution, feedback
generation)") is **stale**. Branching-instruction LLM resolution happens later, in
`resolve_branching_instruction` ([nodes.py:592](../app/core/graph/nodes.py)). The orchestrator only:
mutates the event registry, evaluates cascade/combination scoring, dedupes, commits scores, sends to
Core/SQS, and handles termination — it is **CPU-light + SQS-bound**.

Consequences:
- The only on-gate cost worth shedding from orchestration is the **non-branching SQS round-trip** (and,
  optionally, the non-branching score commit). This is a **bounded** win, essentially
  `ORCHESTRATION_ASYNC_SQS` partitioned by branching status.
- The **real** per-turn cost is **detection** (the binary-classifier LLM calls). De-gating *detection*
  is **impossible without a deeper refactor**, because `orchestrate_events` is **not subset-safe**: the
  single `_update_registry_and_collect_event_data` pass ([event_orchestrator.py:328](../app/core/events/event_orchestrator/event_orchestrator.py))
  mutates registry happened-state, evaluates combination expressions against the whole registry, runs
  cascade scoring off `get_total_score()`, and dedupes via `self._sent_events` + one-shot termination
  flags. Calling it twice with subsets double-scores, double-sends, or evaluates against an inconsistent
  snapshot. So **detection + the registry/cascade core must run once per turn on the gate in every
  design** — only the *output* side-effects can move.

> Set expectations accordingly: `EVENTS_OFF_GATE` removes the non-branching SQS (and optionally score)
> tail. It does **not** parallelize detection. That requires Phase 3.

## Goals / non-goals

**Goals:** let the reply gate only on branching + guardrail + termination resolution; move non-branching
SQS (and optionally score commit) off the gate; behind a default-off flag; A/B-able; zero report-graph
regression.

**Non-goals (this phase):** parallelizing non-branching detection; changing reply text/branching logic;
touching the report graph topology.

## Recommended approach: orchestrator-internal tail split (safe variant)

Chosen over two alternatives (see Appendix). It reuses the **existing** `_spawn_background` seam that
`ORCHESTRATION_ASYNC_SQS` already ships ([event_orchestrator.py:507](../app/core/events/event_orchestrator/event_orchestrator.py)),
makes **no graph-topology change** (so it sidesteps report-graph parity, LiveKit #2836 streaming, and
`send_event_feedback`-barrier hazards), and is trivially revertible via the flag.

### Mechanics

1. **`config.py`** (beside `BEHAVIORS_OFF_GATE`, ~[config.py:311](../app/core/config.py)): add
   `EVENTS_OFF_GATE: bool = Field(default=False, ...)`. Document: reply still gates on
   branching+guardrail+termination; only non-branching SQS (and, behind a future sub-flag, non-branching
   score) move off the voice-to-voice path; same cosmetic same-turn reply-state race already accepted for
   `BEHAVIORS_OFF_GATE`/RAG; default OFF; A/B against `orchestrationMs` / `responseLatencyMs`.

2. **`event_orchestrator.py`** — rewrite **only** the `orchestrate_events` tail (~573–594). After
   `_update_registry_and_collect_event_data` returns `events_to_process`, **inside `if not
   self.is_report_mode:`**:
   - Partition the **output** (never the input):
     `gate = [e for e in events_to_process if e.branching_instruction is not None or e.event_id in self.termination_event_ids]`,
     `offgate = the disjoint remainder`.
   - `await self._send_events_to_core(gate, room)` (branching/guardrail land immediately; termination is
     captured into `deferred_termination_event`, [event_sender.py:288](../app/core/events/event_orchestrator/event_sender.py)).
   - `self._spawn_background(self._send_events_to_core(offgate, room), label="send_events_to_core_offgate")`.
   - **Keep on the gate, on the FULL set, OUTSIDE the report guard** (so report mode runs them too):
     `await self._update_event_score(events_to_process)` and `await self._handle_termination_events(events_to_process)`.
   - Flag OFF **or** report mode → today's exact path (single send respecting `ORCHESTRATION_ASYNC_SQS`).
   - Return tuple unchanged → caller still splits feedback via `_split_events_by_type`; UI routing untouched.

3. **`nodes.py`** — no logic change (`process_events → sync` stays unconditional). **Fix the stale
   "LLM calls / feedback generation" comments** (grep for them near `_orchestrate_and_split_events` /
   `process_events`; cited line numbers have shifted).

4. **`graph_builder.py`** — no topology change (simulation or report). Optional one-line comment that
   `EVENTS_OFF_GATE` is an orchestrator-internal tail split (distinct from `BEHAVIORS_OFF_GATE`'s edge rewire).

### Why it's correct

- **One registry pass.** We partition the *output* `events_to_process`, never re-call the orchestrator.
  Registry mutation, cascade, combination eval, `get_happened_events`, `_sent_events`, and termination
  one-shot flags all execute once on one snapshot — no double-score / double-send / double-cascade.
- **Reply unchanged.** `branching_and_feedback_data` is collected on-gate → `resolve_branching_instruction`
  → `next_instruction` → reply text, exactly as today.
- **Guardrails** always carry a config-time `branching_instruction` ([scenario/base.py:389](../app/core/scenario/base.py))
  → always in the gate slice (score=0, no scoring concern).
- **Termination** is keyed by `termination_event_ids` (orthogonal to branching) → forced into the gate
  slice; `_handle_termination_events` runs once, synchronously, on the gate path with one-shot guards intact.
- **Score safety (v1):** *all* score commit stays on-gate, so `generate_response`'s
  `score_keeper.get_total_score()` ([nodes.py:1054](../app/core/graph/nodes.py)) sees this turn's full delta,
  the next turn's cascade baseline is correct, and the authoritative final score never loses a delta. This
  one choice neutralizes the three scariest risks (cascade drift, final-score loss, reply-state drift) for
  a slightly smaller latency win.
- **Report mode** forces today's path → scoring + termination commit before `clear_events_and_detected_data`;
  zero report-graph changes.

## ⚠️ Blocking fix to fold into Phase 1 (from adversarial review)

The EventOrchestrator keeps its **own** `_background_tasks` set ([event_orchestrator.py:77](../app/core/events/event_orchestrator/event_orchestrator.py)),
**separate** from the worker's set. The shutdown handler's `cleanup_background_tasks`
([factory.py:387](../app/core/agent/factory.py), wired at [worker.py:528](../app/worker.py)) operates on the
**worker** set and **cancels** rather than drains. So the orchestrator's off-gate SQS sends are neither
awaited nor cancelled at shutdown — on **same-turn termination or abrupt disconnect, the final turn's
non-branching backend rows are dropped, not delayed.** This is pre-existing for `ORCHESTRATION_ASYNC_SQS`
(off by default), but `EVENTS_OFF_GATE` makes the fire-and-forget path the routine default shape.

**Fix:** in the shutdown handler ([handlers.py:459](../app/core/events/handlers.py)), **before**
`finalize_session`, **drain (do not cancel)** the orchestrator's tasks:
`await asyncio.gather(*event_orchestrator._background_tasks, return_exceptions=True)` under a short
(~2–3s) timeout so the deferred termination send + final score still proceed promptly. This drain is also
the hard prerequisite for Phase 2.

## Phasing

- **Phase 0 — measure (no code):** capture `orchestrationMs` / `responseLatencyMs` and per-turn
  **branching-vs-non-branching event counts** on representative scenarios. Answers the central question —
  what fraction of triggered events are non-branching — and whether further work is justified.
- **Phase 1 — ship Approach C safe variant + the drain fix.** Flag default OFF. Tail rewrite (non-branching
  SQS off-gate; all score + termination on-gate); report-mode guard; orchestrator-task drain in shutdown;
  stale-comment fix. Fully reversible; zero new double-call surface. A/B; verify report determinism and
  single termination.
- **Phase 2 — optional, measure first:** sub-flag `EVENTS_OFF_GATE_DEFER_SCORE` (default OFF) to move the
  *non-branching* score commit off-gate too. Requires the Phase-1 drain proven + a `finalize_session`
  drain, and validation of next-turn cascade baseline. Accepts the cosmetic same-turn reply-state race.
- **Phase 3 — only if detection dominates (Approach B):** decompose `orchestrate_events` into
  `orchestrate_core` + `apply_score`/`apply_send`/`apply_termination` over disjoint subsets, pin a legacy
  `orchestrate_events()` wrapper for `initialize()`/scheduler/report, and split the simulation graph into
  `process_branching_events` (→ sync, gates) + `process_nonbranching_events` (→ `send_event_feedback`).
  Report graph stays single-node. This is the only path that can de-gate **detection**. Do **not** use the
  rejected Approach A coroutine-stashed-on-the-orchestrator side channel.

## Must-handle checklist (Phase 1)

- [ ] **Drain (not cancel)** the orchestrator's `_background_tasks` in shutdown before `finalize_session`, with a short timeout.
- [ ] Wrap the **entire** off-gate branch (partition + both sends + spawn) inside `if not self.is_report_mode:`; keep `_update_event_score` + `_handle_termination_events` on the full set **outside** the guard.
- [ ] Keep **all** score commit + termination on the gate in v1 (no deferral).
- [ ] Unit test: a **non-branching termination** event (termination id, no branchInstruction) lands on-gate.
- [ ] Integration test: non-branching scoring event **+** termination on one turn → (a) non-branching SQS row sent, (b) final score includes the non-branching delta, (c) termination fires exactly once.
- [ ] Confirm + comment that `_sent_events` is fully mutated in `_update_registry_and_collect_event_data` (before sends), so the concurrent off-gate send is read-only w.r.t. dedup state.
- [ ] `EVENTS_OFF_GATE=False` default; OFF/report path reproduces today's tail exactly; doc the cosmetic race like `BEHAVIORS_OFF_GATE`.
- [ ] Fix the stale "orchestrator runs LLM calls" comments (locate by grep).

## Risks & trade-offs

- **Bounded win.** Sheds the non-branching SQS round-trip; ~zero on branching/guardrail/termination-only
  turns. Not a detection-parallelization (that's Phase 3).
- **Combination events:** a combination event may be non-branching and land in the off-gate **send**
  slice — fine (just a backend row); its happened-state eval and score still commit on-gate in the single
  core pass. Re-audit if Phase 2 defers score (a combination feeding a cascade threshold must not be deferred).
- **Closed-room off-gate send:** if the room closes between spawn and execution, the send's `if room:`
  guard may see a stale-truthy room; error is logged/swallowed. Termination is never in the off-gate slice,
  so no termination row is ever at risk.
- **Same maintenance caveat** as other flags: OFF path must reproduce today's behavior byte-for-byte for clean A/B and revert.

## Verification

1. Local stack up; run one v2 and one v3 ElevenLabs scenario with events configured (mix of branching + non-branching).
2. A/B `EVENTS_OFF_GATE` on/off: `orchestrationMs` drops on turns firing non-branching events; `responseLatencyMs` improves correspondingly; branching reply behavior identical.
3. Regression: report-mode determinism unchanged; termination fires exactly once; the same-turn-termination test above passes (no dropped non-branching row, final score intact).

## Appendix — approaches considered (judge scores)

| Approach | What it does | Effort | Score | Verdict |
|---|---|---|---|---|
| **C — tail split (recommended)** | Partition orchestrator output; defer non-branching SQS via existing `_spawn_background`; no graph change | **M** | **85** | Ship first (safe variant) |
| B — composable orchestrate phases | Decompose into `orchestrate_core` + `apply_*` tails; split graph nodes | L | 76 | Structural endpoint (Phase 3) if detection must parallelize |
| A — flag-gated split graph nodes | Mirror `BEHAVIORS_OFF_GATE` edges; stash deferred coroutine on orchestrator | L | 70 | Rejected — same win as C, but fragile non-serializable coroutine side-channel |

All three share the same ceiling (the orchestrator isn't subset-safe, so detection + core stay on-gate);
C delivers it at the lowest risk and blast radius.
