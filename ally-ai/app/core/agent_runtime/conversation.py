"""The conversational agent's two model calls: contextualise, and one agent step.

Both go through `generate_structured`, the same dispatch as the parity path, so
they get its provider fallback, usage accounting and temperature rules, and send
nothing anywhere new.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.core.agent_runtime.prompt import (
    AGENT_PROMPT_PATH,
    CONTEXTUALIZE_PROMPT_PATH,
    build_agent_prompt,
    build_contextualize_prompt,
)
from app.core.agent_runtime.schemas import TurnUnderstanding, step_schema
from app.core.config import settings
from app.core.llm.dispatch import generate_structured
from app.core.llm_usage.tasks import LLMTask
from app.exceptions.custom_exceptions import LLMInvocationFailedException
from app.prompts.resolver import get_backend_llm_overrides
from app.utils.logger import get_logger

logger = get_logger(__name__)


async def contextualize(
    message: str,
    *,
    history: Optional[List[Dict[str, str]]] = None,
    prompts: Optional[Dict[str, Any]] = None,
) -> Tuple[TurnUnderstanding, bool]:
    """Understand the latest message using the conversation.

    Returns ``(understanding, degraded)``. Like translation in the parity path, a
    failure never fails the message: it degrades to a question searched as written,
    with `degraded` set so a weak search is not counted as a gap.
    """
    provider, model, temperature = get_backend_llm_overrides(
        CONTEXTUALIZE_PROMPT_PATH, prompts
    )
    prompt = build_contextualize_prompt(message, history=history, prompts=prompts)
    if not prompt:
        logger.error("Contextualise prompt template resolved empty")
        return TurnUnderstanding(turn_type="question"), True
    try:
        parsed, _meta = await generate_structured(
            schema=TurnUnderstanding,
            prompt=prompt,
            task=LLMTask.WHATSAPP_AGENT_CONTEXTUALIZE.value,
            provider=provider,
            model=model or settings.KNOWLEDGE_AGENT.TRANSLATE_MODEL,
            temperature=temperature if temperature is not None else 0.0,
        )
    except Exception as e:  # noqa: BLE001 — never fail the message over this
        logger.warning(
            "Contextualise failed (%s); treating the message as a question",
            type(e).__name__,
        )
        return TurnUnderstanding(turn_type="question"), True
    return parsed, False


async def agent_step(
    message: str,
    *,
    passages: List[Dict[str, Any]],
    tools: Sequence[Any],
    tool_budget: int,
    bot: Dict[str, Any],
    history: Optional[List[Dict[str, str]]] = None,
    turn_type: Optional[str] = None,
    standalone_query: Optional[str] = None,
    searches: Sequence[Dict[str, Any]] = (),
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """One agent call. Returns ``(step, meta)``: the step as a plain dict.

    `tools` are those still callable; empty means the model can only reply.
    """
    prompts = bot.get("prompts")
    # The bot's model override is merged into this prompt's entry by ally-be, as it
    # is for the parity path's answer prompt.
    provider, model, temperature = get_backend_llm_overrides(AGENT_PROMPT_PATH, prompts)
    prompt = build_agent_prompt(
        message,
        passages=passages,
        history=history,
        turn_type=turn_type,
        standalone_query=standalone_query,
        searches=searches,
        tools=tools,
        tool_budget=tool_budget,
        knowledge_topics=bot.get("knowledge_topics"),
        decline_text=bot.get("decline_text"),
        max_chars=bot.get("max_answer_chars") or 1400,
        persona=bot.get("persona"),
        prompts=prompts,
    )
    if not prompt:
        # A missing template must not become an unguided free-text reply.
        logger.error("Agent prompt template resolved empty")
        raise LLMInvocationFailedException(
            "The agent prompt template is missing or empty."
        )
    parsed, meta = await generate_structured(
        schema=step_schema(tools),
        prompt=prompt,
        task=LLMTask.WHATSAPP_AGENT_STEP.value,
        provider=provider,
        model=model,
        temperature=temperature if temperature is not None else 0.0,
    )
    return parsed.model_dump(mode="json"), dict(meta or {})
