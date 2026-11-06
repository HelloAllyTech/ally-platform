"""The conversational agent's model call: one agent step.

It goes through `generate_structured`, the same dispatch as the parity path, so it
gets its provider fallback, usage accounting and temperature rules, and sends
nothing anywhere new.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.core.agent_runtime.prompt import AGENT_PROMPT_PATH, build_agent_prompt
from app.core.agent_runtime.schemas import step_schema
from app.core.agent_runtime.state import BotConfig
from app.core.agent_runtime.tools.base import Tool
from app.core.config import settings
from app.core.llm.dispatch import generate_structured
from app.core.llm_usage.tasks import LLMTask
from app.exceptions.custom_exceptions import LLMInvocationFailedException
from app.prompts.resolver import get_backend_llm_overrides
from app.utils.logger import get_logger

logger = get_logger(__name__)


async def agent_step(
    message: str,
    *,
    passages: List[Dict[str, Any]],
    tools: Sequence[Tool],
    tool_budget: int,
    bot: BotConfig,
    history: Optional[List[Dict[str, str]]] = None,
    searches: Sequence[Dict[str, Any]] = (),
    feedback: Optional[str] = None,
    must_search: bool = False,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """One agent call. Returns ``(step, meta)``: the step as a plain dict.

    `tools` are those still callable; empty means the model can only reply.
    `feedback` is why check refused the previous draft, when it did.
    `must_search` leaves `reply` out of the schema, so this step can only search.
    """
    prompts = bot.get("prompts")
    # The bot's model override is merged into this prompt's entry by ally-be, as it
    # is for the parity path's answer prompt.
    provider, model, temperature = get_backend_llm_overrides(AGENT_PROMPT_PATH, prompts)
    prompt = build_agent_prompt(
        message,
        passages=passages,
        history=history,
        searches=searches,
        feedback=feedback,
        answer_mode=bot.get("answer_mode"),
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
        schema=step_schema(tools, reply=not must_search),
        prompt=prompt,
        task=LLMTask.WHATSAPP_AGENT_STEP.value,
        provider=provider,
        model=model,
        temperature=temperature if temperature is not None else 0.0,
        reasoning_effort=settings.AGENT_RUNTIME.AGENT_REASONING_EFFORT,
    )
    return parsed.model_dump(mode="json"), dict(meta or {})
