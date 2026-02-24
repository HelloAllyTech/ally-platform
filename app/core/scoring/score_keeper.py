"""
ScoreKeeper: Single source of truth for scores not tracked by EventOrchestrator.

Currently handles behavior instruction scores.
Events still use EventOrchestrator.live_score.
The final score sent to core is the sum of both.

Migration path:
  Phase 1 (now)  - Behavior instructions use ScoreKeeper
  Phase 2        - Events migrate from EventOrchestrator.live_score to ScoreKeeper
  Phase 3        - EventOrchestrator.live_score removed; ScoreKeeper is sole source
"""

import asyncio

from app.core.logger import get_logger

logger = get_logger(__name__)


class ScoreKeeper:
    """
    Accumulates scores from sources outside the event system.

    Thread-safe via asyncio.Lock. Designed to be instantiated once per session
    and passed through the agent config so all graph nodes share the same instance.
    """

    def __init__(self) -> None:
        self._behavior_score: int = 0
        self._lock = asyncio.Lock()

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
    def behavior_score(self) -> int:
        """Total accumulated behavior instruction score."""
        return self._behavior_score

    def get_total_score(self) -> int:
        """
        Return the total score owned by ScoreKeeper.

        Currently only behavior scores. When events migrate here this will
        also include event scores.
        """
        return self._behavior_score
