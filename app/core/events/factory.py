from typing import List, Literal

from app.core.events.base import BaseEvent
from app.core.events.registry import get_event_class
from app.core.events.schemas import LivekitMetadata


class UnknownEventIdError(RuntimeError):
    def __init__(self, unknown_ids: list[str]):
        super().__init__(f"Unknown event ids in metadata: {unknown_ids}")
        self.unknown_ids = unknown_ids


def build_events_from_metadata(
        metadata: dict,
        *,
        on_unknown: Literal["ignore", "warn", "error"] = "ignore",
        logger=None,
) -> List[BaseEvent]:
    """
    Convert incoming LiveKit metadata to a list of BaseEvent instances.

    Args:
        metadata: Raw metadata dict.
        on_unknown: What to do if an event id has no registered handler:
                    - "ignore": skip silently
                    - "warn": skip and log a warning
                    - "error": raise UnknownEventIdError
        logger: Optional logger to use when on_unknown == "warn"

    Returns:
        List[BaseEvent]: Instantiated event handlers populated with scenario fields.

    Raises:
        ValidationError: If metadata is invalid.
        UnknownEventIdError: If on_unknown="error" and unknown ids exist.
    """
    meta = LivekitMetadata.model_validate(metadata)

    events: List[BaseEvent] = []
    unknown_ids: list[str] = []

    for ev in meta.scenario.events:
        cls = get_event_class(ev.id)
        if not cls:
            unknown_ids.append(ev.id)
            continue

        # Map metadata fields to BaseEvent instance
        instance = cls(
            score=ev.score,
            emoji=ev.emoji,
            emoji_message=ev.message,
            branching_instruction=ev.branchingInstruction,
        )
        events.append(instance)

    if unknown_ids:
        if on_unknown == "warn" and logger is not None:
            logger.warning("Unknown event ids in metadata: %s", unknown_ids)
        elif on_unknown == "error":
            raise UnknownEventIdError(unknown_ids)

    return events
