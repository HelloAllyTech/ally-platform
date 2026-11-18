"""Validation and repair checks done in code (DESIGN §6.5).

The model's answer is never trusted as-is: option ids must exist, numbers must
parse, every field value must cite turns that exist, and the narrative is put
back in time order if it drifted. Nothing here logs content — only reasons.
"""

from typing import Any, Dict, List, Optional, Set, Tuple

from app.core.note_harness.models import (
    FieldValue,
    NarrativePoint,
    NoteDraft,
    NoteField,
    NoteSpec,
    NoteTurn,
    ValidationStats,
)
from app.core.note_harness.transcript import format_ts, parse_ts

_TRUE = {"true", "yes", "y", "1"}
_FALSE = {"false", "no", "n", "0"}


def _option_id(field: NoteField, raw: Any) -> Optional[str]:
    """An option id, accepting the label too (models sometimes echo it)."""
    if raw is None:
        return None
    text = str(raw).strip()
    for o in field.options:
        if text == o.id:
            return o.id
    lowered = text.lower()
    for o in field.options:
        if lowered == o.label.strip().lower():
            return o.id
    return None


def coerce_value(field: NoteField, raw: Any) -> Tuple[Any, Optional[str]]:
    """(value, None) when usable; (None, reason) when it must be dropped."""
    if raw is None:
        return None, "null"
    t = field.type
    if t == "SINGLE_SELECT":
        if not field.options:
            text = str(raw).strip()
            return (text, None) if text else (None, "empty")
        oid = _option_id(field, raw)
        return (oid, None) if oid else (None, "unknown_option")
    if t == "MULTI_SELECT":
        items = raw if isinstance(raw, list) else [raw]
        if not field.options:
            ids = [str(i).strip() for i in items if str(i).strip()]
        else:
            ids = [oid for oid in (_option_id(field, i) for i in items) if oid]
        ids = list(dict.fromkeys(ids))
        return (ids, None) if ids else (None, "unknown_option")
    if t == "NUMBER":
        if isinstance(raw, bool):
            return None, "not_a_number"
        try:
            num = float(str(raw).strip())
        except ValueError:
            return None, "not_a_number"
        return (int(num) if num.is_integer() else num), None
    if t == "BOOLEAN":
        if isinstance(raw, bool):
            return raw, None
        text = str(raw).strip().lower()
        if text in _TRUE:
            return True, None
        if text in _FALSE:
            return False, None
        return None, "not_a_boolean"
    text = str(raw).strip()
    return (text, None) if text else (None, "empty")


def _point_seconds(point: NarrativePoint, turn_start: Dict[int, float]) -> float:
    """When a point happened: its first cited turn, else its own stamp."""
    starts = [turn_start[i] for i in point.turn_ids if i in turn_start]
    if starts:
        return min(starts)
    parsed = parse_ts(point.t)
    return parsed if parsed is not None else float("inf")


def validate_draft(
    raw: Dict[str, Any], spec: NoteSpec, turns: List[NoteTurn]
) -> Tuple[NoteDraft, ValidationStats]:
    stats = ValidationStats()
    known: Set[int] = {t.id for t in turns}
    turn_start = {t.id: t.start for t in turns}
    timed = any(t.start > 0 for t in turns)

    # Narrative: keep points with text, cite only real turns, keep order.
    points: List[NarrativePoint] = []
    for item in raw.get("narrative") or []:
        if not isinstance(item, dict):
            stats.dropped_points += 1
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            stats.dropped_points += 1
            continue
        ids = [i for i in (item.get("turn_ids") or []) if isinstance(i, int)]
        ids = [i for i in ids if i in known]
        point = NarrativePoint(t=str(item.get("t") or ""), text=text, turn_ids=ids)
        if ids and timed:
            # The turn's real time wins over the model's stamp.
            point.t = format_ts(min(turn_start[i] for i in ids))
        points.append(point)

    if timed:
        keys = [_point_seconds(p, turn_start) for p in points]
    else:
        keys = [min(p.turn_ids) if p.turn_ids else float("inf") for p in points]
    finite = [k for k in keys if k != float("inf")]
    if finite != sorted(finite):
        stats.reordered = True
        # Stable sort; points with no anchor stay after the anchored ones
        # before them, which keeps them near where the model put them.
        anchored: List[Tuple[float, int]] = []
        last = 0.0
        for idx, k in enumerate(keys):
            if k != float("inf"):
                last = k
            anchored.append((last, idx))
        order = [idx for _, idx in sorted(anchored)]
        points = [points[i] for i in order]

    # Fields: only spec fields, coerced, and only with real evidence.
    raw_fields = raw.get("fields") or {}
    fields: Dict[str, FieldValue] = {}
    for f in spec.fields:
        entry = raw_fields.get(f.id)
        if entry is None:
            continue
        if not isinstance(entry, dict):
            stats.dropped_fields[f.id] = "malformed"
            continue
        value, reason = coerce_value(f, entry.get("value"))
        if reason:
            if reason != "null":
                stats.dropped_fields[f.id] = reason
            continue
        cited = [
            i for i in (entry.get("evidence_turn_ids") or []) if isinstance(i, int)
        ]
        evidence = [i for i in cited if i in known]
        if not evidence:
            stats.dropped_fields[f.id] = (
                "evidence_not_found" if cited else "no_evidence"
            )
            continue
        fields[f.id] = FieldValue(value=value, evidence_turn_ids=evidence)

    return NoteDraft(narrative=points, fields=fields), stats


def merge_segment_points(parts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Join the map step's timeline notes in part order (deterministic)."""
    merged: List[Dict[str, Any]] = []
    for part in parts:
        merged.extend(p for p in (part.get("points") or []) if isinstance(p, dict))
    return merged


def merge_field_notes(parts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    notes: List[Dict[str, Any]] = []
    for part in parts:
        notes.extend(n for n in (part.get("field_notes") or []) if isinstance(n, dict))
    return notes
