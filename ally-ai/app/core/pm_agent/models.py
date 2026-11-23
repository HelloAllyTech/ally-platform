"""The PM agent's chat models, as LangChain models.

Unlike Ask Ally (fast first words), the PM agent thinks: provider defaults for
thinking are kept, and the output limit is generous. A model this environment
cannot run (no key) is left out; the run fails only when neither model can run.
"""

from __future__ import annotations

from typing import Dict, Optional

from langchain_core.language_models import BaseChatModel

from app.core.config import settings
from app.core.llm.dispatch import (
    PROVIDER_ANTHROPIC,
    PROVIDER_GEMINI,
    PROVIDER_OPENAI,
    infer_provider_from_model,
)

#: Enough for a long tool call (a drafted prompt edit) plus thinking.
MAX_OUTPUT_TOKENS = 16_000


def build_chat_model(model: str) -> Optional[BaseChatModel]:
    provider = infer_provider_from_model(model)
    if provider == PROVIDER_GEMINI and settings.GEMINI.API_KEY:
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(
            model=model,
            google_api_key=settings.GEMINI.API_KEY,
            max_output_tokens=MAX_OUTPUT_TOKENS,
        )
    if provider == PROVIDER_OPENAI and settings.OPENAI.API_KEY:
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=model,
            api_key=settings.OPENAI.API_KEY,
            organization=settings.OPENAI.ORGANIZATION_ID or None,
            max_tokens=MAX_OUTPUT_TOKENS,
        )
    if provider == PROVIDER_ANTHROPIC and settings.ANTHROPIC.API_KEY:
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(
            model=model,
            api_key=settings.ANTHROPIC.API_KEY,
            max_tokens=MAX_OUTPUT_TOKENS,
        )
    return None


def build_models(
    primary: str, backup: Optional[str], prices: Dict[str, Dict[str, float]]
) -> Dict[str, BaseChatModel]:
    """The run's models by name: only priced ones this environment can run
    (an unpriced model would have no cost to hold the budget to)."""
    out: Dict[str, BaseChatModel] = {}
    for name in (primary, backup):
        if name and name not in out and name in prices:
            chat = build_chat_model(name)
            if chat is not None:
                out[name] = chat
    return out
