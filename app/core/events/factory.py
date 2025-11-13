from typing import List, Literal, Mapping, Any

from app.core.constants import VisibilityType
from app.core.events.base import BaseEvent
from app.core.events.event_list.similarity_based.generic import GenericSimilarityEvent


class UnknownEventIdError(RuntimeError):
    def __init__(self, unknown_ids: list[str]):
        super().__init__(f"Unknown event ids in metadata: {unknown_ids}")
        self.unknown_ids = unknown_ids


def build_events_from_metadata(
        metadata: Mapping[str, Any],
        *,
        on_unknown: Literal["ignore", "warn", "error"] = "ignore",
        logger=None,
) -> List[BaseEvent]:
    """
    Convert a scenario dict to a list of BaseEvent instances.

    Args:
        metadata: Bare scenario dict as returned by `Scenario._extract_scenario_section`,
                  e.g. {"id": str, "events": [ ... ], ...}
        on_unknown: What to do if an event doesn't have sentences field:
                    - "ignore": skip silently
                    - "warn": skip and log a warning
                    - "error": raise UnknownEventIdError
        logger: Optional logger to use when on_unknown == "warn"

    Returns:
        List[BaseEvent]: Instantiated event handlers populated with scenario fields.

    Raises:
        UnknownEventIdError: If on_unknown="error" and events without sentences exist.
    """
    events: List[BaseEvent] = []
    unknown_ids: list[str] = []

    # Extract events list from scenario dict
    event_dicts = metadata.get("events") or []

    for ev in event_dicts:
        event_id = ev.get("id", "")
        
        # Only process events that have sentences field in metadata
        if "sentences" in ev:
            try:
                metadata_sentences = ev.get("sentences", [])
                # Empty list is permitted
                if not isinstance(metadata_sentences, list):
                    if logger:
                        logger.warning("Event '%s' has invalid sentences field (not a list), skipping", event_id)
                    unknown_ids.append(event_id)
                    continue

                # Use metadata visibility or default to ACTIVE
                visibility_type = ev.get("visibilityType") or VisibilityType.ACTIVE

                instance = GenericSimilarityEvent.create(
                    event_id=event_id,
                    visibility_type=visibility_type,
                    custom_sentences=metadata_sentences,
                    match_threshold=None,  # Use default from SimilarityEventConfig
                    min_match_tokens=None,  # Use default from SimilarityEventConfig
                    # Per-scenario BaseEvent fields
                    score=ev.get("score"),
                    emoji=ev.get("emoji"),
                    emoji_message=ev.get("message"),
                    branching_instruction=ev.get("branchInstruction"),
                    show_feedback=ev.get("feedbackStatus"),
                )
                events.append(instance)
                continue
            except Exception as e:
                if logger:
                    logger.error("Failed to create event from metadata sentences for '%s': %s", event_id, e)
                if on_unknown == "error":
                    raise
                unknown_ids.append(event_id)
                continue

        # Event without sentences field - not supported anymore
        if logger:
            logger.warning("Event '%s' has no sentences field, skipping (predefined events no longer supported)", event_id)
        unknown_ids.append(event_id)

    if unknown_ids:
        if on_unknown == "warn" and logger is not None:
            logger.warning("Events without sentences field: %s", unknown_ids)
        elif on_unknown == "error":
            raise UnknownEventIdError(unknown_ids)

    return events
