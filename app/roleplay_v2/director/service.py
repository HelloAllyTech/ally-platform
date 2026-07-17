"""DirectorService — the per-turn referee of a roleplay v2 session.

For every committed trainee↔actor turn pair the Director LLM returns a
structured verdict (behavior observations, guard evaluations, proposed
transition, unlocks, engineered events, stage direction, retrieval topics).
The verdict is ADVISORY — ``_apply`` re-validates everything in code before
committing to the RuntimeStateStore:

- a transition is accepted only via a satisfied guard on the CURRENT state
  whose behavior conditions, minTurnsInState, and minCumulativeScore all pass;
- unlocks respect the secret's minStateIds and current locked status;
- scores are computed in code from rubric weights × polarity for behaviors
  the Director marked observed (the LLM never invents numbers);
- stage directions are truncated to their first sentence / 200 chars;
- behavior/score engineered events are re-checked; time events never come
  from the LLM at all — a code-owned loop fires them off the session clock.

Voice mode: ``on_turn_committed`` spawns a tracked task off the critical
path with a hard timeout (a slow Director can only MISS a turn, never delay
the actor). Rehearsal/text mode awaits ``run_turn`` directly.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from collections import deque
from typing import Any, Deque, Dict, List, Optional, Set, Tuple

from langchain_core.messages import HumanMessage, SystemMessage

from app.core.config import settings
from app.core.logger import get_logger
from app.prompts.resolver import load_template
from app.roleplay_v2 import telemetry
from app.roleplay_v2.director.emitters import DirectorEmitter
from app.roleplay_v2.director.schemas import DirectorVerdict
from app.roleplay_v2.spec import secret_matching
from app.roleplay_v2.spec.models import ScenarioSpec
from app.roleplay_v2.spec.runtime_state import (
    LEDGER_LOCKED,
    LEDGER_UNLOCKED,
    RuntimeSessionState,
    RuntimeStateStore,
)

logger = get_logger(__name__)

DEFAULT_DIRECTOR_TIMEOUT_S = 8.0
DEFAULT_WINDOW_TURNS = 6
MAX_STAGE_DIRECTION_CHARS = 200

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s")


def truncate_stage_direction(direction: Optional[str]) -> Optional[str]:
    """First sentence, capped at 200 chars (contract: keep directions terse)."""
    if not direction:
        return None
    text = direction.strip()
    if not text:
        return None
    first = _SENTENCE_SPLIT_RE.split(text, maxsplit=1)[0].strip()
    return first[:MAX_STAGE_DIRECTION_CHARS]


class DirectorService:
    """Runs the Director LLM per turn and applies validated verdicts."""

    def __init__(
        self,
        spec: ScenarioSpec,
        state_store: RuntimeStateStore,
        llm: Any,
        emitter: DirectorEmitter,
        *,
        session_clock: Any = None,
        timeout_s: Optional[float] = None,
        window_turns: int = DEFAULT_WINDOW_TURNS,
        prompt_data: Any = None,
    ) -> None:
        self.spec = spec
        self.state_store = state_store
        self.emitter = emitter
        self._session_clock = session_clock
        self._timeout_s = (
            timeout_s
            if timeout_s is not None
            else float(
                getattr(settings, "DIRECTOR_TIMEOUT_S", DEFAULT_DIRECTOR_TIMEOUT_S)
            )
        )
        # Minimum confidence before IRREVERSIBLE actions (transitions/unlocks)
        # are applied; scoring is never gated. 0 disables the gate.
        self._min_confidence = float(
            getattr(settings, "DIRECTOR_MIN_CONFIDENCE", 0.0) or 0.0
        )
        # Rolling conversation window: (turn_index, trainee_text, actor_text).
        self._window: Deque[Tuple[int, str, str]] = deque(maxlen=window_turns)
        self._tasks: Set[asyncio.Task] = set()
        self._time_events_task: Optional[asyncio.Task] = None
        self._started_monotonic = time.monotonic()

        self._llm = llm
        self._llm_model = getattr(llm, "model_name", None) or getattr(
            llm, "model", None
        )
        self._llm_provider = type(llm).__name__
        # include_raw=True keeps the raw AIMessage alongside the parsed
        # verdict so token usage can be emitted; fakes that return a bare
        # DirectorVerdict are also accepted (see _invoke_director).
        try:
            self._structured = llm.with_structured_output(
                DirectorVerdict, method="json_mode", include_raw=True
            )
        except TypeError:
            self._structured = llm.with_structured_output(
                DirectorVerdict, method="json_mode"
            )

        # Prompts contain literal JSON braces → resolve via load_template and
        # assemble manually, never str.format (precedent: evaluator.py).
        self._system_prompt = self._build_system_prompt(prompt_data)
        self._turn_user_header = (
            load_template("director/turn_user", prompt_data) or ""
        ).strip()

    # ------------------------------------------------------------------
    # Prompt assembly
    # ------------------------------------------------------------------

    def _build_system_prompt(self, prompt_data: Any) -> str:
        """Static instructions + the scenario spec as JSON (FULL ledger)."""
        base = (load_template("director/system", prompt_data) or "").strip()
        spec_doc = {
            "title": self.spec.title,
            "competencyId": self.spec.competency_id,
            "competency": self.spec.competency_label,
            "rubric": self.spec.rubric.model_dump(by_alias=True),
            "stateMachine": self.spec.state_machine.model_dump(by_alias=True),
            # The Director (unlike the Actor) sees the FULL ledger — secret
            # contents AND unlock conditions — it is the referee, not the
            # character, and its output schema never echoes content.
            "disclosureLedger": self.spec.disclosure_ledger.model_dump(by_alias=True),
            "engineeredEvents": [
                e.model_dump(by_alias=True)
                for e in self.spec.engineered_events
                if e.trigger in ("behavior", "score")
            ],
        }
        return (
            f"{base}\n\n## Scenario specification (JSON)\n"
            f"{json.dumps(spec_doc, indent=2, ensure_ascii=False)}"
        )

    @staticmethod
    def _serialize_runtime_state(snapshot: RuntimeSessionState) -> str:
        return json.dumps(
            {
                "turn_index": snapshot.turn_index,
                "current_state_id": snapshot.current_state_id,
                "turns_in_state": snapshot.turns_in_state,
                "cumulative_score": snapshot.cumulative_score,
                "behavior_hits": snapshot.behavior_hits,
                "ledger": snapshot.ledger,
                "fired_events": snapshot.fired_events,
                "active_stage_direction": snapshot.stage_direction,
            },
            indent=2,
            ensure_ascii=False,
        )

    def _build_turn_user_prompt(
        self, turn_index: int, snapshot: RuntimeSessionState
    ) -> str:
        window_lines: List[str] = []
        for t_idx, trainee, actor in self._window:
            window_lines.append(f"[turn {t_idx}] TRAINEE: {trainee}")
            window_lines.append(f"[turn {t_idx}] CLIENT: {actor}")
        window_text = "\n".join(window_lines) or "(no conversation yet)"
        return (
            f"{self._turn_user_header}\n\n"
            f"## Turn index to judge\n{turn_index}\n\n"
            f"## Runtime state (JSON)\n"
            f"{self._serialize_runtime_state(snapshot)}\n\n"
            f"## Recent conversation window\n{window_text}"
        )

    # ------------------------------------------------------------------
    # Entry points
    # ------------------------------------------------------------------

    def on_turn_committed(
        self, turn_index: int, trainee_text: str, actor_text: str
    ) -> None:
        """Voice path: fire-and-forget, tracked, hard-timeboxed."""
        self._window.append((turn_index, trainee_text, actor_text))
        task = asyncio.create_task(self._run_turn_guarded(turn_index))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def run_turn(
        self, turn_index: int, trainee_text: str, actor_text: str
    ) -> Optional[DirectorVerdict]:
        """Rehearsal/text path: awaits the verdict inline."""
        self._window.append((turn_index, trainee_text, actor_text))
        return await self._run_turn_guarded(turn_index)

    async def _run_turn_guarded(self, turn_index: int) -> Optional[DirectorVerdict]:
        started = time.perf_counter()
        try:
            verdict = await asyncio.wait_for(
                self._invoke_director(turn_index), timeout=self._timeout_s
            )
        except asyncio.TimeoutError:
            logger.warning(
                "[roleplay_v2] Director timed out after %.1fs on turn %d — "
                "turn goes undirected (miss)",
                self._timeout_s,
                turn_index,
            )
            await self._record_miss(turn_index)
            return None
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception(
                "[roleplay_v2] Director failed on turn %d — miss", turn_index
            )
            await self._record_miss(turn_index)
            return None

        latency_ms = round((time.perf_counter() - started) * 1000.0, 1)
        telemetry.record_turn_fields(
            self.emitter.room_id, director_latency_ms=latency_ms
        )
        applied = await self._apply(turn_index, verdict)
        return verdict if applied else None

    async def _record_miss(self, turn_index: int) -> None:
        await self.state_store.mark_miss()
        telemetry.record_turn_fields(self.emitter.room_id, director_miss=1)

    async def _invoke_director(self, turn_index: int) -> DirectorVerdict:
        snapshot = await self.state_store.snapshot()
        messages = [
            SystemMessage(content=self._system_prompt),
            HumanMessage(content=self._build_turn_user_prompt(turn_index, snapshot)),
        ]
        result = await self._structured.ainvoke(messages)

        raw = None
        if isinstance(result, DirectorVerdict):
            verdict = result
        elif isinstance(result, dict):
            # include_raw=True shape: {"raw": AIMessage, "parsed": ..., ...}
            verdict = result.get("parsed")
            raw = result.get("raw")
            if verdict is None:
                raise ValueError(
                    f"Director returned unparseable output: "
                    f"{result.get('parsing_error')}"
                )
        else:
            verdict = DirectorVerdict.model_validate(result)

        usage = getattr(raw, "usage_metadata", None) or {}
        if usage:
            self.emitter.emit_llm_usage(
                self._llm_provider,
                str(self._llm_model) if self._llm_model else "unknown",
                (
                    int(usage.get("input_tokens", 0) or 0),
                    int(usage.get("output_tokens", 0) or 0),
                    int(usage.get("total_tokens", 0) or 0),
                ),
            )
        return verdict

    # ------------------------------------------------------------------
    # Code-level validation + commit
    # ------------------------------------------------------------------

    def _validate_transition(
        self,
        verdict: DirectorVerdict,
        snapshot: RuntimeSessionState,
        observed: Set[str],
        new_cumulative: float,
    ) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        """Return (next_state_id, guard_id, observed_behavior) or Nones.

        A transition is legal only via a transition on the CURRENT state that
        (a) targets the proposed state, (b) the Director marked satisfied,
        (c) has its behavior conditions genuinely met (this turn's
        observations, backed by session-wide behavior_hits for the any-of
        clause), and (d) passes minTurnsInState / minCumulativeScore.
        """
        proposed = verdict.next_state_id
        if not proposed or proposed == snapshot.current_state_id:
            return None, None, None
        current_state = self.spec.get_state(snapshot.current_state_id)
        if current_state is None or self.spec.get_state(proposed) is None:
            logger.warning(
                "[roleplay_v2] Director proposed unknown state %r — rejected",
                proposed,
            )
            return None, None, None

        session_observed = observed | {
            b for b, hits in snapshot.behavior_hits.items() if hits > 0
        }
        satisfied = verdict.satisfied_guard_ids()

        for transition in current_state.transitions:
            if transition.to_state_id != proposed:
                continue
            if transition.id not in satisfied:
                continue
            # Both behavior clauses are evaluated against the SESSION-WIDE set
            # of observed behaviors, not just this turn's. A trainee rarely
            # exhibits several distinct behaviors in a single utterance, so an
            # all-of guard checked against one turn would almost never fire and
            # legitimate state progress would stall (the behaviors were shown,
            # just across different turns).
            if transition.when_behaviors_all and not (
                set(transition.when_behaviors_all) <= session_observed
            ):
                continue
            if transition.when_behaviors_any and not (
                set(transition.when_behaviors_any) & session_observed
            ):
                continue
            if snapshot.turns_in_state < transition.min_turns_in_state:
                continue
            if (
                transition.min_cumulative_score is not None
                and new_cumulative < transition.min_cumulative_score
            ):
                continue
            # Prefer a this-turn observation as the cited trigger; fall back
            # to the session-wide hit that satisfied the any-of clause.
            observed_behavior = next(
                iter(
                    (set(transition.when_behaviors_any) & observed)
                    or (set(transition.when_behaviors_all) & observed)
                    or (set(transition.when_behaviors_any) & session_observed)
                    or (set(transition.when_behaviors_all) & session_observed)
                ),
                None,
            )
            return proposed, transition.id, observed_behavior

        logger.info(
            "[roleplay_v2] Director transition %s→%s rejected (no legal "
            "satisfied guard)",
            snapshot.current_state_id,
            proposed,
        )
        return None, None, None

    def _validate_unlocks(
        self,
        verdict: DirectorVerdict,
        snapshot: RuntimeSessionState,
        effective_state_id: str,
        observed: Set[str],
    ) -> List[Tuple[str, Optional[str]]]:
        """[(secret_id, unlock_condition_id)] for legal unlocks only."""
        # An unlock condition names the behaviors that earn a secret. Those
        # behaviors are frequently demonstrated turns BEFORE the Director
        # proposes the unlock (trust is built gradually), so the condition is
        # checked against the session-wide behavior set, not just this turn.
        session_observed = observed | {
            b for b, hits in snapshot.behavior_hits.items() if hits > 0
        }
        unlocks: List[Tuple[str, Optional[str]]] = []
        for secret_id in verdict.unlock_ids:
            secret = self.spec.get_secret(secret_id)
            if secret is None:
                logger.warning(
                    "[roleplay_v2] Director unlocked unknown secret %r", secret_id
                )
                continue
            if snapshot.ledger.get(secret_id, LEDGER_LOCKED) != LEDGER_LOCKED:
                continue
            if secret.min_state_ids and effective_state_id not in secret.min_state_ids:
                logger.info(
                    "[roleplay_v2] Unlock of %s rejected: state %s not in "
                    "minStateIds %s",
                    secret_id,
                    effective_state_id,
                    secret.min_state_ids,
                )
                continue
            condition_id = None
            for cond in secret.unlock_conditions:
                if not cond.behavior_ids or (set(cond.behavior_ids) & session_observed):
                    condition_id = cond.id
                    break
            unlocks.append((secret_id, condition_id))
        return unlocks

    def _locked_secret_leak(
        self, snapshot: RuntimeSessionState, text: Optional[str]
    ) -> Optional[str]:
        """Return the id of any still-LOCKED secret whose content appears in
        ``text`` (a Director-authored stage direction), else None.

        The Director sees full secret content, so a poorly-behaved verdict
        could smuggle a withheld secret back into the scene via the free-form
        stage direction that is injected into the actor's next turn card.
        This is the live-path counterpart of the rehearsal judge's leak scan.
        """
        if not text:
            return None
        for secret in self.spec.disclosure_ledger.secrets:
            if snapshot.ledger.get(secret.id, LEDGER_LOCKED) != LEDGER_LOCKED:
                continue
            if secret_matching.text_discloses_secret(text, secret.content):
                return secret.id
        return None

    def _actor_text_for_turn(self, turn_index: int) -> Optional[str]:
        """The actor's utterance for a turn, from the rolling window."""
        for t_idx, _trainee, actor in reversed(self._window):
            if t_idx == turn_index:
                return actor
        return None

    async def _mark_revealed_secrets(
        self, snapshot: RuntimeSessionState, turn_index: int, unlocked_now: Set[str]
    ) -> None:
        """Advance ledger unlocked→revealed for any secret the actor actually
        voiced this turn, so telemetry distinguishes 'may share' from 'shared'
        and the turn card's [ALREADY SHARED] branch reflects reality."""
        actor_text = self._actor_text_for_turn(turn_index)
        if not actor_text:
            return
        # A secret can be spoken the same turn it unlocks, or on any later
        # turn while UNLOCKED (not yet REVEALED).
        candidates = set(unlocked_now) | {
            sid for sid, status in snapshot.ledger.items() if status == LEDGER_UNLOCKED
        }
        for secret_id in candidates:
            secret = self.spec.get_secret(secret_id)
            if secret is None:
                continue
            if secret_matching.text_discloses_secret(actor_text, secret.content):
                await self.state_store.mark_revealed(secret_id)

    def _validate_fired_events(
        self,
        verdict: DirectorVerdict,
        snapshot: RuntimeSessionState,
        observed: Set[str],
        new_cumulative: float,
    ) -> List[str]:
        fired: List[str] = []
        for event_id in verdict.fire_event_ids:
            event = self.spec.get_event(event_id)
            if event is None or event.trigger == "time":
                continue  # time events are code-owned, never LLM-proposed
            if event.once and event_id in snapshot.fired_events:
                continue
            if event.trigger == "behavior" and not (set(event.behavior_ids) & observed):
                continue
            if event.trigger == "score" and event.score_threshold is not None:
                # A score event fires when the cumulative score crosses the
                # threshold in the configured direction: at_or_below models an
                # intervention on a struggling trainee (default); at_or_above
                # models a positive-reinforcement beat for a trainee doing well.
                if event.score_comparison == "at_or_above":
                    if new_cumulative < event.score_threshold:
                        continue
                elif new_cumulative > event.score_threshold:
                    continue
            fired.append(event_id)
        return fired

    async def _apply(self, turn_index: int, verdict: DirectorVerdict) -> bool:
        """Validate the verdict in code and commit it. False when rejected."""
        snapshot = await self.state_store.snapshot()

        observed_list = [
            b
            for b in verdict.observed_behavior_ids()
            if self.spec.rubric.get_behavior(b) is not None
        ]
        observed = set(observed_list)

        # Scores come from the rubric, never from the LLM.
        evidence_by_id = {
            o.behavior_id: o.evidence for o in verdict.behavior_observations
        }
        scores: List[Dict[str, Any]] = []
        score_delta = 0.0
        for behavior_id in observed_list:
            behavior = self.spec.rubric.get_behavior(behavior_id)
            scores.append(
                {
                    "behavior_id": behavior_id,
                    "score": behavior.signed_weight,
                    "rationale": evidence_by_id.get(behavior_id, ""),
                }
            )
            score_delta += behavior.signed_weight
        new_cumulative = snapshot.cumulative_score + score_delta

        # Confidence gate: on a low-confidence turn, still record behavior
        # scores (additive + auditable) but hold back IRREVERSIBLE actions —
        # state transitions and disclosure unlocks — that reshape the session.
        confident = (
            self._min_confidence <= 0.0 or verdict.confidence >= self._min_confidence
        )
        if not confident:
            logger.info(
                "[roleplay_v2] Director verdict for turn %d below confidence "
                "gate (%.2f < %.2f) — transitions/unlocks held",
                turn_index,
                verdict.confidence,
                self._min_confidence,
            )

        if confident:
            next_state_id, guard_id, observed_behavior = self._validate_transition(
                verdict, snapshot, observed, new_cumulative
            )
        else:
            next_state_id, guard_id, observed_behavior = None, None, None
        effective_state_id = next_state_id or snapshot.current_state_id

        unlocks = (
            self._validate_unlocks(verdict, snapshot, effective_state_id, observed)
            if confident
            else []
        )
        fired_event_ids = self._validate_fired_events(
            verdict, snapshot, observed, new_cumulative
        )

        # Engineered-event direction (a scripted beat) outranks the Director's
        # free-form direction for the same turn.
        direction_kind = "stage_direction"
        direction_event_id: Optional[str] = None
        stage_direction = truncate_stage_direction(verdict.stage_direction)
        # Live leak guard: never inject a Director-authored direction that
        # discloses a still-locked secret into the actor's next turn card
        # (trainer-authored engineered directions below are trusted).
        leaked_secret_id = self._locked_secret_leak(snapshot, stage_direction)
        if leaked_secret_id is not None:
            logger.warning(
                "[roleplay_v2] Dropped Director stage direction on turn %d — "
                "it disclosed still-locked secret %r",
                turn_index,
                leaked_secret_id,
            )
            telemetry.record_turn_fields(
                self.emitter.room_id, director_direction_leak_blocked=1
            )
            stage_direction = None
        if fired_event_ids:
            event = self.spec.get_event(fired_event_ids[0])
            if event is not None and event.direction:
                stage_direction = truncate_stage_direction(event.direction)
                direction_kind = "engineered_event"
                direction_event_id = event.id

        committed = await self.state_store.commit(
            turn_index,
            next_state_id=next_state_id,
            unlock_ids=[secret_id for secret_id, _ in unlocks],
            observed_behavior_ids=observed_list,
            score_delta=score_delta,
            stage_direction=stage_direction,
            retrieve_topics=verdict.retrieve_topics,
            fired_event_ids=fired_event_ids,
        )
        if not committed:
            logger.info(
                "[roleplay_v2] Stale director verdict for turn %d dropped",
                turn_index,
            )
            return False

        # Advance ledger unlocked→revealed for any secret the actor actually
        # voiced (this turn or earlier while unlocked).
        await self._mark_revealed_secrets(
            snapshot, turn_index, {secret_id for secret_id, _ in unlocks}
        )

        self._emit_turn_results(
            turn_index,
            snapshot,
            verdict,
            scores=scores,
            next_state_id=next_state_id,
            guard_id=guard_id,
            observed_behavior=observed_behavior,
            unlocks=unlocks,
            stage_direction=stage_direction,
            direction_kind=direction_kind,
            direction_event_id=direction_event_id,
            cumulative_score=new_cumulative,
        )
        return True

    def _emit_turn_results(
        self,
        turn_index: int,
        snapshot: RuntimeSessionState,
        verdict: DirectorVerdict,
        *,
        scores: List[Dict[str, Any]],
        next_state_id: Optional[str],
        guard_id: Optional[str],
        observed_behavior: Optional[str],
        unlocks: List[Tuple[str, Optional[str]]],
        stage_direction: Optional[str],
        direction_kind: str,
        direction_event_id: Optional[str],
        cumulative_score: float,
    ) -> None:
        guard_reasons = {g.transition_id: g.reason for g in verdict.guard_evaluations}
        if next_state_id:
            self.emitter.emit_state_transition(
                turn_index,
                from_state_id=snapshot.current_state_id,
                to_state_id=next_state_id,
                guard_id=guard_id,
                observed_behavior=observed_behavior,
                rationale=guard_reasons.get(guard_id, ""),
            )
        if scores:
            self.emitter.emit_rubric_score(turn_index, scores)
        for secret_id, condition_id in unlocks:
            secret = self.spec.get_secret(secret_id)
            self.emitter.emit_disclosure_unlock(
                turn_index,
                secret_id=secret_id,
                unlock_condition_id=condition_id,
                # Topic-level summary only; raw secret content stays server-side.
                disclosed_content_summary=secret.topic if secret else "",
            )
        if stage_direction:
            self.emitter.emit_stage_direction(
                turn_index,
                stage_direction,
                kind=direction_kind,
                event_id=direction_event_id,
            )

        # One data-channel packet per turn, in the frozen client contract shape
        # (ally-web DirectorObserverPanel). Unlocks carry secret TOPIC only —
        # NEVER content (the client must not receive what the actor may not
        # have said yet).
        self.emitter.publish_turn_result(
            {
                "turn": turn_index,
                "behaviors": [
                    {"id": ob.behavior_id, "observed": ob.observed}
                    for ob in verdict.behavior_observations
                ],
                "state": {
                    "from": snapshot.current_state_id,
                    "to": next_state_id or snapshot.current_state_id,
                },
                "unlocks": [
                    {
                        "id": secret_id,
                        "topic": (
                            self.spec.get_secret(secret_id).topic
                            if self.spec.get_secret(secret_id)
                            else ""
                        ),
                    }
                    for secret_id, _ in unlocks
                ],
                "events": (
                    [direction_event_id]
                    if direction_kind == "engineered_event" and direction_event_id
                    else []
                ),
                "score": cumulative_score,
                "feedback": verdict.trainee_feedback,
                "stale": False,
            }
        )

    # ------------------------------------------------------------------
    # Time-triggered engineered events (code-owned; no LLM call)
    # ------------------------------------------------------------------

    def start_time_events(self) -> None:
        """Arm the atSeconds loop (call once, after the session starts)."""
        time_events = sorted(
            (e for e in self.spec.engineered_events if e.trigger == "time"),
            key=lambda e: e.at_seconds or 0.0,
        )
        if not time_events or self._time_events_task is not None:
            return
        self._time_events_task = asyncio.create_task(
            self._time_events_loop(time_events)
        )

    async def _time_events_loop(self, time_events) -> None:
        try:
            for event in time_events:
                target = float(event.at_seconds or 0.0)
                delay = target - self._elapsed_seconds()
                if delay > 0:
                    if self._session_clock is not None:
                        # Pause-aware: paused time never advances the trigger.
                        await self._session_clock.sleep(delay)
                    else:
                        await asyncio.sleep(delay)
                snapshot = await self.state_store.snapshot()
                if event.once and event.id in snapshot.fired_events:
                    continue
                direction = truncate_stage_direction(event.direction) or ""
                updated = await self.state_store.apply_stage_direction(
                    direction, event_id=event.id
                )
                self.emitter.emit_stage_direction(
                    updated.turn_index,
                    direction,
                    kind="engineered_event",
                    event_id=event.id,
                )
                logger.info(
                    "[roleplay_v2] Time event %s fired at ~%.0fs", event.id, target
                )
        except asyncio.CancelledError:
            pass
        except Exception:  # noqa: BLE001 - events must never kill the session
            logger.exception("[roleplay_v2] time-events loop crashed")

    def _elapsed_seconds(self) -> float:
        if self._session_clock is not None:
            try:
                # SessionClock.elapsed() = active (pause-aware) seconds.
                return float(self._session_clock.elapsed())
            except Exception:  # noqa: BLE001 - clock API drift tolerated
                pass
        return time.monotonic() - self._started_monotonic

    # ------------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------------

    async def flush(self, timeout_s: float = 10.0) -> None:
        """Await in-flight verdict tasks and stop the time loop."""
        if self._time_events_task is not None:
            self._time_events_task.cancel()
            try:
                await self._time_events_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._time_events_task = None
        pending = [t for t in self._tasks if not t.done()]
        if pending:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*pending, return_exceptions=True), timeout_s
                )
            except asyncio.TimeoutError:
                logger.warning(
                    "[roleplay_v2] director flush timed out with %d task(s)",
                    len(pending),
                )
        await self.emitter.flush()

    async def emit_session_summary(self) -> None:
        """Ship the roleplay_session_summary SQS message (shutdown path)."""
        snapshot = await self.state_store.snapshot()
        self.emitter.emit_session_summary(
            final_state_id=snapshot.current_state_id,
            state_path=snapshot.state_path,
            ledger=snapshot.ledger,
            cumulative_score=snapshot.cumulative_score,
            behavior_hits=snapshot.behavior_hits,
            director_commits=snapshot.director_commits,
            director_misses=snapshot.director_misses,
        )
        await self.emitter.flush()
