"""What the assistant is doing, as the bot page and the bubble show it (chunk 6b).

Each tool step is described as one `activity`: a kind from a fixed set, and at most
the list's name as the owner wrote it and a record's title (a day and time). Never
a tool or field name, an id, a search query, memory text or a refusal's code. ally-be
relays only these fields, from its own whitelist, to the public stream; the trace
(`step`) stays for Try it and the logs.

An activity is emitted as the step starts (an `activity` event) and kept on the
step's record, so the response lists what was done (`activity`), for the "what I
did" line and the confirmation card.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Literal, Mapping, Optional, Sequence

from app.core.agent_runtime.trace import emit

ActivityKind = Literal[
    "search", "find", "create", "update", "cancel", "hand_over", "writing"
]

#: Longest list name or record title passed on; a title is a day and time.
MAX_LABEL_CHARS = 80

# A status value that cancels ("cancelled", "canceled", "cancel").
_CANCELS = re.compile(r"\bcancel", re.IGNORECASE)
# Anything that looks like an id: never in a label.
_ID_LIKE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}|\b[0-9a-f]{12,}\b", re.IGNORECASE)


def _label(text: Any) -> Optional[str]:
    value = " ".join(str(text or "").split())[:MAX_LABEL_CHARS]
    if not value or _ID_LIKE.search(value):
        return None
    return value


def _definition(bot: Mapping[str, Any], name: str) -> Mapping[str, Any]:
    for definition in bot.get("gateway_definitions") or []:
        if (definition or {}).get("name") == name:
            return definition
    return {}


def _record_title(
    passages: Sequence[Mapping[str, Any]], record_id: str
) -> Optional[str]:
    for passage in passages:
        if record_id and str(passage.get("record_id") or "") == record_id:
            return _label(passage.get("section_path"))
    return None


def _write_title(
    definition: Mapping[str, Any],
    values: Mapping[str, Any],
    passages: Sequence[Mapping[str, Any]],
) -> Optional[str]:
    """The title of what a write books or changes: the dated record it points at
    ("Thu 19 Nov 2026, 11:00"), or the record it updates."""
    properties = (definition.get("input_schema") or {}).get("properties") or {}
    for key, prop in properties.items():
        value = str(values.get(key) or "")
        if prop.get("relation") and prop.get("dated") and value:
            title = _record_title(passages, value)
            if title:
                return title
    return _record_title(passages, str(values.get("id") or ""))


def describe(
    tool: str,
    kind: str,
    values: Mapping[str, Any],
    bot: Mapping[str, Any],
    passages: Sequence[Mapping[str, Any]],
) -> Optional[Dict[str, Any]]:
    """The activity for one tool step about to run; None for a tool with none, or
    when the caller didn't ask for live steps (`bot["activity"]`)."""
    if not bot.get("activity"):
        return None
    if tool == "search_knowledge":
        return {"kind": "search"}
    if tool == "hand_over":
        return {"kind": "hand_over"}
    definition = _definition(bot, tool)
    list_kind = definition.get("kind")
    if not list_kind:
        return None
    activity: Dict[str, Any] = {"kind": list_kind}
    name = _label(definition.get("list_name"))
    if name:
        activity["list"] = name
    if list_kind == "update" and any(
        _CANCELS.search(str(value or "")) for value in values.values()
    ):
        activity["kind"] = "cancel"
    if list_kind in ("create", "update"):
        title = _write_title(definition, values, passages)
        if title:
            activity["title"] = title
    return activity


def started(activity: Optional[Dict[str, Any]]) -> None:
    """Announce a step as it starts (an `activity` event)."""
    if activity:
        emit("activity", dict(activity))


def writing(bot: Mapping[str, Any]) -> None:
    """The reply is being written (when the caller asked for live steps)."""
    if bot.get("activity"):
        emit("activity", {"kind": "writing"})


def done(steps: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    """What the run did, in order: each step that succeeded. A write keeps the id of
    the record it made or changed, for ally-be's confirmation card (read from the
    stored record, never from the model's words); ally-be never passes that id to a
    visitor."""
    return [
        {key: value for key, value in step.items() if key != "ok"}
        for step in steps
        if step.get("ok")
    ]
