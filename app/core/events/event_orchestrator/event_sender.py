"""
Event sending logic for external communication.
Handles sending events to UI and Core messaging systems.
"""

import logging
from typing import TYPE_CHECKING, List, Optional, Tuple

from livekit import rtc

from app.core.constants import VisibilityType
from app.core.events.base import BaseEvent
from app.core.events.event_processor import EventProcessor
from app.core.events.schemas import CoreEventMessageType
from app.core.graph.utils import serialize_event
from app.core.queue import msg_event_queue
from app.utils.event_handler import send_event_to_ui
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

    def _collect_branching_instructions(
        self, events_to_send: List[BaseEvent]
    ) -> List[Tuple[str, int]]:
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
                    f"Collected branching instruction from {event.event_id}: "
                    f"'{event.branching_instruction}' (score={score})"
                )

        if branching_instructions:
            logger.info(
                f"Collected {len(branching_instructions)} branching instructions"
            )

        return branching_instructions

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

    async def _send_events_to_ui_and_core(
        self, events_to_send: List[BaseEvent], room: rtc.Room
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
                event
                for event in events_to_send
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

            logger.info(f"Sending {len(events_to_send_to_core)} events to core")
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
