"""
Expression registry for tracking event states and evaluating combination expressions.
Includes built-in scheduling for time-based events (no external registry needed).
"""
import asyncio
import logging
from typing import List, Dict, Set, Optional, Any, Tuple

from livekit import rtc

from app.core.events.base import BaseEvent
from app.core.events.event_types.combination.constants import CombinationData, ExpressionNode
from app.core.constants import DetectionType, VisibilityType
from app.core.events.event_processor import EventProcessor
from app.core.events.schedulers import TimeEventScheduler
from app.core.events.schemas import CoreEventMessageType
from app.core.scenario.base import Scenario
from app.utils.event_handler import send_event_to_ui
from app.core.queue import msg_event_queue
from app.core.graph.utils import serialize_event
from app.utils.logger import get_logger
from app.core.events.schemas import EventRegistryEntry, ExpressionListEntry
from app.utils.event_utils import evaluate_condition, evaluate_expression, extract_event_ids_from_expression
from app.core.graph import agent_graph

logger = get_logger(__name__)


class EventOrchestrator:
    """
    Registry for tracking event states and managing combination expressions.
    
    Event orchestrator structure:
        event_registry[event_id] = EventRegistryEntry with:
            - happened: bool  # Whether the event has occurred/is active
            - trigger_multiple: bool  # True for sentence/semantic similarity events (can trigger multiple times),
                                      # False for time/score/combination events (trigger once)
    """

    def __init__(self, scenario: Scenario, room: rtc.Room, thread_id: str,
                 termination_callback: Optional[callable] = None):
        """
        Initialize the expression registry with a scenario.
        
        Args:
            scenario: Scenario instance containing events and trigger_events
            termination_callback: Optional callback function to call when a termination event occurs.
                                Called with the terminating event as argument.
            room: LiveKit room instance for sending events
            thread_id: Thread ID for the current conversation session (used to get current score from LangGraph)
        """
        self.events = scenario.events
        self.event_registry: Dict[str, EventRegistryEntry] = {}
        self.expression_list: List[ExpressionListEntry] = []
        # Time event scheduler for managing asyncio timers
        self._scheduler = TimeEventScheduler()
        # Track events that have been sent (for events with trigger_multiple=False)
        self._sent_events: Set[str] = set()
        # Set of event IDs that should be sent to UI/Core (for O(1) lookup)
        self.trigger_events: Set[str] = set(scenario.trigger_events) if scenario.trigger_events else set()
        self.initial_time = 0.0
        self.termination_callback = termination_callback
        # Store termination event configuration from scenario
        self.termination_event_id: Optional[str] = None
        self.termination_message: Optional[str] = None
        if scenario.termination_event:
            self.termination_event_id = scenario.termination_event.id
            self.termination_message = scenario.termination_event.termination_message
            logger.debug(f"Termination configured for event: {self.termination_event_id}")
        # Store session reference for termination
        self._session = None
        # Track if termination has been initiated (session-level flag)
        self._termination_initiated = False
        self.room = room
        self.thread_id = thread_id
        self.score_based_events = [event for event in self.events if event.detection_type == DetectionType.SCORE]
        # Track deferred termination events that should be sent only after shutdown.
        # This prevents the backend from closing the room before the agent finishes speaking
        # the termination message. The event will be sent in the shutdown callback after audio playback.
        self.deferred_termination_event: Optional[BaseEvent] = None
        # Track cumulative score of events sent to core
        self.live_score = 0
        # Lock for thread-safe live_score updates
        self._live_score_lock = asyncio.Lock()
        self.setup_initial_state()

    def _has_circular_dependency(self, event_id: str, expression: ExpressionNode) -> bool:
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
            "trigger_multiple": bool  # True for SENTENCE_SIMILARITY and SEMANTIC_SIMILARITY, False for TIME/SCORE/COMBINATION
        }
        Build expression list for combination events, excluding those with circular dependencies.
        """
        # Initialize event states based on their detection type
        for event in self.events:
            # For combination events, check for circular dependency first
            if event.detection_type == DetectionType.COMBINATION:
                if isinstance(event.data, CombinationData):
                    # Check for circular dependency - if found, completely ignore this event
                    if self._has_circular_dependency(event.event_id, event.data.expression):
                        logger.warning(
                            f"Circular dependency detected: combination event '{event.event_id}' references itself "
                            f"in its expression. This event will be completely ignored (not added to registry or expression list)."
                        )
                        # Skip this event entirely - don't add to event_registry or expression_list
                        continue
                    
                    # No circular dependency - add to registry and expression list
                    self.set_event_state(event.event_id, False, event.detection_type)
                    # Create expression list entry matching ExpressionListEntry structure
                    self.expression_list.append({
                        "event_id": event.event_id,
                        "type": DetectionType.COMBINATION,
                        "expression": event.data.expression,
                    })
            else:
                # Non-combination events: add to registry normally
                self.set_event_state(event.event_id, False, event.detection_type)

    async def initialize(self) -> None:
        # Send initial score-based events to UI and Core (example: score < 5)
        _, additional_score, branching_instructions = await self.handle_events(
            room=self.room,
            detected_event_ids=None
        )

        # Update graph state with initial branching instructions if any were triggered
        if agent_graph and self.thread_id and branching_instructions:
            logger.info(f"Updating graph state with {len(branching_instructions)} initial branching instructions")
            agent_graph.update_state(
                {"configurable": {"thread_id": self.thread_id}},
                values={"branching_instructions": branching_instructions},
            )

        # Start timers for all TIME events
        await self._scheduler.start_time_event_schedulers(
            events=self.events,
            event_registry=self.event_registry,
            event_notifier=self.handle_events,
            room=self.room,
            default_seconds=60.0,
            agent_graph=agent_graph,
            thread_id=self.thread_id
        )

    def update(self, detected_event_ids: Optional[Set[str]] = None) -> Dict[str, EventRegistryEntry]:
        if detected_event_ids:
            for event_id in detected_event_ids:
                self.set_event_state(event_id, True)

        for expr_info in self.expression_list:
            if expr_info["type"] == DetectionType.COMBINATION:
                event_id = expr_info["event_id"]
                expression = expr_info["expression"]
                
                # Evaluate expression
                result = evaluate_expression(expression, self.event_registry)
                self.set_event_state(event_id, result, DetectionType.COMBINATION)

        return self.event_registry.copy()

    def get_happened_events(self) -> List[BaseEvent]:
        # Get all events that have happened (happened=True) in the registry.
        happened_event_ids = {
            event_id for event_id, event_data in self.event_registry.items()
            if event_data.get("happened", False)
        }
        event_map = {event.event_id: event for event in self.events}
        happened_events = [
            event_map[event_id]
            for event_id in happened_event_ids
            if event_id in event_map
        ]
        return happened_events

    def _calculate_score_from_event_ids(self, event_ids: Set[str]) -> int:
        """
        Calculate the total score from a set of event IDs.
        Only includes events that are in the trigger_events list.

        Args:
            event_ids: Set of event IDs to calculate score for

        Returns:
            Total score from all events in the set that are also in trigger_events
        """
        event_map = {event.event_id: event for event in self.events}
        total_score = 0

        for event_id in event_ids:

            # Skip if event is not in trigger_events
            if event_id not in self.trigger_events:
                continue

            event = event_map[event_id]
            if event.score is not None:
                total_score += event.score

        return total_score

    def _evaluate_and_handle_cascade_score_events(
            self,
            detected_event_ids: Set[str]
    ) -> Tuple[Set[str], int]:
        """
        Evaluate score-based events and track cascading score changes.

        This method handles the cascading effect where score-based events can have their own scores
        which may trigger other score-based events.

        The method ensures score-based events trigger in the same cycle as the events that bring
        the score to the threshold by:
        1. Starting with live_score + score from current cycle's detected events
        2. Evaluating score-based events against this working score
        3. Cascading through any score-based events that trigger other score-based events

        Args:
            detected_event_ids: Set of already detected event IDs (will be modified in place).

        Returns:
            Tuple of (all_detected_event_ids, additional_score_from_triggered_events)
            - all_detected_event_ids: Updated set including score-triggered events
            - additional_score_from_triggered_events: Additional score from score-based events that were triggered
        """
        additional_score_from_triggered_events = 0
        
        # Calculate the score contribution from currently detected events (similarity, time, combination, etc.)
        # This excludes score-based events which will be evaluated in the cascade loop
        current_cycle_score = self._calculate_score_from_event_ids(detected_event_ids)

        # Start with live_score + current cycle's event scores
        # This ensures score-based events can trigger on the same cycle as the events that bring the score to threshold
        working_score = self.live_score + current_cycle_score

        if current_cycle_score != 0:
            logger.info(f"Current cycle adding {current_cycle_score} to live_score {self.live_score}. Working score: {working_score}")

        # Evaluate score-based events against the working score
        newly_triggered_score_event_ids = self.get_newly_triggered_score_events(working_score)

        # Keep checking for newly triggered score-based events until no more are triggered
        # This handles cascading: score-based events triggering other score-based events
        while newly_triggered_score_event_ids:
            logger.info(f"Score-based events triggered at score {working_score}: {newly_triggered_score_event_ids}")
            detected_event_ids.update(newly_triggered_score_event_ids)

            # Calculate additional score from newly triggered score-based events
            additional_score = self._calculate_score_from_event_ids(newly_triggered_score_event_ids)

            if additional_score != 0:
                additional_score_from_triggered_events += additional_score
                working_score += additional_score
                logger.info(f"Score changed by {additional_score} from triggered score-based events. New working score: {working_score}")

            # Check again with the new score to handle cascading
            # Loop will exit naturally when no more events trigger
            newly_triggered_score_event_ids = self.get_newly_triggered_score_events(working_score)

        return detected_event_ids, additional_score_from_triggered_events

    def _collect_branching_instructions(self, events_to_send: List[BaseEvent]) -> List[Tuple[str, int]]:
        """
        Collect branching instructions from triggered events.

        Args:
            events_to_send: List of events that will be sent

        Returns:
            List of (instruction, score) tuples from triggered events
        """
        branching_instructions: List[Tuple[str, int]] = []

        for event in events_to_send:
            if event.branching_instruction:
                # Create tuple: (instruction, score)
                # Use event.score if available, otherwise 0
                score = event.score if event.score is not None else 0
                branching_instructions.append((event.branching_instruction, score))
                logger.debug(
                    f"Collected branching instruction from {event.event_id}: '{event.branching_instruction}' (score={score})")

        if branching_instructions:
            logger.info(f"Collected {len(branching_instructions)} branching instructions")

        return branching_instructions

    def _update_registry_and_collect_event_data(
            self,
            detected_event_ids: Optional[Set[str]] = None
    ) -> Tuple[List[BaseEvent], List[BaseEvent], int, List[Tuple[str, int]]]:
        """
        Update the event registry and collect all output data.

        This method focuses on updating the registry state and gathering data without sending events.
        It performs:
        1. Processing score-based events (cascading score changes)
        2. Updating the registry and evaluating combination expressions
        3. Getting successful events from the registry
        4. Filtering events to send based on trigger_multiple flag
        5. Collecting branching instructions from triggered events

        Args:
            detected_event_ids: Optional set of event IDs that have been detected.
                              If None, will still evaluate combination expressions.

        Returns:
            Tuple of (successful_events, events_to_send, additional_score, branching_instructions)
            - successful_events: All events where happened=True in registry
            - events_to_send: Filtered events that should be sent (respecting trigger_multiple)
            - additional_score: Additional score from score-based/combination/time events
            - branching_instructions: List of (instruction, score) tuples from triggered events
        """
        # Combine detected event IDs with score-based event IDs
        all_detected_event_ids = set(detected_event_ids) if detected_event_ids else set()

        # Process score-based events and get additional score
        all_detected_event_ids, additional_score_from_triggered_events = self._evaluate_and_handle_cascade_score_events(
            detected_event_ids=all_detected_event_ids
        )

        # Update the registry (and evaluate combination expressions)
        if all_detected_event_ids:
            updated_states = self.update(detected_event_ids=all_detected_event_ids)
            logger.info(f"Expression registry updated with detected events: {all_detected_event_ids}")
            logger.info(f"Expression registry state: {updated_states}")
        else:
            updated_states = self.update(detected_event_ids=None)
            logger.debug(f"Expression registry updated (no new events detected). Registry state: {updated_states}")

        logger.debug(f"Expression registry details - Total events: {len(self.event_registry)}, "
                     f"Combination expressions: {len(self.expression_list)}")

        # Get all successful events
        successful_events = self.get_happened_events()
        logger.info(f"Successful events from registry: {[e.event_id for e in successful_events]}")

        # Filter events to send based on trigger_multiple flag and trigger_events list
        events_to_send = []
        for event in successful_events:
            # First check if event is in trigger_events (if trigger_events is specified)
            if self.trigger_events is not None and event.event_id not in self.trigger_events:
                logger.debug(f"Event {event.event_id} skipped (not in trigger_events list)")
                continue

            event_data = self.event_registry.get(event.event_id)
            if event_data is None:
                continue

            # Get trigger_multiple from event_data, or derive from event type if missing
            trigger_multiple = event_data.get("trigger_multiple")

            # Special case: termination events should only be sent once, even if trigger_multiple=True
            # This prevents duplicate termination callbacks
            if self.termination_event_id and event.event_id == self.termination_event_id and event.event_id in self._sent_events:
                logger.debug(f"Event {event.event_id} skipped (termination event already sent)")
                continue

            # If trigger_multiple is True, always send
            # If trigger_multiple is False, only send if not sent before
            if trigger_multiple and event.event_id in all_detected_event_ids:
                events_to_send.append(event)
                self._sent_events.add(event.event_id)  # Track sent events even for trigger_multiple=True
                logger.debug(f"Event {event.event_id} will be sent (trigger_multiple=True)")
            elif event.event_id not in self._sent_events:
                events_to_send.append(event)
                self._sent_events.add(event.event_id)
                logger.debug(f"Event {event.event_id} will be sent (first time, trigger_multiple=False)")
            else:
                logger.debug(f"Event {event.event_id} skipped (already sent, trigger_multiple=False)")

        # Collect branching instructions from triggered events
        branching_instructions = self._collect_branching_instructions(events_to_send)

        return successful_events, events_to_send, additional_score_from_triggered_events, branching_instructions

    async def _handle_termination_events(
            self,
            events_to_send: List[BaseEvent]
    ) -> None:
        """
        Handle termination callback for events that should terminate the session.

        This method checks for termination events and calls the termination callback
        if one is registered and termination hasn't already been initiated.

        Args:
            events_to_send: List of events that were sent
        """
        # Check for termination events using registry's termination_event_id
        if not self.termination_event_id:
            return

        termination_events = [
            event for event in events_to_send
            if event.event_id == self.termination_event_id
        ]

        if termination_events:
            logger.info(f"Termination event detected: {termination_events[0].event_id}")

            # Only call termination callback once per session
            if self.termination_callback and not self._termination_initiated:
                self._termination_initiated = True
                logger.info(
                    f"Initiating termination for event: {termination_events[0].event_id} with message: {self.termination_message}")
                await self.termination_callback(termination_events[0])
            elif self._termination_initiated:
                logger.debug(f"Termination already initiated, skipping callback for: {termination_events[0].event_id}")

    async def _send_events_to_ui_and_core(
            self,
            events_to_send: List[BaseEvent],
            room: rtc.Room
    ) -> None:
        """
        Send events to UI and Core messaging systems.
        
        This method focuses solely on sending events to external systems:
        1. Sends ACTIVE events to UI
        2. Sends all events to Core
        3. Handles termination callback for termination events

        Args:
            events_to_send: List of events that should be sent
            room: LiveKit room instance for sending events
        """
        if not events_to_send:
            return

        # Send to UI and Core only if room is provided
        if room:
            # Send to UI: Only ACTIVE events
            active_events = [
                event for event in events_to_send
                if event.visibility_type == VisibilityType.ACTIVE
            ]

            if active_events:
                logger.info(f"Sending {len(active_events)} active events to UI")
                if logger.isEnabledFor(logging.DEBUG):
                    event_summary = EventProcessor.get_events_summary(active_events)
                    logger.debug(f"Active events summary: {event_summary}")

                ui_message_type = EventProcessor.process_events_for_ui(active_events)
                if ui_message_type is not None:
                    await send_event_to_ui(ui_message_type, room)

            # Send to Core: All events to send (both ACTIVE and PASSIVE)
            # EXCEPT termination events - they are deferred and sent in shutdown callback.
            # This ensures the agent completes speaking the termination message before
            # the backend receives autoTerminationStatus=true and closes the room.
            events_to_send_to_core = []
            for event in events_to_send:
                # Check if this is a termination event
                if self.termination_event_id and event.event_id == self.termination_event_id:
                    logger.info(f"Deferring termination event {event.event_id} - will be sent after shutdown")
                    self.deferred_termination_event = event
                    continue
                events_to_send_to_core.append(event)

            logger.info(f"Sending {len(events_to_send_to_core)} events to core")
            for event in events_to_send_to_core:
                logger.debug(
                    f"Sending event to core: {event.event_id} (visibility: {event.visibility_type})"
                )
                event_dict = serialize_event(
                    event,
                    termination_event_id=self.termination_event_id,
                    termination_message=self.termination_message
                )
                core_event_message = CoreEventMessageType.create(
                    room_id=room.name, event_data=event_dict
                )
                await msg_event_queue.send_message(
                    message_body=core_event_message.model_dump_json()
                )

        # Handle termination events after sending events (even if room is None)
        await self._handle_termination_events(events_to_send)

    async def _update_live_score(self, events_to_send: List[BaseEvent]) -> None:
        """
        Update live_score with scores from events that were sent to core.

        This method should be called after events have been successfully sent to core.
        Uses asyncio.Lock to prevent race conditions during concurrent event processing.

        Args:
            events_to_send: List of events that were sent to core
        """
        async with self._live_score_lock:
            for event in events_to_send:
                if event.score is not None:
                    self.live_score += event.score
                    logger.debug(f"Live score updated: +{event.score} = {self.live_score}")

        if events_to_send:
            logger.info(f"Current live score: {self.live_score}")

    async def handle_events(
            self,
            room: rtc.Room,
            detected_event_ids: Optional[Set[str]] = None
    ) -> Tuple[List[BaseEvent], int, List[Tuple[str, int]]]:
        """
        Orchestrates the complete event processing workflow.

        This function coordinates the complete event workflow by:
        1. Calling `_update_registry_and_collect_event_data` to update registry and gather event data
        2. Calling `_send_events_to_ui_and_core` to send events to external systems
        3. Updating live_score with scores from events sent to core
        4. Returning the collected data for use by the caller

        Args:
            room: LiveKit room instance for sending events
            detected_event_ids: Set of event IDs that have been detected

        Returns:
            Tuple of (successful_events, additional_score_from_triggered_events, branching_instructions)
            - successful_events: All events where happened=True in registry
            - additional_score_from_triggered_events: Additional score from triggered events
            - branching_instructions: List of (instruction, score) tuples from triggered events
        """
        # Update registry and collect all data
        successful_events, events_to_send, additional_score, branching_instructions = \
            self._update_registry_and_collect_event_data(
                detected_event_ids=detected_event_ids
            )

        # Send events to UI and Core
        await self._send_events_to_ui_and_core(events_to_send, room)

        # Update live_score with scores from events sent to core
        await self._update_live_score(events_to_send)

        return successful_events, additional_score, branching_instructions

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

    def set_event_state(self, event_id: str, state: bool, event_type: DetectionType = None) -> None:
        """
        Manually set the "happened" state of an event.

        Args:
            event_id: The event ID to update
            state: The new "happened" value (True/False)
        """
        if event_id in self.event_registry:
            self.event_registry[event_id]["happened"] = state
        else:
            # If event not in registry, create entry with trigger_multiple based on event type
            # SENTENCE_SIMILARITY, SEMANTIC_SIMILARITY, and BINARY_CLASSIFIER events can trigger multiple times
            trigger_multiple = event_type in (DetectionType.SENTENCE_SIMILARITY, DetectionType.SEMANTIC_SIMILARITY,
                                              DetectionType.BINARY_CLASSIFIER)
            self.event_registry[event_id] = {"happened": state, "trigger_multiple": trigger_multiple}

    def is_termination_initiated(self) -> bool:
        """
        Check if termination has been initiated for this session.
        
        Returns:
            True if termination has been initiated, False otherwise
        """
        return self._termination_initiated

    def get_newly_triggered_score_events(self, current_score: int) -> Set[str]:
        """
        Get the set of event IDs for score-based events that are newly triggered.
        1. Iterates through all score-based events
        2. Evaluates their conditions against the current score
        3. Updates their "happened" state based on whether the condition is met
        4. Returns the set of event IDs that newly became True (weren't True before)
        5. Events that are already in the _sent_events set are skipped
        
        Args:
            current_score: The current cumulative score to check against
            
        Returns:
            Set of event IDs for score-based events that are newly triggered
        """
        newly_triggered_event_ids: Set[str] = set()

        for event in self.score_based_events:
            # Check if event was already happened (prevents infinite loop)
            event_data = self.event_registry.get(event.event_id)
            was_happened = event_data.get("happened", False) if event_data else False

            condition_met = evaluate_condition(
                value=current_score,
                condition=event.data.condition,
                threshold=event.data.score
            )
            
            if condition_met:
                # Only add to newly triggered if not already sent
                if event.event_id not in self._sent_events:
                    # Only add if condition is met AND it wasn't already True (newly triggered)
                    if not was_happened:
                        self.set_event_state(event.event_id, True, DetectionType.SCORE)
                        newly_triggered_event_ids.add(event.event_id)
                    else:
                        # Condition is met but was already True - update state but don't add to newly triggered
                        self.set_event_state(event.event_id, True, DetectionType.SCORE)
                else:
                    # Event was already sent, but still update state to True if condition is met
                    self.set_event_state(event.event_id, True, DetectionType.SCORE)
            else:
                # Condition is NOT met - set happened to False
                # This ensures combination events that depend on this score event are properly re-evaluated
                # This must happen even for sent events, so combination events can re-evaluate correctly
                if was_happened:
                    logger.debug(f"Score event {event.event_id} condition no longer met at score {current_score}. Setting happened=False")
                self.set_event_state(event.event_id, False, DetectionType.SCORE)

        return newly_triggered_event_ids
