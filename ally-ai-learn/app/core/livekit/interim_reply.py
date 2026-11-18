"""Interim generator — the holding line for scenarios WITHOUT working memory.

While the learner is still speaking on a long turn, the worker snapshots the
partial transcript and asks a FAST, DEDICATED model (separate from the
scenario's main reply LLM — see ``settings.INTERIM_REPLY_MODEL``) for one short,
NON-COMMITTAL holding line the character would plausibly say. The worker
pre-renders it and hands it to the ``OpenerPlayer``, which plays it as the
turn's interim under the same timing rules as any other (after the filler, only
if it fits the wait) and tells the real reply its words, so the reply carries
on from it. Working-memory scenarios never call this: the updater writes their
interim into the delivery plan.

The interim is never inserted into the LangGraph message history — it lives
only in the transcript sink, like the filler — and is recorded as a CLIENT
transcript line, so it is treated as a real (if non-committal) turn.

The prompt is the superadmin-editable ``filler/interim_reply`` template,
resolved via the normal prompt pipeline (DB override when edited, local ``.txt``
otherwise).

Everything here is best-effort: any failure returns ``None`` so the worker
silently falls back to no interim for the turn. It must never raise into the
session. The call's token usage is emitted to ``llm_usage`` as
``interim_reply`` against the room the caller passes (the call runs from a
worker task, outside the graph run whose context var ``get_room_id`` reads).
"""

from __future__ import annotations

import asyncio
from typing import List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from pydantic import BaseModel

from app.core.config import settings
from app.core.logger import get_logger
from app.prompts.resolver import load_and_format

logger = get_logger(__name__)


class _InterimReply(BaseModel):
    """Structured LLM output: the single short interim reply."""

    reply: str


def is_interim_reply_enabled(scenario) -> bool:
    """Whether the predictive interim reply is on for this session.

    Both gates must hold: the global kill-switch
    (``settings.INTERIM_REPLY_GLOBALLY_ENABLED``, default off) AND the per-sim
    opt-in (``prompt_data.interim_reply_enabled``, Studio ``interimReplyEnabled``,
    default off). Mirrors the comfort-audio / back-channel gating.
    """
    if not getattr(settings, "INTERIM_REPLY_GLOBALLY_ENABLED", False):
        return False
    prompt_data = getattr(scenario, "prompt_data", None)
    if prompt_data is None:
        return False
    # Stage Director prompts take their interim from here, as Main Agent Prompt
    # #3 took one from its updater on every session, so it is on unless the
    # author switched it off.
    from app.core.graph.prompt import prompt_declares_stage_director

    if prompt_declares_stage_director(prompt_data):
        return getattr(prompt_data, "interim_reply_setting", None) is not False
    return bool(getattr(prompt_data, "interim_reply_enabled", False))


def _build_scenario_context(scenario) -> str:
    """Compact description of the character the interim is spoken by.

    Pulls the few fields that orient the model to who is speaking and the
    situation, skipping anything empty. Best-effort — returns "" if nothing
    useful is available. (Duplicated from predictive_filler/backchannel so this
    layer stays self-contained, matching the existing per-module convention.)
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


def _format_history(messages: List[BaseMessage], window: int) -> str:
    """Render the last ``window`` turns as a readable script.

    HumanMessage = the learner (COUNSELLOR), AIMessage = the character
    (CHARACTER). System messages are skipped. Kept short so the fast model
    stays fast.
    """
    if window <= 0:
        return ""
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


async def generate_interim_reply(
    interim_llm_client,
    scenario,
    messages: List[BaseMessage],
    partial_text: str,
    room_id: Optional[str] = None,
) -> Optional[str]:
    """Generate one short, non-committal interim reply from the partial transcript.

    ``interim_llm_client`` is the DEDICATED fast model client (not the scenario's
    main LLM). ``messages`` is a small recent-history window; ``partial_text`` is
    the learner's interim (incomplete) utterance. Returns the reply text, or
    ``None`` on any failure / empty output (the caller treats ``None`` as "no
    interim this turn"). Bounded by ``INTERIM_REPLY_LLM_TIMEOUT_MS``. Never raises.
    """
    if interim_llm_client is None:
        return None
    partial = (partial_text or "").strip()
    if not partial:
        return None

    try:
        language_code = (
            getattr(getattr(scenario, "language_config", None), "language_code", None)
            or "en-US"
        )
        pd = getattr(scenario, "prompt_data", None)
        language_label = getattr(pd, "language_label", None) or language_code

        system_prompt = load_and_format(
            "filler/interim_reply",
            prompt_data=pd,
            scenario_context=_build_scenario_context(scenario),
            language_label=language_label,
            language_code=language_code,
        )
        if not system_prompt or not system_prompt.strip():
            logger.warning("[INTERIM] prompt template empty; skipping")
            return None

        history_turns = int(getattr(settings, "INTERIM_REPLY_HISTORY_TURNS", 4))
        conversation_text = _format_history(messages, history_turns)
        history_block = (
            f"Conversation so far:\n\n{conversation_text}\n\n"
            if conversation_text
            else ""
        )
        user_content = (
            f"{history_block}"
            f"The learner is mid-sentence; partial transcript of what they are "
            f"saying right now:\n\n{partial}\n\n"
            f"Generate ONE short, non-committal interim reply now, in "
            f"{language_label} ({language_code})."
        )

        timeout_s = (
            float(getattr(settings, "INTERIM_REPLY_LLM_TIMEOUT_MS", 1500.0)) / 1000.0
        )
        llm_instance = interim_llm_client.llm_instance
        # include_raw because the parsed model alone carries no usage metadata.
        result = await asyncio.wait_for(
            llm_instance.with_structured_output(
                _InterimReply, include_raw=True
            ).ainvoke(
                [
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=user_content),
                ]
            ),
            timeout=timeout_s,
        )
        if isinstance(result, dict):
            # Emitted before parsing: a parse failure still spent the tokens.
            from app.core.llm_usage.emitter import emit_langchain_usage
            from app.core.llm_usage.tasks import LLMTask

            emit_langchain_usage(
                result.get("raw"),
                task=LLMTask.INTERIM_REPLY.value,
                llm_client=interim_llm_client,
                room_id=room_id,
                scenario_id=getattr(scenario, "id", None),
            )
            response = result.get("parsed")
        else:
            # Defensive: some providers/wrappers may ignore include_raw.
            response = result

        reply = getattr(response, "reply", None)
        if not isinstance(reply, str):
            return None
        reply = reply.strip()
        return reply or None
    except asyncio.TimeoutError:
        logger.info("[INTERIM] generation timed out; no interim this turn")
        return None
    except Exception as e:  # noqa: BLE001 - interim must never break a session
        logger.warning("[INTERIM] generation failed: %s", e)
        return None
