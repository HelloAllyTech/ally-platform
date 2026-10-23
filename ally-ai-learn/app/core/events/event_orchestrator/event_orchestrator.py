"""
Expression registry for tracking event states and evaluating combination expressions.
Includes built-in scheduling for time-based events (no external registry needed).
"""

import asyncio
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Tuple

from livekit import rtc

from app.core.config import settings
from app.core.constants import DetectionType
from app.core.events.base import BaseEvent
from app.core.events.event_orchestrator.event_sender import EventSender
from app.core.events.event_orchestrator.score_evaluator import ScoreEvaluatorMixin
from app.core.events.event_types.combination.constants import (
    CombinationData,
    ExpressionNode,
)
from app.core.events.schedulers import TimeEventScheduler
from app.core.events.schemas import EventRegistryEntry, ExpressionListEntry
from app.core.events.utils import evaluate_expression, extract_event_ids_from_expression
from app.core.graph.state import BranchingAndFeedbackData
from app.core.graph.utils import is_event_eligible
from app.core.logger import get_logger
from app.core.scenario.base import Scenario, TerminationEvent
from app.core.scoring.score_keeper import ScoreKeeper

logger = get_logger(__name__)


class EventOrchestrator(ScoreEvaluatorMixin, EventSender):
    """
    Registry for tracking event states and managing combination expressions.

    Event orchestrator structure:
        event_registry[event_id] = EventRegistryEntry with:
            - happened: bool  # Whether the event has occurred/is active
            - trigger_multiple: bool  # True for sentence/semantic similarity
                                      # events (can trigger multiple times),
                                      # False for time/score/combination
                                      # events (trigger once)

    Args:
        scenario: Scenario instance containing events and trigger_events
        termination_callback: Optional callback function to call when a
            termination event occurs. Called with the terminating event
            as argument.
        room: LiveKit room instance for sending events
        thread_id: Thread ID for the current conversation session
            (used to get current score from LangGraph)
    """

    def __init__(
        self,
        scenario: Scenario,
        thread_id: str,
        room: Optional[rtc.Room] = None,
        termination_callback: Optional[callable] = None,
        agent_joined_at: Optional[datetime] = None,
        is_report_mode: bool = False,
        score_keeper: Optional[ScoreKeeper] = None,
        session_clock=None,
    ):
        self.is_report_mode = is_report_mode
        # Pause-aware clock (single source of active-elapsed time). When set,
        # _get_elapsed_time and the time-event scheduler exclude paused time.
        self._session_clock = session_clock
        self.events = scenario.events
        self._event_map = {e.event_id: e for e in self.events}
        self.event_registry: Dict[str, EventRegistryEntry] = {}
        self.expression_list: List[ExpressionListEntry] = []
        # Strong refs to in-flight fire-and-forget side-effect tasks (e.g. the
        # async SQS send when ORCHESTRATION_ASYNC_SQS is on) so they are not
        # garbage-collected mid-flight ("Task was destroyed but it is pending").
        self._background_tasks: Set[asyncio.Task] = set()
        # Time event scheduler for managing asyncio timers
        self._scheduler = TimeEventScheduler()
        # Track events that have been sent (for events with trigger_multiple=False)
        self._sent_events: Set[str] = set()
        # Set of event IDs that should be sent to UI/Core (for O(1) lookup)
        self.trigger_events: Set[str] = (
            set(scenario.trigger_events) if scenario.trigger_events else set()
        )
        self.initial_time = 0.0
        self.termination_callback = termination_callback
        # Store termination event configurations from scenario (list of events)
        self.termination_events: List[TerminationEvent] = (
            scenario.termination_events or []
        )
        # Build set of termination event IDs for O(1) lookup
        self.termination_event_ids: Set[str] = {te.id for te in self.termination_events}
        if self.termination_events:
            logger.debug(
                f"Termination configured for events: "
                f"{[te.id for te in self.termination_events]}"
            )
        # Flag to track if termination flow has started.
        # Once started, additional termination events will be ignored.
        self._termination_flow_started: bool = False
        # Track if termination has been initiated (session-level flag)
        self._termination_initiated = False
        self.room = room
        self.thread_id = thread_id
        self.score_based_events = [
            event
            for event in self.events
            if event.detection_type == DetectionType.SCORE
        ]
        # ---- EVENTS_OFF_GATE_DEFER_DETECTION partition (config-time) ----
        self.deferrable_detection_event_ids: Set[str] = (
            self._compute_deferrable_detection_event_ids(
                self.events, self.termination_event_ids
            )
        )
        #: Non-gating combinations, evaluated by the deferred pass
        #: (EVENTS_DEFER_NON_GATING_COMBINATIONS). Empty when the flag is off.
        self.deferred_combination_ids: Set[str] = (
            {
                e.event_id
                for e in self.events
                if e.detection_type == DetectionType.COMBINATION
            }
            - self._gating_combination_ids(self.events, self.termination_event_ids)
            if settings.EVENTS_DEFER_NON_GATING_COMBINATIONS
            else set()
        )
        if self.deferrable_detection_event_ids:
            logger.debug(
                "EVENTS_OFF_GATE_DEFER_DETECTION: %d deferrable leaf event(s): %s",
                len(self.deferrable_detection_event_ids),
                sorted(self.deferrable_detection_event_ids),
            )
        self.agent_joined_at = datetime.now(timezone.utc)
        # Track deferred termination events that should be sent only after
        # shutdown. This prevents the backend from closing the room before
        # the agent finishes speaking the termination message. The event will
        # be sent in the shutdown callback after audio playback.
        self._init_event_sender()
        # ScoreKeeper is the single source of truth for all scoring.
        # Create one if not provided (e.g. in tests or report mode).
        self._init_score_evaluator(score_keeper or ScoreKeeper())
        self.setup_initial_state()

    def _has_circular_dependency(
        self, event_id: str, expression: ExpressionNode
    ) -> bool:
        """
        Check if a combination event has a circular dependency (references itself).

        Args:
            event_id: The event ID to check
            expression: The expression tree to check

        Returns:
            True if the event references itself (circular dependency), False otherwise
        """
        referenced_event_ids = extract_event_ids_from_expression(expression)
        return event_id in referenced_event_ids

    def setup_initial_state(self) -> None:
        """
        Initialize registry state (synchronous). Does NOT start timers.
        Creates event_registry entries as EventRegistryEntry objects with:
            - happened: bool = False  # Initial state based on event type
            - trigger_multiple: bool  # True for SENTENCE_SIMILARITY and
                                     # SEMANTIC_SIMILARITY, False for
                                     # TIME/SCORE/COMBINATION
            - occurred_at: Optional[datetime] = None
            - occurrence_count: int = 0
        Build expression list for combination events, excluding those with
        circular dependencies.
        """
        # Initialize event states based on their detection type
        for event in self.events:
            # For combination events, check for circular dependency first
            if event.detection_type == DetectionType.COMBINATION:
                if isinstance(event.data, CombinationData):
                    # Check for circular dependency - if found, completely
                    # ignore this event
                    if self._has_circular_dependency(
                        event.event_id, event.data.expression
                    ):
                        logger.warning(
                            f"Circular dependency detected: combination event "
                            f"'{event.event_id}' references itself in its "
                            f"expression. This event will be completely "
                            f"ignored (not added to registry or expression "
                            f"list)."
                        )
                        # Skip this event entirely - don't add to
                        # event_registry or expression_list
                        continue

                    # No circular dependency - add to registry and expression list
                    self.set_event_state(event.event_id, False, event.detection_type)
                    # Create expression list entry matching
                    # ExpressionListEntry structure
                    self.expression_list.append(
                        {
                            "event_id": event.event_id,
                            "type": DetectionType.COMBINATION,
                            "expression": event.data.expression,
                        }
                    )
            else:
                # Non-combination events: add to registry normally
                self.set_event_state(event.event_id, False, event.detection_type)

    async def initialize(self, graph=None) -> None:
        """
        Initialize the event orchestrator and send initial events.

        This method:
        1. Sends initial score-based events to Core (example: score < 5)
        2. Updates graph state with initial branching_and_feedback_data
        3. Starts timers for all TIME events

        Args:
            graph: Optional compiled LangGraph instance. When provided
                (e.g. in report mode), this graph is used instead of
                the global ``agent_graph``. This keeps report state
                isolated from the live-agent graph.
        """
        # Send initial score-based events to Core (example: score < 5)
        (
            _,
            additional_score,
            branching_and_feedback_data,
        ) = await self.orchestrate_events(room=self.room, detected_event_ids=None)

        # Resolve which graph to use: caller-supplied or global
        if graph is None:
            # Lazy import to avoid circular dependency
            from app.core.graph import agent_graph

            resolved_graph = agent_graph
        else:
            resolved_graph = graph

        # Update graph state with initial branching_and_feedback_data
        # if any were triggered
        if resolved_graph and self.thread_id and branching_and_feedback_data:
            logger.info(
                f"Updating graph state with {len(branching_and_feedback_data)} "
                f"initial branching and feedback data entries"
            )
            resolved_graph.update_state(
                {"configurable": {"thread_id": self.thread_id}},
                values={"branching_and_feedback_data": branching_and_feedback_data},
            )

        # Start timers for all TIME events
        await self._scheduler.start_time_event_schedulers(
            events=self.events,
            event_registry=self.event_registry,
            event_notifier=self.orchestrate_events,
            get_live_score=lambda: self.score_keeper.get_total_score(),
            room=self.room,
            default_seconds=60.0,
            agent_graph=resolved_graph,
            thread_id=self.thread_id,
            session_clock=self._session_clock,
        )

    def update(
        self, detected_event_ids: Optional[Set[str]] = None, current_score: int = 0
    ) -> Dict[str, EventRegistryEntry]:

        # Calculate real elapsed time
        elapsed_time = self._get_elapsed_time()
        # Use internal score from Mixin
        current_score = current_score

        if detected_event_ids:
            for event_id in detected_event_ids:
                mapped_event = self._event_map.get(event_id)
                interval = (
                    int(mapped_event.detection_config.occurrence_interval)
                    if (
                        mapped_event
                        and mapped_event.detection_config
                        and mapped_event.detection_config.occurrence_interval
                        is not None
                    )
                    else None
                )

                if interval is not None:
                    # Ensure the entry exists before mutating detection_count
                    if event_id not in self.event_registry:
                        self.set_event_state(event_id, False)

                    self.event_registry[event_id].detection_count += 1
                    current_count = self.event_registry[event_id].detection_count

                    if current_count % interval == 0:
                        self.set_event_state(event_id, True)
                    else:
                        # Explicitly mark as not active so combination
                        # expressions evaluate the correct state
                        self.event_registry[event_id].happened = False
                else:
                    self.set_event_state(event_id, True)

        for expr_info in self.expression_list:
            if expr_info["type"] == DetectionType.COMBINATION:
                event_id = expr_info["event_id"]
                expression = expr_info["expression"]

                # 1. Evaluate Logic
                logic_result = evaluate_expression(expression, self.event_registry)
                final_result = logic_result

                # 2. If Logic is True, Check Eligibility Constraints
                if logic_result:
                    event = self._event_map.get(event_id)

                    if event:
                        last_at = self.get_last_occurred_at(event_id)
                        count = self.get_occurrence_count(event_id)

                        # Check Max Occurrences, Time Window, Score Window, Cooldown
                        if not is_event_eligible(
                            event=event,
                            elapsed_time=elapsed_time,
                            current_score=current_score,
                            last_occurred_at=last_at,
                            occurrence_count=count,
                        ):
                            final_result = False

                self.set_event_state(event_id, final_result, DetectionType.COMBINATION)
        return self.event_registry.copy()

    def get_happened_events(self) -> List[BaseEvent]:
        # Get all events that have happened (happened=True) in the registry.
        happened_event_ids = {
            event_id
            for event_id, event_data in self.event_registry.items()
            if event_data.happened
        }
        event_map = {event.event_id: event for event in self.events}
        happened_events = [
            event_map[event_id]
            for event_id in happened_event_ids
            if event_id in event_map
        ]
        return happened_events

    def _update_registry_and_collect_event_data(
        self, detected_event_ids: Optional[Set[str]] = None
    ) -> Tuple[
        List[BaseEvent],
        List[BaseEvent],
        int,
        List["BranchingAndFeedbackData"],
    ]:
        """
        Update the event registry and collect all output data.

        This method focuses on updating the registry state and gathering
        data without sending events.
        It performs:
        1. Processing score-based events (cascading score changes)
        2. Updating the registry and evaluating combination expressions
        3. Getting successful events from the registry
        4. Filtering events to send based on trigger_multiple flag
        5. Collecting unified branching and feedback data for state

        Args:
            detected_event_ids: Optional set of event IDs that have been detected.
                              If None, will still evaluate combination expressions.

        Returns:
            Tuple of (successful_events, events_to_send, additional_score,
                      branching_and_feedback_data)
            - successful_events: All events where happened=True in registry
            - events_to_send: Filtered events that should be sent
              (respecting trigger_multiple)
            - additional_score: Additional score from score-based/combination/
              time events
            - branching_and_feedback_data: List of BranchingAndFeedbackData objects
              (unified branching + feedback)
        """

        elapsed_time = self._get_elapsed_time()

        # Combine detected event IDs with score-based event IDs
        all_detected_event_ids = (
            set(detected_event_ids) if detected_event_ids else set()
        )

        # We sum these points to let combination events "see" the new score immediately.
        score_from_new_events = 0
        if detected_event_ids:
            for eid in detected_event_ids:
                # Use the map for O(1) lookup
                if event := self._event_map.get(eid):
                    score_from_new_events += event.score or 0

        # Process score-based events and get additional score
        all_detected_event_ids, additional_score_from_triggered_events = (
            self._evaluate_and_handle_cascade_score_events(
                detected_event_ids=all_detected_event_ids, elapsed_time=elapsed_time
            )
        )

        # Current History + New Event Points + Cascade Bonus Points
        # Uses total score (events + behaviors) so combination event eligibility
        # checks reflect the full session score.
        projected_score = (
            self.score_keeper.get_total_score()
            + score_from_new_events
            + additional_score_from_triggered_events
        )

        # Update the registry (and evaluate combination expressions)
        if all_detected_event_ids:
            updated_states = self.update(
                detected_event_ids=all_detected_event_ids, current_score=projected_score
            )
            logger.info(
                f"Expression registry updated with detected events: "
                f"{all_detected_event_ids}"
            )
            logger.info(f"Expression registry state: {updated_states}")

        else:
            updated_states = self.update(
                detected_event_ids=None, current_score=projected_score
            )
            logger.debug(
                f"Expression registry updated (no new events detected). "
                f"Registry state: {updated_states}"
            )

        logger.debug(
            f"Expression registry details - Total events: {len(self.event_registry)}, "
            f"Combination expressions: {len(self.expression_list)}"
        )

        # Get all successful events
        successful_events = self.get_happened_events()
        logger.info(
            f"Successful events from registry: "
            f"{[e.event_id for e in successful_events]}"
        )

        # Filter events to send based on trigger_multiple flag and trigger_events list
        events_to_process = []
        for event in successful_events:
            # First check if event is in trigger_events (if trigger_events is specified)
            # Exception: Termination events are ALWAYS processed,
            # even if not in trigger_events
            if (
                self.trigger_events is not None
                and event.event_id not in self.trigger_events
                and event.event_id not in self.termination_event_ids
            ):
                logger.debug(
                    f"Event {event.event_id} skipped (not in trigger_events list)"
                )
                continue

            event_data = self.event_registry.get(event.event_id)
            if event_data is None:
                continue

            # Get trigger_multiple from event_data, or derive from event type if missing
            trigger_multiple = event_data.trigger_multiple

            # Fall back to event type-based logic if trigger_multiple is None
            # This ensures HELPER_INTERRUPTED and other event types default to True
            if trigger_multiple is None:
                trigger_multiple = event.detection_type in (
                    DetectionType.SENTENCE_SIMILARITY,
                    DetectionType.SEMANTIC_SIMILARITY,
                    DetectionType.BINARY_CLASSIFIER,
                    DetectionType.HELPER_INTERRUPTED,
                    DetectionType.HELPER_PARAPHRASED,
                    DetectionType.GUARDRAIL,
                )

            # Special case: termination events should only be sent once,
            # even if trigger_multiple=True
            # This prevents duplicate termination callbacks
            if (
                event.event_id in self.termination_event_ids
                and event.event_id in self._sent_events
            ):
                logger.debug(
                    f"Event {event.event_id} skipped (termination event already sent)"
                )
                continue

            # If trigger_multiple is True, always send
            # If trigger_multiple is False, only send if not sent before
            if trigger_multiple and event.event_id in all_detected_event_ids:
                events_to_process.append(event)
                self._sent_events.add(event.event_id)
                logger.debug(
                    f"Event {event.event_id} will be sent (trigger_multiple=True)"
                )
            elif event.event_id not in self._sent_events:
                events_to_process.append(event)
                self._sent_events.add(event.event_id)
                logger.debug(
                    f"Event {event.event_id} will be sent (first time, "
                    f"trigger_multiple=False)"
                )
            else:
                logger.debug(
                    f"Event {event.event_id} skipped (already sent, "
                    f"trigger_multiple=False)"
                )

        # Collect unified branching and feedback data for state
        branching_and_feedback_data = self._collect_branching_and_feedback_data(
            events_to_process
        )

        return (
            successful_events,
            events_to_process,
            additional_score_from_triggered_events,
            branching_and_feedback_data,
        )

    def _spawn_background(self, coro, label: str) -> None:
        """Run a side-effect coroutine off the critical path.

        Keeps a strong reference to the task until it finishes (so it is not
        GC'd while pending) and logs any exception instead of letting it escape
        unobserved. Used for fire-and-forget SQS sends; the caller does not
        await the result.
        """
        task = asyncio.ensure_future(coro)
        self._background_tasks.add(task)

        def _on_done(t: asyncio.Task) -> None:
            self._background_tasks.discard(t)
            if t.cancelled():
                return
            exc = t.exception()
            if exc is not None:
                logger.error(
                    "[orchestrate_events] background %s failed: %r", label, exc
                )

        task.add_done_callback(_on_done)

    async def orchestrate_events(
        self,
        room: Optional[rtc.Room] = None,
        detected_event_ids: Optional[Set[str]] = None,
    ) -> Tuple[List[BaseEvent], int, List[BranchingAndFeedbackData]]:
        """
        Orchestrates the complete event processing workflow.

        This function coordinates the complete event workflow by:
        1. Calling `_update_registry_and_collect_event_data` to update
           registry and gather event data
        2. Sending events to Core immediately (backend needs real-time updates)
        3. Collecting event data (branching + feedback) to be stored in state
        4. Committing event scores to ScoreKeeper
        5. Returning the collected data for use by the caller

        Note: UI events are no longer sent here. Instead,
        branching_and_feedback_data is returned and stored in state,
        then processed in generate_response to determine which feedback
        message to send to UI.

        Args:
            room: LiveKit room instance for sending events
            detected_event_ids: Set of event IDs that have been detected

        Returns:
            Tuple of (successful_events, additional_score_from_triggered_events,
                      branching_and_feedback_data)
            - successful_events: All events where happened=True in registry
            - additional_score_from_triggered_events: Additional score from
              triggered events
            - branching_and_feedback_data: List of BranchingAndFeedbackData objects
              (unified branching + feedback)
        """
        # Update registry and collect all data
        (
            successful_events,
            events_to_process,
            additional_score,
            branching_and_feedback_data,
        ) = self._update_registry_and_collect_event_data(
            detected_event_ids=detected_event_ids
        )

        # Send events to Core immediately (backend needs real-time updates)
        # UI events are handled via branching_and_feedback_data in generate_response
        # In report mode, skip SQS entirely -- results are delivered via webhook
        if not self.is_report_mode:
            if settings.EVENTS_OFF_GATE:
                # Latency lever: only branching + guardrail + termination events
                # shape the reply. Send those to Core on the gate (awaited) and
                # fire-and-forget the NON-branching ones off the voice-to-voice
                # critical path. Branching status is config-time
                # (branching_instruction is not None); termination is forced into
                # the gating slice so its deferred-to-shutdown handling stays on
                # the synchronous path. This only defers the non-branching SQS
                # send — score commit + termination below still run on the FULL
                # set on the gate. We partition the OUTPUT events_to_process here;
                # the registry/cascade pass already ran once above. Takes
                # precedence over ORCHESTRATION_ASYNC_SQS. See EVENTS_OFF_GATE.
                gate_events = [
                    e
                    for e in events_to_process
                    if e.branching_instruction is not None
                    or e.event_id in self.termination_event_ids
                ]
                gate_ids = {e.event_id for e in gate_events}
                offgate_events = [
                    e for e in events_to_process if e.event_id not in gate_ids
                ]
                await self._send_events_to_core(gate_events, room)
                if offgate_events:
                    self._spawn_background(
                        self._send_events_to_core(offgate_events, room),
                        label="send_events_to_core_offgate",
                    )
            elif settings.ORCHESTRATION_ASYNC_SQS:
                # Latency lever: the SQS round-trip is on the fan-in critical
                # path before generate_response, but the spoken reply does not
                # depend on it. Fire it off so orchestrate_events can return the
                # branching data immediately. See ORCHESTRATION_ASYNC_SQS.
                self._spawn_background(
                    self._send_events_to_core(events_to_process, room),
                    label="send_events_to_core",
                )
            else:
                await self._send_events_to_core(events_to_process, room)

        # Commit event scores to ScoreKeeper. Always the FULL event set, even
        # under EVENTS_OFF_GATE — keeps reply-state selection, the next-turn
        # cascade baseline, and the authoritative final score correct.
        await self._update_event_score(events_to_process)

        # Handle termination events after sending events (even if room is None).
        # Full set, single synchronous path — one-shot termination guards intact.
        await self._handle_termination_events(events_to_process)

        return (
            successful_events,
            additional_score,
            branching_and_feedback_data,
        )

    @staticmethod
    def _gating_combination_ids(
        events: List[BaseEvent], termination_event_ids: Set[str]
    ) -> Set[str]:
        """Combinations that shape the reply: branching or termination ones,
        plus every combination they reference (transitively)."""
        combinations = {
            e.event_id: e
            for e in events
            if e.detection_type == DetectionType.COMBINATION
        }

        def _refs(combo: BaseEvent) -> Set[str]:
            expr = getattr(getattr(combo, "data", None), "expression", None)
            return (
                extract_event_ids_from_expression(expr) if expr is not None else set()
            )

        gating = {
            cid
            for cid, combo in combinations.items()
            if combo.branching_instruction is not None or cid in termination_event_ids
        }
        frontier = list(gating)
        while frontier:
            for ref in _refs(combinations[frontier.pop()]):
                if ref in combinations and ref not in gating:
                    gating.add(ref)
                    frontier.append(ref)
        return gating

    @staticmethod
    def _compute_deferrable_detection_event_ids(
        events: List[BaseEvent], termination_event_ids: Set[str]
    ) -> Set[str]:
        """Config-time partition: leaf events whose DETECTION may be deferred.

        Deferrable = classifier/similarity leaves that are NOT branching, NOT
        termination, and NOT referenced by any combination expression.
        Combination-referenced leaves MUST gate: deferring a combination input
        could make the combination permanently miss (its inputs would never be
        ``happened`` in the same turn), not merely lag a turn. Branching/guardrail
        (guardrails carry a branching instruction) and termination always shape
        the reply, so they gate too.
        """
        combinations = {
            e.event_id: e
            for e in events
            if e.detection_type == DetectionType.COMBINATION
        }

        def _refs(combo: BaseEvent) -> Set[str]:
            expr = getattr(getattr(combo, "data", None), "expression", None)
            return (
                extract_event_ids_from_expression(expr) if expr is not None else set()
            )

        if settings.EVENTS_DEFER_NON_GATING_COMBINATIONS:
            # Only combinations that shape the reply (branching / termination),
            # and the combinations they nest, keep their inputs on the gate. A
            # non-gating combination's inputs are deferred with it: the deferred
            # pass marks them happened and evaluates the combination itself
            # (process_ready_deferred_combinations), so it fires seconds after
            # the reply starts rather than on the next turn; the next gate pass
            # and the shutdown pass are safety nets. In prod the busiest
            # scenarios had 34 combinations and none branched or terminated, yet
            # their ~16-20 leaf classifiers held every reply.
            gating = EventOrchestrator._gating_combination_ids(
                events, termination_event_ids
            )
            sources = [combinations[cid] for cid in gating]
        else:
            sources = list(combinations.values())
        combination_referenced_ids: Set[str] = set()
        for combo in sources:
            combination_referenced_ids |= _refs(combo)
        deferrable_types = {
            DetectionType.BINARY_CLASSIFIER,
            DetectionType.SENTENCE_SIMILARITY,
            DetectionType.SEMANTIC_SIMILARITY,
            DetectionType.HELPER_INTERRUPTED,
            DetectionType.HELPER_PARAPHRASED,
        }
        return {
            e.event_id
            for e in events
            if e.branching_instruction is None
            and e.event_id not in termination_event_ids
            and e.event_id not in combination_referenced_ids
            and e.detection_type in deferrable_types
        }

    def process_ready_deferred_combinations(self) -> List[BaseEvent]:
        """Fire every deferred combination whose inputs are now satisfied.

        Evaluates ONLY non-gating combinations (``deferred_combination_ids``):
        the expression against the persistent registry, then the same
        eligibility checks the gate pass applies. A combination that fires is
        marked happened and recorded in ``_sent_events`` before returning, with
        no await in between, so the gate pass (which also evaluates every
        combination, as a safety net) cannot process it a second time.
        Returns the newly fired combinations for the caller to send and score.
        """
        if not self.deferred_combination_ids:
            return []
        elapsed_time = self._get_elapsed_time()
        current_score = self.score_keeper.get_total_score()
        fired: List[BaseEvent] = []
        for info in self.expression_list:
            event_id = info.get("event_id")
            if (
                info.get("type") != DetectionType.COMBINATION
                or event_id not in self.deferred_combination_ids
                or event_id in self._sent_events
            ):
                continue
            if self.trigger_events is not None and event_id not in self.trigger_events:
                continue
            if not evaluate_expression(info["expression"], self.event_registry):
                continue
            event = self._event_map.get(event_id)
            if event is None or not is_event_eligible(
                event=event,
                elapsed_time=elapsed_time,
                current_score=current_score,
                last_occurred_at=self.get_last_occurred_at(event_id),
                occurrence_count=self.get_occurrence_count(event_id),
            ):
                continue
            self.set_event_state(event_id, True, DetectionType.COMBINATION)
            self._sent_events.add(event_id)
            fired.append(event)
        return fired

    async def evaluate_deferred_combinations(self, room=None) -> int:
        """Final deferred-combination pass at shutdown (safety net).

        The deferred pass normally fires these combinations itself; this
        catches one whose inputs landed in a deferred task that finished during
        the shutdown drain. Returns how many fired.
        """
        if not settings.EVENTS_DEFER_NON_GATING_COMBINATIONS:
            return 0
        fired = self.process_ready_deferred_combinations()
        if not fired:
            return 0
        if not self.is_report_mode:
            await self._send_events_to_core(fired, room)
        await self._update_event_score(fired)
        logger.info(
            "[EVENTS] final deferred-combination pass processed %d: %s",
            len(fired),
            [e.event_id for e in fired],
        )
        return len(fired)

    def _mark_deferred_leaf_detections(self, detected_event_ids: Set[str]) -> None:
        """Mark detected deferred leaf events ``happened`` (occurrence-interval aware).

        Mirrors the per-event marking in ``update()`` (the detected_event_ids
        loop) but does NOT evaluate combination expressions or run cascade scoring
        — deferred events are referenced by no combination, so combinations and
        cascade were already evaluated correctly on the gate. Used only by
        ``orchestrate_deferred_events`` (EVENTS_OFF_GATE_DEFER_DETECTION).
        """
        for event_id in detected_event_ids:
            mapped_event = self._event_map.get(event_id)
            interval = (
                int(mapped_event.detection_config.occurrence_interval)
                if (
                    mapped_event
                    and mapped_event.detection_config
                    and mapped_event.detection_config.occurrence_interval is not None
                )
                else None
            )
            if interval is not None:
                if event_id not in self.event_registry:
                    self.set_event_state(event_id, False)
                self.event_registry[event_id].detection_count += 1
                current_count = self.event_registry[event_id].detection_count
                if current_count % interval == 0:
                    self.set_event_state(event_id, True)
                else:
                    self.event_registry[event_id].happened = False
            else:
                self.set_event_state(event_id, True)

    def _filter_deferred_events_to_send(
        self, successful_events: List[BaseEvent], detected_event_ids: Set[str]
    ) -> List[BaseEvent]:
        """Filter deferred happened events for sending (trigger_multiple + dedup).

        Mirrors the trigger_events / trigger_multiple / _sent_events filtering in
        ``_update_registry_and_collect_event_data``, minus termination handling
        (deferred events are never termination events by construction).
        """
        events_to_process: List[BaseEvent] = []
        for event in successful_events:
            if (
                self.trigger_events is not None
                and event.event_id not in self.trigger_events
            ):
                continue
            event_data = self.event_registry.get(event.event_id)
            if event_data is None:
                continue
            trigger_multiple = event_data.trigger_multiple
            if trigger_multiple is None:
                trigger_multiple = event.detection_type in (
                    DetectionType.SENTENCE_SIMILARITY,
                    DetectionType.SEMANTIC_SIMILARITY,
                    DetectionType.BINARY_CLASSIFIER,
                    DetectionType.HELPER_INTERRUPTED,
                    DetectionType.HELPER_PARAPHRASED,
                    DetectionType.GUARDRAIL,
                )
            if trigger_multiple and event.event_id in detected_event_ids:
                events_to_process.append(event)
                self._sent_events.add(event.event_id)
            elif event.event_id not in self._sent_events:
                events_to_process.append(event)
                self._sent_events.add(event.event_id)
        return events_to_process

    async def orchestrate_deferred_events(
        self,
        detected_event_ids: Set[str],
        room: Optional[rtc.Room] = None,
    ) -> List["BranchingAndFeedbackData"]:
        """Off-gate processing for deferred (non-reply-shaping) events.

        Marks the detected deferred leaf events, fires any deferred (non-gating)
        combination they complete (EVENTS_DEFER_NON_GATING_COMBINATIONS), filters
        them for sending, sends them to Core, and commits their scores — WITHOUT
        re-running the gate's full combination
        evaluation, cascade scoring, or get_happened_events (those ran once on the
        gate). Safe because deferred events are non-branching, non-termination,
        and referenced by no combination (see ``deferrable_detection_event_ids``),
        so they cannot change the on-gate registry/cascade/combination result.

        Returns the collected (non-branching) feedback data for graph state.
        Used only by EVENTS_OFF_GATE_DEFER_DETECTION.
        """
        if not detected_event_ids:
            return []

        # Mark detected deferred leaves happened (no combination/cascade eval).
        self._mark_deferred_leaf_detections(detected_event_ids)

        happened_deferred: List[BaseEvent] = []
        for eid in detected_event_ids:
            entry = self.event_registry.get(eid)
            mapped = self._event_map.get(eid)
            if entry is not None and entry.happened and mapped is not None:
                happened_deferred.append(mapped)

        events_to_process = self._filter_deferred_events_to_send(
            happened_deferred, set(detected_event_ids)
        )
        # Non-gating combinations whose inputs this pass just marked fire now,
        # seconds after the reply starts, instead of on the next turn: their
        # checklist tick and score land while the character is still speaking.
        combos = self.process_ready_deferred_combinations()
        if combos:
            logger.info(
                "[EVENTS] deferred pass fired %d combination(s): %s",
                len(combos),
                [e.event_id for e in combos],
            )
            events_to_process = list(events_to_process) + combos

        feedback = self._collect_branching_and_feedback_data(events_to_process)

        # Send to Core off the gate (skipped in report mode, like the main pass).
        if not self.is_report_mode:
            await self._send_events_to_core(events_to_process, room)

        # Commit deferred scores. Off the gate by construction, so this turn's
        # reply may not see them (the accepted EVENTS_OFF_GATE_DEFER_DETECTION
        # race); they still land before finalize via the shutdown drain.
        await self._update_event_score(events_to_process)

        return feedback

    def get_event_state(self, event_id: str) -> bool:
        """
        Get the current happened state of an event.

        Args:
            event_id: The event ID to check

        Returns:
            True if event's happened attribute is True, False otherwise
        """
        event_data = self.event_registry.get(event_id)
        if event_data is None:
            return False
        return event_data.happened

    def set_event_state(
        self, event_id: str, state: bool, event_type: DetectionType = None
    ) -> None:
        """
        Manually set the happened state of an event.

        Args:
            event_id: The event ID to update
            state: The new happened value (True/False)
        """
        timestamp = None
        if state:
            timestamp = datetime.now(timezone.utc)

        if event_id in self.event_registry:
            self.event_registry[event_id].happened = state
            if state:
                # Get current count (default to 0 just in case) and increment
                self.event_registry[event_id].occurrence_count += 1
                self.event_registry[event_id].occurred_at = timestamp
        else:
            # If event not in registry, create entry with trigger_multiple
            # based on event type
            # SENTENCE_SIMILARITY, SEMANTIC_SIMILARITY, BINARY_CLASSIFIER,
            # HELPER_INTERRUPTED, and HELPER_PARAPHRASED events can trigger
            # multiple times
            trigger_multiple = event_type in (
                DetectionType.SENTENCE_SIMILARITY,
                DetectionType.SEMANTIC_SIMILARITY,
                DetectionType.BINARY_CLASSIFIER,
                DetectionType.HELPER_INTERRUPTED,
                DetectionType.HELPER_PARAPHRASED,
                DetectionType.GUARDRAIL,
            )
            # If we are setting it to True immediately, count is 1.
            # If False, count is 0.
            initial_count = 1 if state else 0

            self.event_registry[event_id] = EventRegistryEntry(
                happened=state,
                trigger_multiple=trigger_multiple,
                occurred_at=timestamp,
                occurrence_count=initial_count,
            )

    def is_termination_initiated(self) -> bool:
        """
        Check if termination has been initiated for this session.

        Returns:
            True if termination has been initiated, False otherwise
        """
        return self._termination_initiated

    def get_last_occurred_at(self, event_id: str) -> Optional[datetime]:
        """Returns the timestamp of when the event last occurred, or None."""
        event_data = self.event_registry.get(event_id)
        if event_data:
            return event_data.occurred_at
        return None

    def get_occurrence_count(self, event_id: str) -> int:
        entry = self.event_registry.get(event_id)
        if entry:
            return entry.occurrence_count
        return 0

    def get_detection_count(self, event_id: str) -> int:
        entry = self.event_registry.get(event_id)
        if entry:
            return entry.detection_count
        return 0

    def _get_elapsed_time(self) -> float:
        """Active seconds since agent joined, excluding any paused time."""
        if self._session_clock is not None:
            return self._session_clock.elapsed()
        now = datetime.now(timezone.utc)
        return (now - self.agent_joined_at).total_seconds()
