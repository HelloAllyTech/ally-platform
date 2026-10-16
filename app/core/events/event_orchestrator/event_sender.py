"""
Event sending logic for external communication.
Handles sending events to UI and Core messaging systems.
"""

import asyncio
from typing import TYPE_CHECKING, List, Optional, Set

from livekit import rtc

from app.core.constants import VisibilityType
from app.core.events.base import BaseEvent
from app.core.events.schemas import CoreEventMessageType
from app.core.graph.state import BranchingAndFeedbackData, EventFeedback
from app.core.graph.utils import serialize_event
from app.core.logger import get_logger
from app.core.queue import msg_event_queue
from app.core.scenario.base import TerminationEvent

if TYPE_CHECKING:
    pass

logger = get_logger(__name__)


class EventSender:
    """
    This class providing event sending functionality.

    This class handles:
    - Sending events to UI (ACTIVE events only)
    - Sending events to Core (all events except deferred termination)
    - Collecting branching instructions from triggered events
    - Handling deferred termination events
    - Managing multiple auto-termination events with flow isolation

    Requires the following attributes on the host class:
    - termination_events: List[TerminationEvent]
    - termination_event_ids: Set[str]
    - trigger_events: Set[str]
    - termination_callback: Optional[callable]
    - _termination_initiated: bool
    - _termination_flow_started: bool
    - deferred_termination_event: Optional[BaseEvent]
    """

    # Type hints for attributes expected from the host class
    termination_events: List[TerminationEvent]
    termination_event_ids: Set[str]
    trigger_events: Set[str]
    termination_callback: Optional[callable]
    _termination_initiated: bool
    _termination_flow_started: bool
    deferred_termination_event: Optional[BaseEvent]

    def _init_event_sender(self) -> None:
        """Initialize event sender state."""
        self.deferred_termination_event = None

    def _collect_branching_and_feedback_data(
        self, events_to_send: List[BaseEvent]
    ) -> List[BranchingAndFeedbackData]:
        """
        Collect unified branching and feedback data from triggered events.

        This method creates BranchingAndFeedbackData objects that combine:
        - Branching instructions (for LLM guidance)
        - Feedback messages (for UI display)
        - Event scores (for priority selection)

        The collected data will be stored in state and processed in generate_response
        to determine which branching instruction to use and which feedback to display.

        Args:
            events_to_send: List of events that will be sent

        Returns:
            List of BranchingAndFeedbackData objects containing branching
            instructions and feedback
        """
        data_list: List[BranchingAndFeedbackData] = []

        for event in events_to_send:
            # Only collect data for ACTIVE events (they have UI feedback)
            # PASSIVE events don't need feedback, but may have branching instructions
            if event.visibility_type == VisibilityType.ACTIVE:
                # Create feedback object for UI display
                # Note: Score is NOT stored in EventFeedback -
                # it's in BranchingAndFeedbackData
                feedback = EventFeedback(
                    emoji=event.emoji,
                    message=event.emoji_message,
                    show_feedback=(
                        event.show_feedback if event.show_feedback is not None else True
                    ),
                )
            else:
                # PASSIVE events don't have UI feedback
                feedback = None

            # Create BranchingAndFeedbackData object
            data = BranchingAndFeedbackData(
                branching_instruction=event.branching_instruction,
                feedback=feedback,
                score=event.score if event.score is not None else 0,
                event_id=event.event_id,
            )

            data_list.append(data)

            logger.debug(
                f"Collected branching and feedback data from {event.event_id}: "
                f"branching={bool(event.branching_instruction)}, "
                f"feedback={feedback is not None}, score={data.score}"
            )

        if data_list:
            logger.info(
                f"Collected {len(data_list)} branching and feedback data entries"
            )

        return data_list

    def get_termination_config(self, event_id: str) -> Optional[TerminationEvent]:
        """
        Get the termination configuration for a given event ID.

        Args:
            event_id: The event ID to look up

        Returns:
            TerminationEvent config if found, None otherwise
        """
        for te in self.termination_events:
            if te.id == event_id:
                return te
        return None

    def _select_highest_magnitude_termination_event(
        self, termination_events: List[BaseEvent]
    ) -> Optional[BaseEvent]:
        """
        Select the termination event with the highest magnitude score.

        When multiple termination events are triggered in the same flow,
        prefer the one with the highest absolute score value.

        Args:
            termination_events: List of triggered termination events

        Returns:
            The termination event with highest magnitude score, or first if no scores
        """
        if not termination_events:
            return None

        if len(termination_events) == 1:
            return termination_events[0]

        # Find event with highest magnitude score
        best_event = termination_events[0]
        best_magnitude = 0.0

        for event in termination_events:
            # Get score from termination config or event itself
            config = self.get_termination_config(event.event_id)
            score = config.score if config and config.score is not None else 0.0
            # Also check event's own score if config score is not set
            if score == 0.0 and event.score is not None:
                score = event.score

            magnitude = abs(score)
            if magnitude > best_magnitude:
                best_magnitude = magnitude
                best_event = event

        logger.info(
            f"Selected termination event {best_event.event_id} with highest "
            f"magnitude score from {len(termination_events)} candidates"
        )
        return best_event

    async def _handle_termination_events(self, events_to_send: List[BaseEvent]) -> None:
        """
        Handle termination callback for events that should terminate the session.

        This method:
        1. Checks if termination flow has already started
        2. If multiple termination events are present, selects the one with highest
           magnitude score
        3. Calls the termination callback if registered and not already initiated

        Args:
            events_to_send: List of events that were sent
        """
        # Check for termination events using the list of termination event IDs
        if not self.termination_event_ids:
            return

        # Filter events that are termination events
        triggered_termination_events = [
            event
            for event in events_to_send
            if event.event_id in self.termination_event_ids
        ]

        if not triggered_termination_events:
            return

        logger.info(
            f"Termination events detected: "
            f"{[e.event_id for e in triggered_termination_events]}"
        )

        # Check if termination flow has already started
        if self._termination_flow_started:
            logger.info(
                "Ignoring termination events - termination flow already started"
            )
            return

        # Select the termination event with highest magnitude score
        selected_event = self._select_highest_magnitude_termination_event(
            triggered_termination_events
        )

        if not selected_event:
            return

        # Get termination message from config
        config = self.get_termination_config(selected_event.event_id)
        termination_message = config.termination_message if config else None

        # NOTE: Termination audio is now handled in entrypoint context (not here).
        # The termination callback will signal the entrypoint context, which will
        # play the audio reliably because it runs in the main async context.
        # No need to attempt audio playback here - it will be handled in entrypoint.

        # Mark that termination flow has started
        self._termination_flow_started = True
        logger.info("Termination flow started")

        # Only call termination callback once per session
        if self.termination_callback and not self._termination_initiated:
            self._termination_initiated = True
            logger.info(
                f"Initiating termination for event: "
                f"{selected_event.event_id} with message: "
                f"{termination_message}"
            )
            await self.termination_callback(selected_event)
        elif self._termination_initiated:
            logger.debug(
                f"Termination already initiated, skipping callback for: "
                f"{selected_event.event_id}"
            )

    async def _send_events_to_core(
        self, events_to_send: List[BaseEvent], room: rtc.Room
    ) -> None:
        """
        Send events to Core messaging system only (backend).

        This method sends all events (both ACTIVE and PASSIVE) to the backend
        immediately. UI events are handled separately via branching_and_feedback_data
        in state, which is processed in generate_response to determine which feedback
        message to send to UI.

        Note: Termination events are still deferred and sent in shutdown callback
        to ensure the agent completes speaking the termination message before
        the backend receives autoTerminationStatus=true and closes the room.

        Args:
            events_to_send: List of events that should be sent
            room: LiveKit room instance for sending events
        """
        if not events_to_send:
            return

        # Send to Core only if room is provided
        if room:
            # Send to Core: All events to send (both ACTIVE and PASSIVE)
            # EXCEPT termination events - they are deferred and sent in
            # shutdown callback.
            # This ensures the agent completes speaking the termination
            # message before the backend receives autoTerminationStatus=true
            # and closes the room.
            events_to_send_to_core = []
            for event in events_to_send:
                # Check if this is a termination event (using set for O(1) lookup)
                if event.event_id in self.termination_event_ids:
                    # Always defer termination events for shutdown handler
                    logger.info(
                        f"Deferring termination event {event.event_id} - "
                        f"will be sent after shutdown"
                    )
                    self.deferred_termination_event = event

                    # If event is ALSO in trigger_events, send it immediately
                    # WITHOUT termination info (termination info only in deferred event)
                    if event.event_id in self.trigger_events:
                        logger.info(
                            f"Event {event.event_id} is in trigger_events - "
                            f"sending immediately without termination info"
                        )
                        events_to_send_to_core.append(event)
                    continue
                events_to_send_to_core.append(event)

            # Send Core events immediately
            logger.info(
                f"Sending {len(events_to_send_to_core)} events to "
                f"Core messaging system"
            )

            send_tasks = []
            for event in events_to_send_to_core:
                logger.debug(
                    f"Sending event to core: {event.event_id} "
                    f"(visibility: {event.visibility_type})"
                )
                # Events sent immediately should NOT include termination info
                # Termination info is only added to deferred events sent during shutdown
                event_dict = serialize_event(event)
                core_event_message = CoreEventMessageType.create(
                    room_id=room.name, event_data=event_dict
                )
                send_tasks.append(
                    msg_event_queue.send_message(
                        message_body=core_event_message.model_dump_json()
                    )
                )

            if send_tasks:
                results = await asyncio.gather(*send_tasks, return_exceptions=True)
                for result in results:
                    if isinstance(result, Exception):
                        logger.error(f"Failed to send event to core: {result}")
