"""
Score-based event evaluation logic.
Handles score calculation, live score updates, and cascading score events.
"""

from typing import TYPE_CHECKING, List, Set, Tuple

from app.core.constants import DetectionType
from app.core.events.base import BaseEvent
from app.core.events.utils import evaluate_condition
from app.core.graph.utils import is_event_eligible
from app.core.logger import get_logger
from app.core.scoring.score_keeper import ScoreKeeper

if TYPE_CHECKING:
    from app.core.events.schemas import EventRegistryEntry

logger = get_logger(__name__)


class ScoreEvaluatorMixin:
    """
    Mixin class providing score evaluation functionality.

    This mixin handles:
    - Score calculation from event IDs
    - Event score updates via ScoreKeeper
    - Score-based event triggering with cascading support

    Requires the following attributes on the host class:
    - events: List[BaseEvent]
    - event_registry: Dict[str, EventRegistryEntry]
    - trigger_events: Set[str]
    - score_based_events: List[BaseEvent]
    - _sent_events: Set[str]
    - score_keeper: ScoreKeeper
    """

    # Type hints for attributes expected from the host class
    events: List[BaseEvent]
    event_registry: "dict[str, EventRegistryEntry]"
    trigger_events: Set[str]
    score_based_events: List[BaseEvent]
    _sent_events: Set[str]
    score_keeper: ScoreKeeper

    def _init_score_evaluator(self, score_keeper: ScoreKeeper) -> None:
        """Initialize score evaluator state."""
        self.score_keeper = score_keeper

        self.score_based_events = [
            e for e in self.events if e.detection_type == DetectionType.SCORE
        ]

    def _calculate_total_score_from_events(self, events: List[BaseEvent]) -> int:
        """
        Calculate the total score from a list of events.
        Only includes events that are in the trigger_events list.

        Args:
            events: List of events to calculate score from

        Returns:
            Total score sum from all events with non-None scores that are in
            trigger_events
        """
        return sum(
            event.score
            for event in events
            if event.score is not None and event.event_id in self.trigger_events
        )

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

    def get_newly_triggered_score_events(
        self, current_score: int, elapsed_time: float
    ) -> Set[str]:
        """
        Get the set of event IDs for score-based events that are newly triggered.
        1. Iterates through all score-based events
        2. Evaluates their conditions against the current score
        3. Updates their happened state based on whether the condition is met
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
            was_happened = event_data.happened if event_data else False

            condition_met = evaluate_condition(
                value=current_score,
                condition=event.data.condition,
                threshold=event.data.score,
            )

            if condition_met:
                # If event is already active, keep it active
                if was_happened:
                    self.set_event_state(event.event_id, True, DetectionType.SCORE)
                    continue

                # If event was NOT active, it's a candidate for a new trigger.
                # 2. CHECK ELIGIBILITY (Cooldowns, Max Occurrences, Time Window)
                last_occurred_at = event_data.occurred_at if event_data else None
                occurrence_count = event_data.occurrence_count if event_data else 0

                if is_event_eligible(
                    event=event,
                    elapsed_time=elapsed_time,
                    current_score=current_score,
                    last_occurred_at=last_occurred_at,
                    occurrence_count=occurrence_count,
                ):
                    # Condition Met + Eligible -> Trigger
                    self.set_event_state(event.event_id, True, DetectionType.SCORE)
                    newly_triggered_event_ids.add(event.event_id)
                else:
                    # Condition Met + NOT Eligible -> Do not trigger, keep state False
                    # (e.g. Score is 50, but we are in a cooldown)
                    pass

            else:
                # Condition NOT Met -> Reset state to False
                if was_happened:
                    logger.debug(
                        f"Score event {event.event_id} condition no longer "
                        f"met at score {current_score}. Setting "
                        f"happened=False"
                    )
                self.set_event_state(event.event_id, False, DetectionType.SCORE)

        return newly_triggered_event_ids

    def _evaluate_and_handle_cascade_score_events(
        self,
        detected_event_ids: Set[str],
        elapsed_time: float,
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
        current_cycle_score = self._calculate_score_from_event_ids(detected_event_ids)

        # Start with total committed score (events + behaviors) + current cycle's
        # event scores. Behavior scores are included so score-based event thresholds
        # are evaluated against the full session score.
        working_score = self.score_keeper.get_total_score() + current_cycle_score

        if current_cycle_score != 0:
            logger.info(
                f"Current cycle adding {current_cycle_score} to total score "
                f"{self.score_keeper.get_total_score()}. Working score: {working_score}"
            )

        # Evaluate score-based events against the working score
        newly_triggered_score_event_ids = self.get_newly_triggered_score_events(
            working_score, elapsed_time
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
                working_score, elapsed_time
            )

        return detected_event_ids, additional_score_from_triggered_events

    async def _update_event_score(self, events_to_send: List[BaseEvent]) -> None:
        """
        Commit scores from sent events into ScoreKeeper.

        Called after events have been successfully sent to core so the
        committed event_score reflects only events the backend has received.

        Args:
            events_to_send: List of events that were sent to core
        """
        score_delta = self._calculate_total_score_from_events(events_to_send)

        if score_delta != 0:
            await self.score_keeper.add_event_score(score_delta)

        if events_to_send:
            logger.info(f"Current event score: {self.score_keeper.event_score}")
