"""
Score-based event evaluation logic.
Handles score calculation, live score updates, and cascading score events.
"""

import asyncio
from typing import TYPE_CHECKING, List, Set, Tuple

from app.core.constants import DetectionType
from app.core.events.base import BaseEvent
from app.utils.event_utils import evaluate_condition
from app.utils.logger import get_logger

if TYPE_CHECKING:
    from app.core.events.schemas import EventRegistryEntry

logger = get_logger(__name__)


class ScoreEvaluatorMixin:
    """
    Mixin class providing score evaluation functionality.

    This mixin handles:
    - Score calculation from event IDs
    - Live score tracking and updates
    - Score-based event triggering with cascading support

    Requires the following attributes on the host class:
    - events: List[BaseEvent]
    - event_registry: Dict[str, EventRegistryEntry]
    - trigger_events: Set[str]
    - score_based_events: List[BaseEvent]
    - _sent_events: Set[str]
    - live_score: int
    - _live_score_lock: asyncio.Lock
    """

    # Type hints for attributes expected from the host class
    events: List[BaseEvent]
    event_registry: "dict[str, EventRegistryEntry]"
    trigger_events: Set[str]
    score_based_events: List[BaseEvent]
    _sent_events: Set[str]
    live_score: int
    _live_score_lock: asyncio.Lock

    def _init_score_evaluator(self) -> None:
        """Initialize score evaluator state."""
        self.live_score = 0
        self._live_score_lock = asyncio.Lock()

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
                threshold=event.data.score,
            )

            if condition_met:
                # Only add to newly triggered if not already sent
                if event.event_id not in self._sent_events:
                    # Only add if condition is met AND it wasn't already True
                    # (newly triggered)
                    if not was_happened:
                        self.set_event_state(event.event_id, True, DetectionType.SCORE)
                        newly_triggered_event_ids.add(event.event_id)
                    else:
                        # Condition is met but was already True - update state
                        # but don't add to newly triggered
                        self.set_event_state(event.event_id, True, DetectionType.SCORE)
                else:
                    # Event was already sent, but still update state to True
                    # if condition is met
                    self.set_event_state(event.event_id, True, DetectionType.SCORE)
            else:
                # Condition is NOT met - set happened to False
                # This ensures combination events that depend on this score
                # event are properly re-evaluated
                # This must happen even for sent events, so combination events
                # can re-evaluate correctly
                if was_happened:
                    logger.debug(
                        f"Score event {event.event_id} condition no longer "
                        f"met at score {current_score}. Setting "
                        f"happened=False"
                    )
                self.set_event_state(event.event_id, False, DetectionType.SCORE)

        return newly_triggered_event_ids

    def _evaluate_and_handle_cascade_score_events(
        self, detected_event_ids: Set[str]
    ) -> Tuple[Set[str], int]:
        """
        Evaluate score-based events and track cascading score changes.

        This method handles the cascading effect where score-based events
        can have their own scores which may trigger other score-based events.

        The method ensures score-based events trigger in the same cycle as
        the events that bring the score to the threshold by:
        1. Starting with live_score + score from current cycle's detected events
        2. Evaluating score-based events against this working score
        3. Cascading through any score-based events that trigger other
           score-based events

        Args:
            detected_event_ids: Set of already detected event IDs
                (will be modified in place).

        Returns:
            Tuple of (all_detected_event_ids, additional_score_from_triggered_events)
            - all_detected_event_ids: Updated set including
              score-triggered events
            - additional_score_from_triggered_events: Additional score from
              score-based events that were triggered
        """
        additional_score_from_triggered_events = 0

        # Calculate the score contribution from currently detected events
        # (similarity, time, combination, etc.)
        # This excludes score-based events which will be evaluated in the
        # cascade loop
        current_cycle_score = self._calculate_score_from_event_ids(detected_event_ids)

        # Start with live_score + current cycle's event scores
        # This ensures score-based events can trigger on the same cycle as
        # the events that bring the score to threshold
        working_score = self.live_score + current_cycle_score

        if current_cycle_score != 0:
            logger.info(
                f"Current cycle adding {current_cycle_score} to live_score "
                f"{self.live_score}. Working score: {working_score}"
            )

        # Evaluate score-based events against the working score
        newly_triggered_score_event_ids = self.get_newly_triggered_score_events(
            working_score
        )

        # Keep checking for newly triggered score-based events until no more
        # are triggered
        # This handles cascading: score-based events triggering other
        # score-based events
        while newly_triggered_score_event_ids:
            logger.info(
                f"Score-based events triggered at score {working_score}: "
                f"{newly_triggered_score_event_ids}"
            )
            detected_event_ids.update(newly_triggered_score_event_ids)

            # Calculate additional score from newly triggered score-based events
            additional_score = self._calculate_score_from_event_ids(
                newly_triggered_score_event_ids
            )

            if additional_score != 0:
                additional_score_from_triggered_events += additional_score
                working_score += additional_score
                logger.info(
                    f"Score changed by {additional_score} from triggered "
                    f"score-based events. New working score: {working_score}"
                )

            # Check again with the new score to handle cascading
            # Loop will exit naturally when no more events trigger
            newly_triggered_score_event_ids = self.get_newly_triggered_score_events(
                working_score
            )

        return detected_event_ids, additional_score_from_triggered_events

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
                    logger.debug(
                        f"Live score updated: +{event.score} = {self.live_score}"
                    )

        if events_to_send:
            logger.info(f"Current live score: {self.live_score}")
