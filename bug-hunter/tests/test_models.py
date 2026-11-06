"""Model factory: builds the right class with the right params from config alone,
never calls a provider, and keeps fallbacks through with_structured_output and
bind_tools (chunks 05–06 call both on get_model's result)."""

from __future__ import annotations

from typing import Any

import pytest
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import RunnableLambda, RunnableWithFallbacks
from langchain_core.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from pydantic import BaseModel

from bug_hunter import models as models_module
from bug_hunter.config import BugHunterConfig, ConfigError, load_config
from bug_hunter.models import (
    ChatModelWithFallbacks,
    get_embeddings,
    get_model,
    primary_of,
)


class Verdict(BaseModel):
    is_bug: bool
    reason: str


@tool
def read_file(path: str) -> str:
    """Read a file."""
    return ""


# --- the right class with the right params --------------------------------------


def test_review_is_gemini_with_config_params(config: BugHunterConfig) -> None:
    model = get_model("review", config)
    assert isinstance(model, ChatGoogleGenerativeAI)
    assert model.model.endswith("gemini-2.5-pro")
    assert model.temperature == 0
    assert model.timeout == 120
    assert model.max_retries == 2


def test_triage_is_openai_mini(config: BugHunterConfig) -> None:
    model = get_model("triage", config)
    assert isinstance(model, ChatOpenAI)
    assert model.model_name == "gpt-5-mini"
    assert model.request_timeout == 120
    assert model.max_retries == 2


def test_factory_passes_config_values_to_init_chat_model(
    config: BugHunterConfig, mocker: Any
) -> None:
    spy = mocker.spy(models_module, "init_chat_model")
    get_model("fix", config)
    calls = [c.kwargs | {"model": c.args[0]} for c in spy.call_args_list]
    assert calls == [
        {
            "model": "gpt-5",
            "model_provider": "openai",
            "temperature": 0,
            "timeout": 120,
            "max_retries": 2,
        },
        {
            "model": "gemini-2.5-pro",
            "model_provider": "google_genai",
            "temperature": 0,
            "timeout": 120,
            "max_retries": 2,
        },
    ]


def test_role_without_fallbacks_returns_plain_chat_model(
    config: BugHunterConfig,
) -> None:
    assert isinstance(get_model("review", config), BaseChatModel)
    assert isinstance(get_model("triage", config), BaseChatModel)


def test_fix_has_gemini_fallback(config: BugHunterConfig) -> None:
    model = get_model("fix", config)
    assert isinstance(model, ChatModelWithFallbacks)
    assert isinstance(model.runnable, ChatOpenAI)
    assert model.runnable.model_name == "gpt-5"
    assert [type(f) for f in model.fallbacks] == [ChatGoogleGenerativeAI]
    assert primary_of(model) is model.runnable


def test_investigate_has_gemini_fallback(config: BugHunterConfig) -> None:
    model = get_model("investigate", config)
    assert isinstance(model, ChatModelWithFallbacks)
    assert [type(f) for f in model.fallbacks] == [ChatGoogleGenerativeAI]


def test_env_override_changes_primary_and_keeps_fallback() -> None:
    cfg = load_config(env={"BUGHUNTER_MODEL_FIX": "openai:gpt-5-mini"})
    model = get_model("fix", cfg)
    assert isinstance(model.runnable, ChatOpenAI)
    assert model.runnable.model_name == "gpt-5-mini"
    assert [type(f) for f in model.fallbacks] == [ChatGoogleGenerativeAI]


def test_unknown_role(config: BugHunterConfig) -> None:
    with pytest.raises(ConfigError, match="unknown chat model role 'planner'"):
        get_model("planner", config)


def test_embeddings_is_not_a_chat_role(config: BugHunterConfig) -> None:
    with pytest.raises(ConfigError, match="unknown chat model role 'embeddings'"):
        get_model("embeddings", config)


def test_get_embeddings(config: BugHunterConfig) -> None:
    emb = get_embeddings(config)
    assert isinstance(emb, OpenAIEmbeddings)
    assert emb.model == "text-embedding-3-small"


# --- with_structured_output and bind_tools survive the fallback wrapper ----------


def test_structured_output_applies_to_primary_and_fallback(
    config: BugHunterConfig,
) -> None:
    structured = get_model("fix", config).with_structured_output(Verdict)
    assert isinstance(structured, RunnableWithFallbacks)
    primary_step = structured.runnable.first
    fallback_step = structured.fallbacks[0].first
    assert isinstance(primary_step.bound, ChatOpenAI)
    assert isinstance(fallback_step.bound, ChatGoogleGenerativeAI)
    assert "response_format" in primary_step.kwargs
    assert "response_json_schema" in fallback_step.kwargs
    assert len(structured.fallbacks) == 1


def test_bind_tools_applies_to_primary_and_fallback(config: BugHunterConfig) -> None:
    bound = get_model("fix", config).bind_tools([read_file])
    assert isinstance(bound, ChatModelWithFallbacks)
    assert isinstance(bound.runnable.bound, ChatOpenAI)
    assert isinstance(bound.fallbacks[0].bound, ChatGoogleGenerativeAI)
    primary_tools = [t["function"]["name"] for t in bound.runnable.kwargs["tools"]]
    fallback_tools = [t["function"]["name"] for t in bound.fallbacks[0].kwargs["tools"]]
    assert primary_tools == ["read_file"]
    assert fallback_tools == ["read_file"]


def test_bind_tools_then_structured_output_keeps_fallback(
    config: BugHunterConfig,
) -> None:
    bound = get_model("fix", config).bind_tools([read_file], tool_choice="any")
    assert isinstance(bound, ChatModelWithFallbacks)
    assert len(bound.fallbacks) == 1
    assert bound.runnable.kwargs["tool_choice"] is not None


class _FakeChat(BaseChatModel):
    """Offline chat model: answers with ``reply`` or raises ``error``."""

    reply: str = ""
    error: str | None = None

    @property
    def _llm_type(self) -> str:
        return "fake"

    def _generate(
        self, messages: Any, stop: Any = None, run_manager: Any = None, **kwargs: Any
    ) -> ChatResult:
        if self.error:
            raise RuntimeError(self.error)
        return ChatResult(
            generations=[ChatGeneration(message=AIMessage(content=self.reply))]
        )

    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:
        return self.bind(tools=[getattr(t, "name", str(t)) for t in tools])

    def with_structured_output(self, schema: Any, **kwargs: Any) -> Any:
        return self | RunnableLambda(lambda m: schema.model_validate_json(m.content))


def test_structured_output_falls_back_when_primary_fails() -> None:
    model = ChatModelWithFallbacks(
        runnable=_FakeChat(error="primary down"),
        fallbacks=[_FakeChat(reply='{"is_bug": false, "reason": "no repro"}')],
    )
    result = model.with_structured_output(Verdict).invoke("anything")
    assert result == Verdict(is_bug=False, reason="no repro")


def test_bound_tools_fall_back_when_primary_fails() -> None:
    model = ChatModelWithFallbacks(
        runnable=_FakeChat(error="primary down"),
        fallbacks=[_FakeChat(reply="used fallback")],
    ).bind_tools([read_file])
    assert model.runnable.kwargs["tools"] == ["read_file"]
    assert model.fallbacks[0].kwargs["tools"] == ["read_file"]
    assert model.invoke("anything").content == "used fallback"


async def test_async_invoke_falls_back_too() -> None:
    model = ChatModelWithFallbacks(
        runnable=_FakeChat(error="primary down"),
        fallbacks=[_FakeChat(reply="async fallback")],
    )
    assert (await model.ainvoke("anything")).content == "async fallback"
