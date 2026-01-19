"""
Expression registry for tracking event states and evaluating combination expressions.
Includes built-in scheduling for time-based events (no external registry needed).
"""

from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Tuple

from livekit import rtc

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
from app.core.graph import agent_graph
from app.core.graph.state import BranchingAndFeedbackData
from app.core.graph.utils import is_event_eligible
from app.core.scenario.base import Scenario, TerminationEvent
from app.utils.event_utils import evaluate_expression, extract_event_ids_from_expression
from app.utils.logger import get_logger

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
        room: rtc.Room,
        thread_id: str,
        termination_callback: Optional[callable] = None,
        agent_joined_at: Optional[datetime] = None,
    ):
        self.events = scenario.events
        self._event_map = {e.event_id: e for e in self.events}
        self.event_registry: Dict[str, EventRegistryEntry] = {}
        self.expression_list: List[ExpressionListEntry] = []
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
        # Store session reference for termination
        self._session = None
        # Track if termination has been initiated (session-level flag)
        self._termination_initiated = False
        self.room = room
        self.thread_id = thread_id
        self.score_based_events = [
            event
            for event in self.events
            if event.detection_type == DetectionType.SCORE
        ]
        self.agent_joined_at = datetime.now(timezone.utc)
        # Track deferred termination events that should be sent only after
        # shutdown. This prevents the backend from closing the room before
        # the agent finishes speaking the termination message. The event will
        # be sent in the shutdown callback after audio playback.
        self._init_event_sender()
        # Track cumulative score of events sent to core
        self._init_score_evaluator()
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
        Creates event_registry entries with structure:
        {
            "happened": false,  # Initial state based on event type
            "trigger_multiple": bool  # True for SENTENCE_SIMILARITY and
                                      # SEMANTIC_SIMILARITY, False for
                                      # TIME/SCORE/COMBINATION
        }
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

    async def initialize(self) -> None:
        """
        Initialize the event orchestrator and send initial events.

        This method:
        1. Sends initial score-based events to Core (example: score < 5)
        2. Updates graph state with initial branching_and_feedback_data
        3. Starts timers for all TIME events
        """
        # Send initial score-based events to Core (example: score < 5)
        (
            _,
            additional_score,
            branching_and_feedback_data,
        ) = await self.orchestrate_events(room=self.room, detected_event_ids=None)

        # Update graph state with initial branching_and_feedback_data
        # if any were triggered
        if agent_graph and self.thread_id and branching_and_feedback_data:
            logger.info(
                f"Updating graph state with {len(branching_and_feedback_data)} "
                f"initial branching and feedback data entries"
            )
            agent_graph.update_state(
                {"configurable": {"thread_id": self.thread_id}},
                values={"branching_and_feedback_data": branching_and_feedback_data},
            )

        # Start timers for all TIME events
        await self._scheduler.start_time_event_schedulers(
            events=self.events,
            event_registry=self.event_registry,
            event_notifier=self.orchestrate_events,
            get_live_score=lambda: self.live_score,
            room=self.room,
            default_seconds=60.0,
            agent_graph=agent_graph,
            thread_id=self.thread_id,
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
            if event_data.get("happened", False)
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
                detected_event_ids=all_detected_event_ids
            )
        )

        # Current History + New Event Points + Cascade Bonus Points
        projected_score = (
            self.live_score
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
            trigger_multiple = event_data.get("trigger_multiple")

            # Fall back to event type-based logic if trigger_multiple is None
            # This ensures HELPER_INTERRUPTED and other event types default to True
            if trigger_multiple is None:
                trigger_multiple = event.detection_type in (
                    DetectionType.SENTENCE_SIMILARITY,
                    DetectionType.SEMANTIC_SIMILARITY,
                    DetectionType.BINARY_CLASSIFIER,
                    DetectionType.HELPER_INTERRUPTED,
                    DetectionType.HELPER_PARAPHRASED,
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
                self._sent_events.add(
                    event.event_id
                )  # Track sent events even for trigger_multiple=True
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

    async def orchestrate_events(
        self,
        room: rtc.Room,
        detected_event_ids: Optional[Set[str]] = None,
    ) -> Tuple[List[BaseEvent], int, List[BranchingAndFeedbackData]]:
        """
        Orchestrates the complete event processing workflow.

        This function coordinates the complete event workflow by:
        1. Calling `_update_registry_and_collect_event_data` to update
           registry and gather event data
        2. Sending events to Core immediately (backend needs real-time updates)
        3. Collecting event data (branching + feedback) to be stored in state
        4. Updating live_score with scores from events sent to core
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
        await self._send_events_to_core(events_to_process, room)

        # Update live_score with scores from events sent to core
        await self._update_live_score(events_to_process)

        # Handle termination events after sending events (even if room is None)
        await self._handle_termination_events(events_to_process)

        return (
            successful_events,
            additional_score,
            branching_and_feedback_data,
        )

    def get_event_state(self, event_id: str) -> bool:
        """
        Get the current "happened" state of an event.

        Args:
            event_id: The event ID to check

        Returns:
            True if event's "happened" is True, False otherwise
        """
        event_data = self.event_registry.get(event_id)
        if event_data is None:
            return False
        return event_data.get("happened", False)

    def set_event_state(
        self, event_id: str, state: bool, event_type: DetectionType = None
    ) -> None:
        """
        Manually set the "happened" state of an event.

        Args:
            event_id: The event ID to update
            state: The new "happened" value (True/False)
        """
        timestamp = None
        if state:
            timestamp = datetime.now(timezone.utc)

        if event_id in self.event_registry:
            self.event_registry[event_id]["happened"] = state
            # Only run if state is false
            if state:
                # Get current count (default to 0 just in case) and increment
                current_count = self.event_registry[event_id].get("occurrence_count", 0)
                self.event_registry[event_id]["occurrence_count"] = current_count + 1

                self.event_registry[event_id]["occurred_at"] = timestamp
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
            )
            # If we are setting it to True immediately, count is 1.
            # If False, count is 0.
            initial_count = 1 if state else 0

            self.event_registry[event_id] = {
                "happened": state,
                "trigger_multiple": trigger_multiple,
                "occurred_at": timestamp,
                "occurrence_count": initial_count,
            }

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
            return event_data.get("occurred_at")
        return None

    def get_occurrence_count(self, event_id: str) -> int:
        entry = self.event_registry.get(event_id)
        if entry:
            return entry.get("occurrence_count", 0)
        return 0

    def _get_elapsed_time(self) -> float:
        """Calculates seconds since agent joined."""
        now = datetime.now(timezone.utc)
        return (now - self.agent_joined_at).total_seconds()
