"""LLM-generated predictive thinking-fillers for a live role-play.

The static thinking-filler plays a fixed set of phrases authored in Studio. This
module produces *dynamic* fillers: every few seconds a background job reads the
live conversation and asks the LLM for short back-channels the character would
plausibly say next, tailored to where the dialogue is heading. The worker
synthesizes them to audio and prefers them over the static set (see
``worker._on_filler_agent_state``); the static phrases remain the fallback.

The prompt is the superadmin-editable ``filler/predictive_filler`` template
(System Skills), resolved via the normal prompt pipeline — DB override when a
superadmin edits it, local ``.txt`` otherwise.

Everything here is best-effort: any failure returns an empty list so the worker
silently keeps using the static fallback. It must never raise into the session.
"""

from __future__ import annotations

from typing import List

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from pydantic import BaseModel

from app.core.logger import get_logger
from app.prompts.resolver import load_and_format

logger = get_logger(__name__)

# How many recent turns to show the model. The filler only needs the immediate
# trajectory of the conversation, not the whole history — keeps the prompt small
# and the call fast (this runs repeatedly in the background).
_HISTORY_WINDOW = 10


class _PredictiveFillers(BaseModel):
    """Structured LLM output: the list of short filler options."""

    fillers: List[str]


def _build_scenario_context(scenario) -> str:
    """Compact description of the character the filler is spoken by.

    Pulls the few fields that orient the model to who is speaking and the
    situation, skipping anything empty. Best-effort — returns "" if nothing
    useful is available (the prompt still works, just with less grounding).
    """
    pd = getattr(scenario, "prompt_data", None)
    if pd is None:
        return ""
    parts: List[str] = []
    for label, attr in (
        ("Title", "title"),
        ("Character", "name"),
        ("Profession", "profession"),
        ("Description", "description"),
        ("Context", "context"),
        ("Role instructions", "role_instructions"),
    ):
        value = getattr(pd, attr, None)
        if value and str(value).strip():
            parts.append(f"{label}: {str(value).strip()}")
    return "\n".join(parts)


def _format_recent_fillers(recent_fillers: List[str] | None) -> str:
    """Render recently-*played* fillers for the anti-repeat instruction.

    Sourced from the caller's ``_recent_filler_phrases`` (what was actually
    spoken), not the last generated batch (which includes phrases that were
    generated but never played) — that's the right thing to avoid repeating.
    """
    cleaned = [p.strip() for p in (recent_fillers or []) if p and p.strip()]
    if not cleaned:
        return "(none yet)"
    return "; ".join(cleaned)


def _format_history(messages: List[BaseMessage], window: int = _HISTORY_WINDOW) -> str:
    """Render the last ``window`` turns as a readable script.

    HumanMessage = the learner (COUNSELLOR), AIMessage = the character the
    filler is for (CHARACTER). System messages are skipped.
    """
    lines: List[str] = []
    for msg in messages[-window:]:
        if isinstance(msg, HumanMessage):
            role = "COUNSELLOR"
        elif isinstance(msg, AIMessage):
            role = "CHARACTER"
        else:
            continue
        content = getattr(msg, "content", "")
        if content and str(content).strip():
            lines.append(f"{role}: {str(content).strip()}")
    return "\n".join(lines)


async def generate_predictive_fillers(
    llm_client,
    scenario,
    messages: List[BaseMessage],
    count: int = 5,
    recent_fillers: List[str] | None = None,
) -> List[str]:
    """Ask the LLM for short, context-aware filler phrases for ``scenario``.

    Returns a cleaned, de-duplicated list of short phrases, or ``[]`` on any
    failure / empty output — the caller treats ``[]`` as "keep the static
    fallback". Never raises.
    """
    if llm_client is None or count <= 0:
        return []

    conversation_text = _format_history(messages)
    if not conversation_text:
        # Nothing said yet — no trajectory to predict from.
        return []

    try:
        language_code = (
            getattr(getattr(scenario, "language_config", None), "language_code", None)
            or "en-US"
        )
        pd = getattr(scenario, "prompt_data", None)
        language_label = getattr(pd, "language_label", None) or language_code

        system_prompt = load_and_format(
            "filler/predictive_filler",
            prompt_data=pd,
            scenario_context=_build_scenario_context(scenario),
            language_label=language_label,
            language_code=language_code,
            count=count,
            recent_fillers=_format_recent_fillers(recent_fillers),
        )
        if not system_prompt or not system_prompt.strip():
            logger.warning("[FILLER] predictive: prompt template empty; skipping")
            return []

        llm_instance = llm_client.llm_instance
        response = await llm_instance.with_structured_output(
            _PredictiveFillers
        ).ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(
                    content=(
                        f"Conversation so far:\n\n{conversation_text}\n\n"
                        f"Generate {count} predictive filler options now."
                    )
                ),
            ]
        )

        raw = getattr(response, "fillers", None) or []
        cleaned: List[str] = []
        seen = set()
        for phrase in raw:
            if not isinstance(phrase, str):
                continue
            p = phrase.strip()
            key = p.lower()
            if p and key not in seen:
                seen.add(key)
                cleaned.append(p)
        return cleaned[:count]
    except Exception as e:  # noqa: BLE001 - filler must never break a session
        logger.warning("[FILLER] predictive: generation failed: %s", e)
        return []
