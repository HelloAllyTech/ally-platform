"""reasoning_effort: sent to OpenAI reasoning models only, and only when asked."""

from unittest.mock import patch

import pytest

from app.core.llm import dispatch
from tests.core.llm.test_dispatch import Answer, gemini_client, openai_client

pytestmark = pytest.mark.asyncio


async def openai_kwargs(model, **kwargs):
    client = openai_client()
    with (
        patch.object(dispatch.settings.OPENAI, "API_KEY", "openai-key"),
        patch.object(dispatch, "_get_openai_client", return_value=client),
    ):
        await dispatch.generate_structured(
            schema=Answer, prompt="q", provider="openai", model=model, **kwargs
        )
    return client.chat.completions.create.await_args.kwargs


@pytest.mark.parametrize("model", ["gpt-5-mini", "o3-mini"])
async def test_sent_to_a_reasoning_model(model):
    kwargs = await openai_kwargs(model, reasoning_effort="low")
    assert kwargs["reasoning_effort"] == "low"


async def test_not_sent_to_other_models():
    kwargs = await openai_kwargs("gpt-4o-mini", reasoning_effort="low")
    assert "reasoning_effort" not in kwargs


async def test_not_sent_unless_asked():
    assert "reasoning_effort" not in await openai_kwargs("gpt-5-mini")


async def test_ignored_by_other_providers():
    client = gemini_client()
    with (
        patch.object(dispatch.settings.GEMINI, "API_KEY", "gemini-key"),
        patch.object(dispatch, "_get_gemini_client", return_value=client),
    ):
        parsed, _ = await dispatch.generate_structured(
            schema=Answer, prompt="q", provider="gemini", reasoning_effort="low"
        )
    assert parsed.answer == "a"
