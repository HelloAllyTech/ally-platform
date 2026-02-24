"""
ScoreKeeper: Single source of truth for all session scoring.

Tracks event scores (from EventOrchestrator) and behavior instruction scores
(from detect_behaviors node) independently, and exposes a unified total.

Designed to be instantiated once per session in the worker and shared via:
  - agent configurable (graph nodes access it via
    config["configurable"]["score_keeper"])
  - direct reference in EventOrchestrator (injected at construction)
"""

import asyncio

from app.core.logger import get_logger

logger = get_logger(__name__)


class ScoreKeeper:
    """
    Accumulates scores from all session sources.

    Two independent buckets:
    - event_score:    scores from detected events
        (owned by EventOrchestrator)
    - behavior_score: scores from detected behavior instructions
        (owned by detect_behaviors)

    Thread-safe via a single asyncio.Lock shared across both buckets.
    """

    def __init__(self) -> None:
        self._event_score: int = 0
        self._behavior_score: int = 0
        self._lock = asyncio.Lock()

    async def add_event_score(self, delta: int) -> None:
        """
        Add a score delta from a detected event.

        Called by EventOrchestrator after events are sent to core.

        Args:
            delta: Score to add (positive or negative).
        """
        async with self._lock:
            self._event_score += delta
            logger.debug(f"ScoreKeeper: event score +{delta} = {self._event_score}")

    async def add_behavior_score(self, delta: int) -> None:
        """
        Add a score delta from a detected behavior instruction.

        Args:
            delta: Score to add (positive or negative).
        """
        async with self._lock:
            self._behavior_score += delta
            logger.debug(
                f"ScoreKeeper: behavior score +{delta} = {self._behavior_score}"
            )

    @property
    def event_score(self) -> int:
        """Total accumulated event score."""
        return self._event_score

    @property
    def behavior_score(self) -> int:
        """Total accumulated behavior instruction score."""
        return self._behavior_score

    def get_total_score(self) -> int:
        """Return the combined total of event and behavior scores."""
        return self._event_score + self._behavior_score
