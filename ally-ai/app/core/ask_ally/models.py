"""The chat model the release names for the reply, as a LangChain model.

Thinking is off where the model allows it: it would delay the first words and
spend the reply's tokens (a Gemini 2.5 reply was cut mid-sentence). Gemini 3+
rejects `thinking_budget`, and OpenAI reasoning models keep their default
effort, exactly as ally-be's in-process loop sent them.
"""

from __future__ import annotations

from langchain_core.language_models import BaseChatModel

from app.core.ask_ally.schemas import ReplyModel
from app.core.config import settings
from app.core.llm.dispatch import is_gemini_3_or_later


class ReplyModelUnavailable(Exception):
    """The release names a model this environment cannot run."""


def build_reply_model(cfg: ReplyModel) -> BaseChatModel:
    if cfg.provider == "gemini":
        if not settings.GEMINI.API_KEY:
            raise ReplyModelUnavailable("GEMINI__API_KEY is not set")
        from langchain_google_genai import ChatGoogleGenerativeAI

        kwargs = {}
        if not is_gemini_3_or_later(cfg.model):
            kwargs["thinking_budget"] = 0
        return ChatGoogleGenerativeAI(
            model=cfg.model,
            google_api_key=settings.GEMINI.API_KEY,
            max_output_tokens=cfg.maxTokens,
            **kwargs,
        )
    if cfg.provider == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=cfg.model,
            api_key=settings.OPENAI.API_KEY,
            organization=settings.OPENAI.ORGANIZATION_ID or None,
            max_tokens=cfg.maxTokens,
        )
    if not settings.ANTHROPIC.API_KEY:
        raise ReplyModelUnavailable("ANTHROPIC__API_KEY is not set")
    from langchain_anthropic import ChatAnthropic

    return ChatAnthropic(
        model=cfg.model,
        api_key=settings.ANTHROPIC.API_KEY,
        max_tokens=cfg.maxTokens,
    )
