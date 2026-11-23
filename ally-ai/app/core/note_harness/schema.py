"""JSON schemas generated from the NoteSpec (DESIGN §6.4).

The narrative is an ordered list, so time order is part of the format. Select
fields answer with option ids from an enum. Every field may be null ("not
discussed"). The schemas follow OpenAI strict structured output rules: every
property required, no additional properties.
"""

import json
from typing import Any, Dict, List

from app.core.note_harness.models import NoteField, NoteSpec

_POINT = {
    "type": "object",
    "additionalProperties": False,
    "required": ["t", "text", "turn_ids"],
    "properties": {
        "t": {"type": "string", "description": "HH:MM:SS of the first turn"},
        "text": {"type": "string"},
        "turn_ids": {"type": "array", "items": {"type": "integer"}},
    },
}


def _value_schema(field: NoteField) -> Dict[str, Any]:
    ids = [o.id for o in field.options]
    if field.type == "SINGLE_SELECT":
        return {"type": "string", "enum": ids} if ids else {"type": "string"}
    if field.type == "MULTI_SELECT":
        item = {"type": "string", "enum": ids} if ids else {"type": "string"}
        return {"type": "array", "items": item}
    if field.type == "NUMBER":
        return {"type": "number"}
    if field.type == "BOOLEAN":
        return {"type": "boolean"}
    return {"type": "string"}


def _field_schema(field: NoteField) -> Dict[str, Any]:
    return {
        "anyOf": [
            {"type": "null"},
            {
                "type": "object",
                "additionalProperties": False,
                "required": ["value", "evidence_turn_ids"],
                "properties": {
                    "value": _value_schema(field),
                    "evidence_turn_ids": {
                        "type": "array",
                        "items": {"type": "integer"},
                    },
                },
            },
        ]
    }


def note_schema(spec: NoteSpec) -> Dict[str, Any]:
    return {
        "title": "scribe_note",
        "description": "A session note: a time-ordered narrative and fields.",
        "type": "object",
        "additionalProperties": False,
        "required": ["narrative", "fields"],
        "properties": {
            "narrative": {"type": "array", "items": _POINT},
            "fields": {
                "type": "object",
                "additionalProperties": False,
                "required": [f.id for f in spec.fields],
                "properties": {f.id: _field_schema(f) for f in spec.fields},
            },
        },
    }


def segment_schema(spec: NoteSpec) -> Dict[str, Any]:
    """The map step's answer: timeline points plus field notes for the reduce."""
    field_id = (
        {"type": "string", "enum": [f.id for f in spec.fields]}
        if spec.fields
        else {"type": "string"}
    )
    return {
        "title": "scribe_note_segment",
        "description": "Timeline notes and field evidence for one part.",
        "type": "object",
        "additionalProperties": False,
        "required": ["points", "field_notes"],
        "properties": {
            "points": {"type": "array", "items": _POINT},
            "field_notes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["field_id", "note", "turn_ids"],
                    "properties": {
                        "field_id": field_id,
                        "note": {"type": "string"},
                        "turn_ids": {"type": "array", "items": {"type": "integer"}},
                    },
                },
            },
        },
    }


_TYPE_HINT = {
    "SINGLE_SELECT": "one option id",
    "MULTI_SELECT": "a list of option ids",
    "NUMBER": "a number",
    "BOOLEAN": "true or false",
    "DATE": "a date as said",
    "TEXT": "a short phrase",
    "MULTILINE_TEXT": "prose or short points, keeping every stated detail",
}


def render_spec(spec: NoteSpec) -> str:
    """The fields as the prompt reads them, grouped in the tenant's order."""
    if not spec.fields:
        return "(no structured fields for this organisation; write the narrative only)"
    lines: List[str] = []
    for f in spec.fields:
        line = f"- id `{f.id}` — {f.label} ({_TYPE_HINT.get(f.type, f.type)})"
        if f.section:
            line += f", section {f.section}"
        lines.append(line)
        if f.instruction:
            lines.append(f"  instruction: {f.instruction.strip()}")
        if f.options:
            opts = ", ".join(f"`{o.id}` = {o.label}" for o in f.options)
            lines.append(f"  options: {opts}")
    return "\n".join(lines)


def render_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=1)
