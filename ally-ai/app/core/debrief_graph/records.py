"""DebriefRunStepRecord helpers (ally-be `debrief-run.entity.ts`), and the live
progress event the runner relays to ally-be.

A record is a plain dict with the keys ally-be's runner wrote for that kind of
step, so the Console reads it unchanged.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional, Union

from app.core.debrief_graph.budget import budget_left
from app.core.debrief_graph.constants import SKIP_WHY
from app.core.debrief_graph.context import DebriefRunContext


def iso(ms: float) -> str:
    """`new Date(ms).toISOString()`."""
    stamp = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    return stamp.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def js_len(value: Any) -> int:
    """`JSON.stringify(value).length`, for the cost estimate's input size."""
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")))


def safe_summary(summarise: Optional[Callable[[Any], str]], res: Any) -> Optional[str]:
    """A summary that cannot fail the run: an odd answer shape gives no line."""
    if summarise is None:
        return None
    try:
        return summarise(res)[:300] or None
    except Exception:  # noqa: BLE001
        return None


def skipped(
    ctx: DebriefRunContext,
    estimated: float,
    step: Union[str, Dict[str, Any]],
    note: str,
    why: Optional[str] = None,
) -> Dict[str, Any]:
    """A step the runner did not run, and why."""
    name = step if isinstance(step, str) else step.get("step")
    return {
        "step": name,
        "label": "" if isinstance(step, str) else step.get("label", ""),
        "status": "skipped",
        "startedAt": iso(ctx.clock()),
        "ms": 0,
        "note": note,
        "why": why or SKIP_WHY.get(note),
        "budgetLeftUsd": budget_left(ctx.ceiling_usd, estimated),
    }


def progress_event(
    step: str,
    has_risk_cue: bool,
    round_: Optional[int] = None,
    topic: Optional[str] = None,
    label_key: Optional[str] = None,
) -> Dict[str, Any]:
    """What the learner's "working" panel says now (v9 FR-27): emitted on the
    graph's custom stream; the runner sends it to the gateway's `progress`."""
    data: Dict[str, Any] = {"step": step}
    if round_:
        data["round"] = round_
    if topic:
        data["topic"] = topic
    if label_key:
        # A registry agent's keyed progress label (FR-27), translated by the apps.
        data["label_key"] = label_key
    data["has_risk_cue"] = bool(has_risk_cue)
    return {"event": "progress", "data": data}
