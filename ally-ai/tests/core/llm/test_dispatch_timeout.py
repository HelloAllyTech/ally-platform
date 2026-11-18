"""timeout: a per-call cap passed to the provider SDK, and shared with the fallback.

None (every caller but the agent step) sends nothing, so the SDK default stands.
"""

from unittest.mock import AsyncMock, patch

import pytest

from app.core.llm import dispatch
from tests.core.llm.test_dispatch import both_keys  # noqa: F401,E402 (fixture)
from tests.core.llm.test_dispatch import (
    Answer,
    anthropic_response,
    openai_client,
    sent_to_anthropic,
)

pytestmark = pytest.mark.asyncio


async def openai_kwargs(**kwargs):
    client = openai_client()
    with (
        patch.object(dispatch.settings.OPENAI, "API_KEY", "openai-key"),
        patch.object(dispatch, "_get_openai_client", return_value=client),
    ):
        await dispatch.generate_structured(
            schema=Answer, prompt="q", provider="openai", model="gpt-5-mini", **kwargs
        )
    return client.chat.completions.create.await_args.kwargs


async def test_openai_gets_the_timeout():
    assert (await openai_kwargs(timeout=12.5))["timeout"] == pytest.approx(
        12.5, abs=0.1
    )


async def test_openai_gets_none_by_default():
    assert "timeout" not in await openai_kwargs()


@pytest.mark.usefixtures("both_keys")
async def test_anthropic_gets_the_timeout():
    kwargs, _ = await sent_to_anthropic(
        "claude-sonnet-4-5", anthropic_response(tool_input={"answer": "a"}), timeout=8.0
    )
    assert kwargs["timeout"] == pytest.approx(8.0, abs=0.1)


async def test_the_fallback_gets_only_what_is_left():
    unavailable = type("APIStatusError", (Exception,), {"status_code": 503})("down")
    failing = AsyncMock(side_effect=unavailable)
    fallback = AsyncMock(return_value=Answer())
    with (
        patch.object(dispatch.settings.GEMINI, "API_KEY", "g"),
        patch.object(dispatch.settings.OPENAI, "API_KEY", "o"),
        patch.dict(dispatch._GENERATORS, {"gemini": failing, "openai": fallback}),
    ):
        await dispatch.generate_structured(
            schema=Answer, prompt="q", provider="gemini", timeout=10.0
        )
    first = failing.await_args.kwargs["timeout"]
    second = fallback.await_args.kwargs["timeout"]
    assert 9.0 < first <= 10.0
    assert 1.0 <= second <= first
