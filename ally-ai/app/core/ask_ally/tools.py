"""Ask Ally's tools (v9 FR-43: the reply shares the debrief's capabilities —
knowledge base, learner history, session data). The transcript, the debrief
and the organisation's wording are already in the system prompt; these are
what a question may need beyond them. Each is one call to ally-be's Debrief
gateway with the reply's run token (CONTRACT.md §2, §5); ally-be scopes it to
the learner and session the token names.

Every tool records a one-line `found` for the run view. A failure raises, and
`ToolErrorMiddleware` tells the model the tool is unavailable.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from langchain.tools import ToolRuntime, tool

from app.core.ask_ally.context import ReplyRun

#: A guidance topic is a few words naming a skill or situation, never a message.
TOPIC_MAX_WORDS = 10
TOPIC_MAX_CHARS = 80
#: Passages per lookup, as the in-process loop asked for.
GUIDANCE_PASSAGES = 3
#: Earlier "Work on this" points the history tool returns.
HISTORY_POINTS = 10


def clean_topic(raw: Any) -> Optional[str]:
    """A short topic, or None: more than a few words reads as a message."""
    if not isinstance(raw, str):
        return None
    words = raw.split()
    if not words:
        return None
    return " ".join(words[:TOPIC_MAX_WORDS])[:TOPIC_MAX_CHARS]


def _note(
    runtime: ToolRuntime[ReplyRun], found: str, topic: Optional[str] = None
) -> None:
    if runtime.tool_call_id:
        runtime.context.found[runtime.tool_call_id] = (found, topic)


async def _call(runtime: ToolRuntime[ReplyRun], name: str, body: Dict[str, Any]):
    return await runtime.context.gateway.call(name, body)


@tool
async def search_guidance(topic: str, runtime: ToolRuntime[ReplyRun]) -> str:
    """Look up practice guidance the learner's organisation uses, for a
    counselling skill or situation the learner is asking about. Use it when the
    answer should rest on guidance rather than on the session alone.

    Args:
        topic: The skill or situation in a few words, e.g. "responding to a
            suicide disclosure" or "open questions". Never the learner's own
            words, names or personal details.
    """
    clean = clean_topic(topic)
    if not clean:
        _note(runtime, "no topic")
        return "Name a skill or situation to look up."
    res = await _call(
        runtime,
        "guidance_search",
        {"topics": [{"situation": clean}], "per_moment": GUIDANCE_PASSAGES},
    )
    if res.get("unavailable"):
        raise RuntimeError("guidance unavailable")
    passages = [] if res.get("no_confident_match") else res.get("passages") or []
    if not passages:
        _note(runtime, "no confident match", clean)
        return "Nothing in the guidance matches confidently. Answer without it."
    titles = [p.get("title") or p.get("citation") or "" for p in passages]
    _note(runtime, f"{len(passages)} passage(s): {'; '.join(titles)}"[:200], clean)
    return "\n\n".join(f"{t}: {p.get('text') or ''}" for t, p in zip(titles, passages))


@tool
async def get_learner_history(runtime: ToolRuntime[ReplyRun]) -> str:
    """The learner's earlier "Work on this" points from past debriefs, newest
    first. Use it when they ask how they are doing over time or whether
    something keeps coming up."""
    res = await _call(runtime, "get_learner_history", {"limit": HISTORY_POINTS})
    points = res.get("points") or []
    if not points:
        _note(runtime, "none")
        return "This learner has no earlier debriefs."
    _note(runtime, f"{len(points)} earlier point(s)")
    return "\n".join(
        f"{p.get('date')} · {p.get('skill')}: {p.get('point')}" for p in points
    )


@tool
async def get_live_detections(runtime: ToolRuntime[ReplyRun]) -> str:
    """What the live detector recorded during this roleplay for each behaviour
    the scenario watches for. It can be wrong; use it only as a second opinion
    next to the transcript."""
    res = await _call(runtime, "get_live_detections", {})
    detections = res.get("detections") or []
    if not detections:
        _note(runtime, "none")
        return "The scenario has no live detector record."
    hit = sum(1 for d in detections if d.get("detected"))
    _note(runtime, f"{hit} of {len(detections)} detected")
    return "\n".join(
        f"{d.get('behaviour')}: "
        + (f"detected ({d.get('times')}×)" if d.get("detected") else "not detected")
        for d in detections
    )


ASK_ALLY_TOOLS = [search_guidance, get_learner_history, get_live_detections]
