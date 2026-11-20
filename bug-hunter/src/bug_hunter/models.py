"""Model factory: the only place that knows about LLM providers.

``get_model(role)`` returns a chat model built from ``config/models.yaml`` (after env
overrides) with temperature, timeout and retries from the config and the role's
fallbacks attached. Nothing else in the package imports a provider SDK.

``RunnableWithFallbacks`` from langchain-core does not expose the chat-model API
(``with_structured_output``, ``bind_tools``), so a role with fallbacks returns
``ChatModelWithFallbacks``: those two calls are applied to the primary model and to
every fallback, and the result keeps the same fallback chain.
"""

from __future__ import annotations

from typing import Any, Sequence

from langchain.chat_models import init_chat_model
from langchain.embeddings import init_embeddings
from langchain_core.embeddings import Embeddings
from langchain_core.language_models import BaseChatModel
from langchain_core.runnables import Runnable, RunnableWithFallbacks

from bug_hunter.config import (
    CHAT_ROLES,
    BugHunterConfig,
    ConfigError,
    ModelSpec,
    load_config,
)


class ChatModelWithFallbacks(RunnableWithFallbacks):
    """A chat model plus fallbacks that still behaves like a chat model.

    ``runnable`` is the primary chat model and ``fallbacks`` the chat models tried
    in order when it raises. ``with_structured_output`` and ``bind_tools`` apply to
    the primary and to every fallback so the chain survives those calls.
    """

    def with_structured_output(
        self, schema: Any, **kwargs: Any
    ) -> RunnableWithFallbacks:
        primary = self.runnable.with_structured_output(schema, **kwargs)
        fallbacks = [
            fallback.with_structured_output(schema, **kwargs)
            for fallback in self.fallbacks
        ]
        return primary.with_fallbacks(
            fallbacks,
            exceptions_to_handle=self.exceptions_to_handle,
            exception_key=self.exception_key,
        )

    def bind_tools(
        self, tools: Sequence[Any], **kwargs: Any
    ) -> "ChatModelWithFallbacks":
        return ChatModelWithFallbacks(
            runnable=self.runnable.bind_tools(tools, **kwargs),
            fallbacks=[
                fallback.bind_tools(tools, **kwargs) for fallback in self.fallbacks
            ],
            exceptions_to_handle=self.exceptions_to_handle,
            exception_key=self.exception_key,
        )


ChatModel = BaseChatModel | ChatModelWithFallbacks


def _build_chat_model(spec: ModelSpec, config: BugHunterConfig) -> BaseChatModel:
    defaults = config.models.defaults
    extra: dict = {}
    if spec.provider == "google_genai":
        # system messages ("developer instructions") need the v1beta Gemini API;
        # with google-genai 3.x the default resolved to v1 and the review call failed
        extra["api_version"] = "v1beta"
    return init_chat_model(
        spec.model,
        model_provider=spec.provider,
        temperature=defaults.temperature,
        timeout=defaults.timeout_s,
        max_retries=defaults.max_retries,
        **extra,
    )


def get_model(role: str, config: BugHunterConfig | None = None) -> ChatModel:
    """Chat model for ``role`` (triage, investigate, fix, review) from config alone.

    Raises ``ConfigError`` for an unknown role or for ``embeddings``, which is not a
    chat model; use ``get_embeddings`` for that.
    """
    config = config or load_config()
    if role not in CHAT_ROLES:
        raise ConfigError(
            f"unknown chat model role {role!r}; expected one of {', '.join(CHAT_ROLES)}"
        )
    primary = _build_chat_model(config.model_for(role), config)
    fallbacks = [_build_chat_model(spec, config) for spec in config.fallbacks_for(role)]
    if not fallbacks:
        return primary
    return ChatModelWithFallbacks(runnable=primary, fallbacks=fallbacks)


def get_embeddings(config: BugHunterConfig | None = None) -> Embeddings:
    """Embeddings model for the ``embeddings`` role."""
    config = config or load_config()
    spec = config.model_for("embeddings")
    return init_embeddings(spec.model, provider=spec.provider)


def primary_of(model: Runnable) -> Runnable:
    """The primary model behind ``get_model``'s result (for logging and tests)."""
    if isinstance(model, RunnableWithFallbacks):
        return model.runnable
    return model
