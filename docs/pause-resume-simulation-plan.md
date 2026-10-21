# Pause / Resume Simulation — Implementation Plan

## Goal
Let a counselor **pause a live simulation** so they can take notes, think, and resume —
where the *whole thing* pauses, not just the mic. The agent stops listening, stops
speaking, stops scoring; **time itself stops** so paused time is not billed, not counted
toward the leaderboard, and does not advance time-gated event logic.

## Locked decisions
| Decision | Choice |
|---|---|
| Connection during pause | Stay connected, freeze I/O (no teardown) |
| Clients | ally-mobile **and** ally-web |
| Pause cap | **10 min** continuous → **auto-END** with on-screen warning at **9:30** |
| Recording / egress | Let it run through the pause (silent gap); duration/billing still exclude paused time |
| On resume | Persona stays silent; re-enable input and wait for the counselor |
| Time source | **Server/agent-stamped**, never client-reported (consistent with existing `startedAt`/`endedAt` webhooks) |

## Hard requirement: paused time must not cost the user minutes
The user must not lose allocated minutes by pausing. Two distinct "minutes" both apply:
- **Simulation credits** (`creditLimit`/`consumedCredits`, `lifespanSecondsPerCredit ?? 60`) — deducted
  **at session end** from duration; no hold at start. Protected by Phase 2c subtracting `totalPausedMs`
  before the credit calc (incl. the `remainingSeconds >= 30 → +1` rounding, which then runs on active time only).
- **Per-scenario time limit** (`scenario.maxTimeValue` → `maxTimeSec` → client timer `timeLimit`,
  fires `handleDisconnect` at `elapsed >= timeLimit`). **Enforced client-side only — the agent has no
  server-side max-duration auto-end.** Therefore the **client timer freeze (Phase 3) is load-bearing**, not
  cosmetic: offsetting `startTime` by paused duration is what keeps the user's full active conversation time.
  Treat it as a correctness requirement with a test, not UI polish.

## Core principle: "freeze time" lives in three layers
Pause is not one switch. The same paused-duration concept must be honored in:
1. **Agent real-time** (`ally-ai-learn`) — stop audio I/O + turn-taking + scoring, *and stop the agent's own clock* so event eligibility/timers don't drift.
2. **Billing/stats** (`ally-be`) — subtract paused time from `callDuration` for credits + leaderboard.
3. **Client UX** (mobile/web) — freeze the visible timer, show pause state + cap warning.

All three are driven off one idea: **cumulative paused milliseconds**, stamped server-side.

## Architecture: agent is the coordinator
There is no low-latency push from `ally-be` to the agent, and timing today is already
server-authoritative (LiveKit `participant_joined` → `startedAt`, `room_finished` → `endedAt`).
So the agent coordinates; the client is a thin trigger; `ally-be` records what the agent reports.

```
[Pause tap]
  client ──reliable LiveKit data {type:"pause"}──▶ agent
                                                     │
                          ┌──────────────────────────┼───────────────────────────┐
                          ▼                           ▼                           ▼
                   interrupt speech,          SessionClock.pause()       emit SQS "session-paused"
                   gate STT/turn/scoring,      (start paused_offset),     (agent UTC timestamp)
                   pause scheduler sleeps      arm 10-min cap timer               │
                          │                                                       ▼
                          └──── data ack ──▶ client freezes timer UI      ally-be stamps pausedAt

[Resume tap]  mirror: unfreeze, SessionClock.resume() accumulates offset,
              cancel cap timer, emit "session-resumed" → ally-be: totalPausedMs += (resumedAt − pausedAt)
```

## No Redis / no new persistence
- **No Redis anywhere** in `ally-ai-learn`; only in-process LRU caches (knowledge/embeddings).
- Conversation state = `PruningCheckpointer(MemorySaver)` — in-process dicts keyed by `thread_id`.
  Because the worker stays alive and the room stays connected, state survives a pause for free.
  **Do NOT call `delete_thread(thread_id)` on pause** — that is the end-of-session teardown call.
- No serialization, no external store. (Disconnect/rebuild would have required externalizing this state — deliberately avoided.)

---

## Phase 1 — `ally-ai-learn` (real-time freeze + coordinator)

### 1a. Control channel (net-new — none exists today)
- Add `@room.on("data_received")` in `app/worker.py` (~L320) handling reliable
  `{type: "pause" | "resume"}` packets. Ignore if no remote participant present
  (reuse the orphan-deadline participant check).
- Ack back to the client via `room.local_participant.publish_data(...)` so UI confirms.

### 1b. Freeze audio + brain
- On pause: `await session.interrupt()` (cut any in-flight TTS).
- Set a `paused` flag threaded into LangGraph `config["configurable"]`; defensively gate
  `process_events`, behavior detection, and scoring in `app/core/graph/nodes.py` so nothing
  fires even if audio leaks through.
- On resume: clear the flag, re-enable input, **do not** call `generate_reply` (persona waits).

### 1c. SessionClock (the agent's own frozen clock) — **key change**
There are **two** wall-clock computations that drift across a pause; both must read one clock:
- `calculate_elapsed_time(config)` — `app/core/graph/utils.py:72` (feeds node `is_event_eligible`, `nodes.py:185`).
- `EventOrchestrator._get_elapsed_time()` — `app/core/events/event_orchestrator/event_orchestrator.py:686` (feeds orchestrator + `score_evaluator`).

Introduce a shared `SessionClock` holding `agent_joined_at` + cumulative `paused_offset`:
- `elapsed()` returns `(now − joined) − paused_offset` → **active** time.
- `pause()` records pause start; `resume()` adds the delta to `paused_offset`.
- Redirect both call sites above to `SessionClock.elapsed()`. One source of truth.

### 1d. Pause-aware sleep (the only drifting timers)
- `TimeEventScheduler` fires/revokes time-based events via a single `asyncio.sleep(seconds)` in
  each of `_time_trigger_coroutine` (`schedulers.py:287`) and `_time_revoke_coroutine` (`schedulers.py:400`).
- Replace both with one helper `interruptible_sleep(seconds, pause_gate)` that counts down only
  while not paused (gated on an `asyncio.Event` set on pause / cleared on resume, tracking remaining time).
- Relative values in the scheduler (`elapsed_time=0.0`, `elapsed_time=seconds`) stay correct once the sleep is pause-aware.
- Out of scope: `worker.py:364` orphan-deadline sleep (pre-session) and every `asyncio.wait_for` (operation timeouts, not standing timers — none runs while frozen).

### 1e. Cap timer (10 min → auto-end)
- On pause, arm an `asyncio` task: at **9:30** publish a `cap-warning` data packet to the client;
  at **10:00** run the existing termination flow (`_termination_event` → `finalize_session`).
- Cancel the task on resume.

### 1f. Notify backend
- Emit `session-paused` / `session-resumed` SQS messages (each with the agent's UTC timestamp),
  modeled on `create_session_end_message` in `app/core/queue/utils.py`.

---

## Phase 2 — `ally-be` (clock / billing freeze)

### 2a. Migration + entity
- Add to `scenario_sessions` (`ally-be/src/learn/entity/scenario-sessions.entity.ts`):
  - `pausedAt` (timestamptz, nullable) — start of the currently-open pause.
  - `totalPausedMs` (int, default 0) — cumulative paused time.
- **Server-stamped only** — there is no client-supplied `pausedDurationMs`.
- Build before `migration:run` (local-setup requirement: migrations read `dist/`).

### 2b. SQS handlers
- Extend the learn event processor / `handleScenarioSessionEvent` (`scenario-session.service.ts:~1682`):
  - `session-paused` → stamp `pausedAt` (from event timestamp).
  - `session-resumed` → `totalPausedMs += resumedAt − pausedAt`; clear `pausedAt`.

### 2c. Billing subtraction
- Subtract `totalPausedMs` in `consumeSimulationCredits()` (`~L1090`) and in the leaderboard
  `durationMinutes` calc (`~L944`): `activeDuration = endedAt − startedAt − totalPausedMs`.

### 2d. End-while-paused edge case
- In `handleEndScenarioSessionEvent` / `room_finished`: if `pausedAt` is still set, close the open
  interval (`totalPausedMs += endedAt − pausedAt`) before computing `callDuration`.

---

## Phase 3 — Clients (mobile + web)

### Mobile (`ally-mobile`)
- Pause button mirroring mute in `SimulationControls.tsx`.
- `room.localParticipant.publishData({type:'pause'}, {reliable:true})` from `SimulationAssistantScreen.tsx`;
  flip optimistic UI on the agent ack.
- Freeze `SimulationTimer.tsx`: clear the interval, offset `startTime` by paused duration on resume.
- Show cap-warning banner on the `cap-warning` packet (existing `DataReceived` handler).
- While paused, disable the mute toggle (pause is a superset).

### Web (`ally-web`)
- Same in shared lib `libs/ui-shared/src/lib/simulation/SimulationControls.tsx` / `SimulationTimer.tsx`;
  wire pause state through `SimulationPage` → page component; both clients already decode `DataReceived`.

---

## Phase 4 — Testing & rollout
- **Unit:** `totalPausedMs` accumulation across multiple pause cycles; end-while-paused interval close;
  credit + leaderboard math with paused time; `SessionClock.elapsed()`; `interruptible_sleep` remaining-time correctness.
- **Integration:** seamless pause→resume conversation; time-gated event does NOT fire during pause and
  fires at correct *active* time after resume; cap auto-end; SQS pause-event loss degrades to
  bill-as-if-not-paused (same risk class as today's end-of-session).
- **Minutes-preserved (hard requirement):** pause 2 min in a 10-min-credit + 15-min-scenario-limit session →
  (a) credits charged on active time only, and (b) the client `timeLimit`/`handleDisconnect` fires 2 min later
  in wall-clock, i.e. the scenario time limit measures active conversation only.
- **Feature flag** for staged rollout across the two clients.

## Edge cases checklist
- [ ] Pause while persona is mid-utterance → `interrupt()`, lost utterance acceptable; resume waits for counselor.
- [ ] Double-pause / double-resume → idempotent (guard on current state).
- [ ] Session ends (manual or `room_finished`) while paused → close open pause interval.
- [ ] Cap fires exactly as user resumes → cancel race handled (cancel task before unfreeze).
- [ ] Pause-event SQS lost → user billed as if not paused (acceptable, logged).
- [ ] Recording: silent gap during pause is expected; transcript/review unaffected functionally.

## Sequencing
1. **Backend (Phase 2) + Agent (Phase 1)** define the SQS contract — build and verify these together first.
2. Verify pause/resume end-to-end via SQS + a test data packet (no UI).
3. **Mobile + web (Phase 3)** in parallel once the contract is proven.

## File-touch summary
| Layer | File | Change |
|---|---|---|
| agent | `app/worker.py` | data_received handler, pause/resume handlers, cap timer, ack, SessionClock wiring |
| agent | `app/core/graph/nodes.py` | gate events/behaviors/scoring on `paused` |
| agent | `app/core/graph/utils.py` | `calculate_elapsed_time` → SessionClock |
| agent | `app/core/events/event_orchestrator/event_orchestrator.py` | `_get_elapsed_time` → SessionClock |
| agent | `app/core/events/schedulers.py` | `interruptible_sleep` for both sleeps |
| agent | `app/core/queue/utils.py` | `session-paused` / `session-resumed` messages |
| agent | (new) `SessionClock` + pause-gate util | shared clock + interruptible sleep |
| be | `src/database/migrations/*-addPauseToScenarioSessions.ts` | add `pausedAt`, `totalPausedMs` |
| be | `ally-be/src/learn/entity/scenario-sessions.entity.ts` | new columns |
| be | `ally-be/src/learn/service/scenario-session.service.ts` | SQS pause/resume handling, billing + leaderboard subtraction, end-while-paused |
| mobile | `SimulationControls.tsx`, `SimulationAssistantScreen.tsx`, `SimulationTimer.tsx` | pause button, data publish, timer freeze, cap banner |
| web | `libs/ui-shared/src/lib/simulation/{SimulationControls,SimulationTimer,SimulationPage}.tsx` + page | same |
