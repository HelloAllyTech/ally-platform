"""The small delivery planner, for scenarios WITHOUT client working memory.

Working-memory scenarios get their delivery plan from the updater call they
already make (``ProposedUpdate.delivery``). Everything else — about a third of
prod sessions — would otherwise have no plan and play the neutral default every
turn, so this makes the same structured proposal on a small model, from the
same inputs the old filler generator used (persona, voice, the character's last
line), and nothing more.

It runs from a detached task scheduled by the ``plan_delivery`` graph node,
strictly after the reply has streamed, so it never sits between the learner
finishing and hearing audio. Best-effort: any failure returns None and the next
turn reuses the previous plan.

Token usage is recorded as ``thinking_filler`` — this call replaces filler
generation in that bucket, so the cost dashboard's series stays continuous.
"""

from __future__ import annotations

import asyncio
from typing import List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from app.core.livekit.delivery import ProposedDelivery
from app.core.logger import get_logger
from app.prompts.resolver import load_and_format

logger = get_logger(__name__)

_TEMPLATE_PATH = "filler/delivery_planner"
#: The plan fits the character's CURRENT state, which the last few lines carry;
#: a longer window only makes a small model slower.
_HISTORY_TURNS = 4


def _format_turns(messages: List[BaseMessage], window: int = _HISTORY_TURNS) -> str:
    lines: List[str] = []
    for msg in list(messages or [])[-window:]:
        if isinstance(msg, HumanMessage):
            role = "OTHER PERSON"
        elif isinstance(msg, AIMessage):
            role = "CHARACTER"
        else:
            continue
        content = str(getattr(msg, "content", "") or "").strip()
        if content:
            lines.append(f"{role}: {content}")
    return "\n".join(lines)


async def plan_next_delivery(
    llm_client,
    scenario,
    messages: List[BaseMessage],
    opener_catalog: str,
    timeout_s: float,
    room_id: Optional[str] = None,
) -> Optional[ProposedDelivery]:
    """Propose how the character starts its next reply. Never raises."""
    if llm_client is None:
        return None
    turns = _format_turns(messages)
    if not turns:
        return None
    try:
        from app.core.livekit.predictive_filler import (
            _build_scenario_context,
            build_character_voice,
        )

        pd = getattr(scenario, "prompt_data", None)
        language_code = (
            getattr(getattr(scenario, "language_config", None), "language_code", None)
            or "en-US"
        )
        language_label = getattr(pd, "language_label", None) or language_code
        system_prompt = load_and_format(
            _TEMPLATE_PATH,
            prompt_data=pd,
            scenario_context=_build_scenario_context(scenario),
            character_voice=build_character_voice(scenario, messages),
            language_label=language_label,
            opener_catalog=opener_catalog,
        )
        if not system_prompt or not system_prompt.strip():
            logger.warning("[DELIVERY] planner prompt resolved empty; skipping")
            return None

        call = llm_client.llm_instance.with_structured_output(
            ProposedDelivery, include_raw=True
        ).ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(
                    content=(
                        f"The latest turns:\n\n{turns}\n\n"
                        "Plan how the character starts their next reply."
                    )
                ),
            ]
        )
        result = await asyncio.wait_for(call, timeout=timeout_s)
        if isinstance(result, dict):
            # Emitted before parsing: a parse failure still spent the tokens.
            from app.core.llm_usage.emitter import emit_langchain_usage
            from app.core.llm_usage.tasks import LLMTask

            emit_langchain_usage(
                result.get("raw"),
                task=LLMTask.THINKING_FILLER.value,
                llm_client=llm_client,
                room_id=room_id,
                scenario_id=getattr(scenario, "id", None),
            )
            proposal = result.get("parsed")
        else:
            proposal = result
        return proposal if isinstance(proposal, ProposedDelivery) else None
    except asyncio.TimeoutError:
        logger.info("[DELIVERY] planner timed out; keeping the previous plan")
        return None
    except Exception as e:  # noqa: BLE001 - a plan must never break a session
        logger.warning("[DELIVERY] planner failed: %s", e)
        return None
