"""
Event sending logic for external communication.
Handles sending events to UI and Core messaging systems.
"""

from typing import TYPE_CHECKING, List, Optional

from livekit import rtc

from app.core.constants import VisibilityType
from app.core.events.base import BaseEvent
from app.core.events.schemas import CoreEventMessageType
from app.core.graph.state import BranchingAndFeedbackData, EventFeedback
from app.core.graph.utils import serialize_event
from app.core.queue import msg_event_queue
from app.utils.logger import get_logger

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

    Requires the following attributes on the host class:
    - termination_event_id: Optional[str]
    - termination_message: Optional[str]
    - termination_callback: Optional[callable]
    - _termination_initiated: bool
    - deferred_termination_event: Optional[BaseEvent]
    """

    # Type hints for attributes expected from the host class
    termination_event_id: Optional[str]
    termination_message: Optional[str]
    termination_callback: Optional[callable]
    _termination_initiated: bool
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

    async def _handle_termination_events(self, events_to_send: List[BaseEvent]) -> None:
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
            event
            for event in events_to_send
            if event.event_id == self.termination_event_id
        ]

        if termination_events:
            logger.info(f"Termination event detected: {termination_events[0].event_id}")

            # Only call termination callback once per session
            if self.termination_callback and not self._termination_initiated:
                self._termination_initiated = True
                logger.info(
                    f"Initiating termination for event: "
                    f"{termination_events[0].event_id} with message: "
                    f"{self.termination_message}"
                )
                await self.termination_callback(termination_events[0])
            elif self._termination_initiated:
                logger.debug(
                    f"Termination already initiated, skipping callback for: "
                    f"{termination_events[0].event_id}"
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
                # Check if this is a termination event
                if (
                    self.termination_event_id
                    and event.event_id == self.termination_event_id
                ):
                    logger.info(
                        f"Deferring termination event {event.event_id} - "
                        f"will be sent after shutdown"
                    )
                    self.deferred_termination_event = event
                    continue
                events_to_send_to_core.append(event)

            # Send Core events immediately
            logger.info(
                f"Sending {len(events_to_send_to_core)} events to "
                f"Core messaging system"
            )
            for event in events_to_send_to_core:
                logger.debug(
                    f"Sending event to core: {event.event_id} "
                    f"(visibility: {event.visibility_type})"
                )
                event_dict = serialize_event(
                    event,
                    termination_event_id=self.termination_event_id,
                    termination_message=self.termination_message,
                )
                core_event_message = CoreEventMessageType.create(
                    room_id=room.name, event_data=event_dict
                )
                await msg_event_queue.send_message(
                    message_body=core_event_message.model_dump_json()
                )

        # Handle termination events after sending events (even if room is None)
        await self._handle_termination_events(events_to_send)
