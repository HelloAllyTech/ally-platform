import random
from datetime import datetime, timezone
from typing import List, Optional

from app.core.events.base import BaseEvent
from app.core.events.schemas import CustomUIEventMessageType


class EventProcessor:
    """
    Handles the two-part logic for processing scoring events within a
    single conversational turn:
    1. Calculate cumulative score from all events
    2. Select appropriate event for display based on score polarity

    This ensures the UI score meter always receives the correct cumulative score,
    while the event details displayed are randomly selected from the correct pool
    (positive or negative) that matches the final score's polarity.

    Example:
        Events: +10 (Great explanation), -5 (Spoke too fast), -2 (Used 'um')
        Cumulative score: +3
        UI receives: score=+3, but displays details from the +10 event
        (randomly selected from positive events)
    """

    @staticmethod
    def process_events_for_ui(
        events: List[BaseEvent],
    ) -> Optional[CustomUIEventMessageType]:
        """
        Process events using the two-part logic:
        1. Calculate cumulative score
        2. Select event for display based on score polarity

        Args:
            events: List of detected events for the current turn

        Returns:
            CustomUIEventMessageType if events should be displayed, None
            for neutral/zero score
        """
        if not events:
            return None

        # Step 1: Calculate cumulative score
        cumulative_score = sum(event.score for event in events)

        # Step 2: Select event for display based on cumulative score polarity
        selected_event = EventProcessor._select_event_for_display(
            events, cumulative_score
        )

        if selected_event is None:
            # This should only happen if there are no events at all (edge case)
            return None

        # Create UI message with cumulative score and selected event details
        ui_message = CustomUIEventMessageType.create(
            score=cumulative_score,
            emoji=selected_event.emoji,
            message=selected_event.emoji_message,
            timestamp=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
            show_feedback=(
                selected_event.show_feedback
                if selected_event.show_feedback is not None
                else True
            ),
        )

        return ui_message

    @staticmethod
    def _select_event_for_display(
        events: List[BaseEvent], cumulative_score: int
    ) -> Optional[BaseEvent]:
        """
        Select an event for display based on the cumulative score polarity.

        Args:
            events: List of detected events
            cumulative_score: The calculated cumulative score

        Returns:
            Selected event for display, or None only if no events exist (edge case)
        """

        # Filter events by polarity using a single loop
        positive_events = (
            []
        )  # Events that improve the counselor's performance (score > 0)
        negative_events = []  # Events that indicate areas for improvement (score < 0)
        neutral_events = (
            []
        )  # Events that maintain neutral client interaction (score = 0)

        for event in events:
            if event.score > 0:
                positive_events.append(event)
            elif event.score < 0:
                negative_events.append(event)
            else:  # event.score == 0
                neutral_events.append(event)

        if cumulative_score > 0:
            # Score is positive - select from positive events
            if positive_events:
                selected = random.choice(positive_events)
                return selected
            else:
                # Fallback: if no positive events but score is positive,
                # this shouldn't happen but select highest scoring event
                return max(events, key=lambda e: e.score)

        elif cumulative_score < 0:
            # Score is negative - select from negative events
            if negative_events:
                selected = random.choice(negative_events)
                return selected
            else:
                # Fallback: if no negative events but score is negative,
                # this shouldn't happen but select lowest scoring event
                return min(events, key=lambda e: e.score)

        else:  # cumulative_score == 0
            # Score is neutral (0) - prioritize neutral_events first,
            # then fall back to all events
            if neutral_events:
                return random.choice(neutral_events)
            else:
                # Fall back to all events if no neutral events exist
                all_events = positive_events + negative_events
                return random.choice(all_events) if all_events else None

    @staticmethod
    def get_events_summary(events: List[BaseEvent]) -> dict:
        """
        Get a summary of events for debugging/logging purposes.

        Args:
            events: List of events to summarize

        Returns:
            Dictionary with event summary information
        """
        if not events:
            return {
                "total_events": 0,
                "cumulative_score": 0,
                "positive_count": 0,
                "negative_count": 0,
                "neutral_count": 0,
            }

        cumulative_score = sum(event.score for event in events)

        # Use single loop to categorize events
        positive_events = (
            []
        )  # Events that improve the counselor's performance (score > 0)
        negative_events = []  # Events that indicate areas for improvement (score < 0)
        neutral_events = (
            []
        )  # Events that maintain neutral client interaction (score = 0)

        for event in events:
            if event.score > 0:
                positive_events.append(event)
            elif event.score < 0:
                negative_events.append(event)
            else:  # event.score == 0
                neutral_events.append(event)

        return {
            "total_events": len(events),
            "cumulative_score": cumulative_score,
            "positive_count": len(positive_events),
            "negative_count": len(negative_events),
            "neutral_count": len(neutral_events),
            "event_scores": [event.score for event in events],
            "event_ids": [event.event_id for event in events],
        }
