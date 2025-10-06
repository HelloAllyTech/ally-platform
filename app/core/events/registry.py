from typing import Dict, Type

from app.core.events.base import BaseEvent

_EVENT_REGISTRY: Dict[str, Type[BaseEvent]] = {}


def register_event(cls: Type[BaseEvent]) -> Type[BaseEvent]:
    if not getattr(cls, "event_id", None):
        raise ValueError(f"{cls.__name__} must define class attribute `event_id`")
    key = cls.event_id.strip().lower()
    if key in _EVENT_REGISTRY:
        raise ValueError(f"Duplicate event_id registration: {key}")
    _EVENT_REGISTRY[key] = cls
    return cls


def get_event_class(event_id: str) -> Type[BaseEvent] | None:
    return _EVENT_REGISTRY.get(event_id.strip().lower())
