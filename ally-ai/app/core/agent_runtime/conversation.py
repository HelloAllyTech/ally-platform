"""The conversational agent's model call: one agent step.

It goes through `generate_structured`, the same dispatch as v1, so it
gets its provider fallback, usage accounting and temperature rules, and sends
nothing anywhere new.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.core.agent_runtime import stages
from app.core.agent_runtime.memory import history_lead, memory_section, remember_mode
from app.core.agent_runtime.mood import mood_section
from app.core.agent_runtime.playbooks import playbooks_section
from app.core.agent_runtime.prompt import AGENT_PROMPT_PATH, build_agent_prompt
from app.core.agent_runtime.schemas import step_schema
from app.core.agent_runtime.state import BotConfig
from app.core.agent_runtime.tools.base import Tool
from app.core.agent_runtime.tools.lists import offers_create, takes_details
from app.core.agent_runtime.trace import ReplyTokens
from app.core.config import settings
from app.core.llm.dispatch import STREAM_ANSWER, generate_structured
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
    timeout: Optional[float] = None,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """One agent call. Returns ``(step, meta)``: the step as a plain dict.

    `tools` are those still callable; empty means the model can only reply.
    `feedback` is why check refused the previous draft, when it did.
    `must_search` leaves `reply` out of the schema, so this step can only search.
    `timeout` is what is left of the run's hard cap, so a slow model call ends
    with the run rather than after it.
    """
    prompts = bot.get("prompts")
    # The bot's model override is merged into this prompt's entry by ally-be, as it
    # is for v1's answer prompt.
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
        lists=bool(bot.get("gateway_definitions")),
        today=bot.get("gateway_today") or "",
        prompts=prompts,
        memory=memory_section(bot, prompts),
        mood=mood_section(bot, prompts),
        playbooks=playbooks_section(
            bot.get("gateway_definitions"), prompts, bot.get("channel")
        ),
        history_lead=history_lead(bot),
        can_book=offers_create(bot.get("gateway_definitions")),
        takes_details=takes_details(bot.get("gateway_definitions")),
        channel=bot.get("channel"),
    )
    if not prompt:
        # A missing template must not become an unguided free-text reply.
        logger.error("Agent prompt template resolved empty")
        raise LLMInvocationFailedException(
            "The agent prompt template is missing or empty."
        )
    stages.stage(
        "agent_step_prompt",
        prompt_chars=len(prompt),
        passages=len(passages),
        tools=len(tools),
        history=len(history or []),
        must_search=must_search,
        retry=bool(feedback),
    )
    # Stream the reply as it is written (chunk H1 Part C), unless this step can only
    # search. Outside a streamed run the tokens go nowhere.
    sink = STREAM_ANSWER.set(None if must_search else ReplyTokens())
    try:
        parsed, meta = await generate_structured(
            schema=step_schema(
                tools, reply=not must_search, remember=remember_mode(bot)
            ),
            prompt=prompt,
            task=LLMTask.WHATSAPP_AGENT_STEP.value,
            provider=provider,
            model=model,
            temperature=temperature if temperature is not None else 0.0,
            reasoning_effort=settings.AGENT_RUNTIME.AGENT_REASONING_EFFORT,
            timeout=timeout,
        )
    finally:
        STREAM_ANSWER.reset(sink)
    return parsed.model_dump(mode="json"), dict(meta or {})
