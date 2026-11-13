"""The crisis check reads the sender's earlier messages (chunk 15a).

"I mean it" carries no risk on its own; it is only readable against the disclosure
before it. These pin that the history reaches the prompt and that a signal quoted from
an earlier message comes back as the model gave it.
"""

from unittest.mock import AsyncMock, patch

import pytest

from app.core.knowledge_agent.agent import KnowledgeAgentService
from app.core.knowledge_agent.schemas import CrisisVerdict

AGENT = "app.core.knowledge_agent.agent"


@pytest.fixture
def agent():
    return KnowledgeAgentService(AsyncMock())


def stub_generate(verdict):
    return AsyncMock(return_value=(verdict, {"provider": "anthropic", "model": "m"}))


@pytest.mark.asyncio
async def test_the_senders_earlier_messages_reach_the_prompt(agent):
    gen = stub_generate(
        CrisisVerdict(is_crisis=True, signal="saved up my pills", confidence=0.9)
    )
    with (
        patch(f"{AGENT}.generate_structured", gen),
        patch(f"{AGENT}.build_crisis_prompt", return_value="p") as build,
        patch(f"{AGENT}.phi_logger") as phi,
    ):
        phi.log = AsyncMock()
        result = await agent.classify_crisis(
            "I mean it", history=["I've saved up my pills"]
        )

    assert build.call_args.kwargs["history"] == ["I've saved up my pills"]
    assert result["is_crisis"] is True
    assert result["signal"] == "saved up my pills"


@pytest.mark.asyncio
async def test_no_history_is_todays_call(agent):
    gen = stub_generate(CrisisVerdict(is_crisis=False, confidence=0.9))
    with (
        patch(f"{AGENT}.generate_structured", gen),
        patch(f"{AGENT}.build_crisis_prompt", return_value="p") as build,
    ):
        await agent.classify_crisis("hi")

    assert build.call_args.kwargs["history"] is None
