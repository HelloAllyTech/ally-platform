from typing import Optional, List, Any, Dict, Mapping

from pydantic import BaseModel, Field

from app.core.events.base import BaseEvent
from app.core.events.registry import get_event_class


class Scenario(BaseModel):
    """
    Parsed scenario ready for runtime.
    - Accepts BE keys via aliases (e.g., `scenarioName`, `lifeHistory`).
    - `events` contains instantiated BaseEvent subclasses (from your registry).
    """
    name: str = Field(alias="scenarioName")
    learning_objective: str = Field(alias="learningObjective")
    prompt: str
    life_history: Optional[str] = Field(default=None, alias="lifeHistory")
    events: List[BaseEvent] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    model_config = {
        "populate_by_name": True,     # allow both alias and field name on input
        "arbitrary_types_allowed": True,
    }

    # ---------------------------
    # Public constructor
    # ---------------------------
    @classmethod
    def create(cls, payload: Mapping[str, Any]) -> "Scenario":
        """
        Build a Scenario from:
          - a top-level BE payload: {"version": "...", "scenario": {...}}
          - or a bare scenario dict: {"id": "...", "scenarioName": "...", ...}

        Ensures `events` are BaseEvent instances resolved via your registry.
        (Only events whose `id` exists in the registry are instantiated.)
        """
        raw = cls._extract_scenario_section(payload)
        normalized = cls._normalize_top_level_fields(raw)
        built_events = cls._build_events(raw)

        return cls(
            scenarioName=normalized["scenarioName"],
            learningObjective=normalized["learningObjective"],
            prompt=normalized["prompt"],
            lifeHistory=normalized.get("lifeHistory"),
            metadata=normalized.get("metadata", {}),
            events=built_events,
        )

    # ---------------------------
    # Internal helpers
    # ---------------------------
    @staticmethod
    def _extract_scenario_section(payload: Mapping[str, Any]) -> Mapping[str, Any]:
        """Return the inner scenario dict from an envelope or the payload itself."""
        return payload.get("scenario", payload)

    @staticmethod
    def _normalize_top_level_fields(raw: Mapping[str, Any]) -> Dict[str, Any]:
        """
        Normalize BE keys to what Scenario expects (compatible with aliases).
        """
        return {
            "scenarioName": raw.get("title"),
            "learningObjective": raw.get("description"),
            "prompt": raw["prompt"] or "",
            "lifeHistory": raw.get("lifeHistory") or raw.get("life_history"),
            "metadata": raw.get("metadata", {}),
        }

    @staticmethod
    def _build_events(raw: Mapping[str, Any]) -> List[BaseEvent]:
        """
        Convert BE event dicts to instantiated BaseEvent objects using the registry.
        - Adds score, emoji, message -> emoji_message, conversationInstruction -> conversation_instruction
        - Skips events that have no registered class.
        """
        instances: List[BaseEvent] = []
        for e in (raw.get("events") or []):
            ev_cls = get_event_class(e.get("id", ""))
            if ev_cls is None:
                # No registered class for this id; skip silently (or log if desired)
                continue

            kwargs = {
                "score": e.get("score"),
                "emoji": e.get("emoji", ""),
                "emoji_message": e.get("message", ""),  # map BE `message` -> BaseEvent.emoji_message
                "branching_instruction": e.get("branchingInstruction", ""),
            }
            instances.append(ev_cls(**kwargs))

        return instances
