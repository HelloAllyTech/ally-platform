"""WA-A §2: `send_source_file`, offered only when ally-be names it."""

from unittest.mock import patch

import pytest

from app.core.agent_runtime.tools import REGISTRY, allowed_tools
from app.core.agent_runtime.tools.send_source_file import DESCRIPTION
from tests.core.agent_runtime.conftest import make_bot
from tests.core.agent_runtime.steps import CONVERSATION, FakeLLM, reply, search
from tests.core.agent_runtime.test_gateway_tools import (  # noqa: F401
    FakeGateway,
    offered,
    run_with,
)
from tests.core.knowledge_agent.test_agent import CHUNK_A, passage

SEND = {
    "action": "send_source_file",
    "turn_type": "question",
    "send_source_file": {"title": "Registration form"},
    "language": "en",
}
AFTER = reply("answer", "Here is the registration form; it's on its way.")


def test_offered_only_when_named():
    assert "send_source_file" not in [t.name for t in allowed_tools(make_bot())]
    bot = make_bot(gateway_tools=["send_source_file"])
    assert [t.name for t in allowed_tools(bot)] == [
        "search_knowledge",
        "send_source_file",
    ]
    tool = REGISTRY["send_source_file"]
    assert (tool.kind, tool.risk, tool.ends_run) == ("gateway", "low", False)
    assert tool.description == DESCRIPTION
    assert list(tool.input_model.model_fields) == ["title"]


@pytest.mark.asyncio
async def test_names_the_document_to_ally_be_then_replies(
    run_with, chunk_service  # noqa: F811
):
    chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
    gateway = FakeGateway(
        {"ok": True, "result": {"document_id": "d1", "will_send": True}}
    )
    llm = FakeLLM(search("registration form"), SEND, AFTER, AFTER)
    with patch(f"{CONVERSATION}.generate_structured", llm):
        state = await run_with(
            "send me the form", gateway=gateway, gateway_tools=["send_source_file"]
        )
    assert offered(llm.calls[0]) == ["reply", "search_knowledge", "send_source_file"]
    assert gateway.calls == [
        {
            "name": "send_source_file",
            "run_id": "run-1",
            "step": 1,
            "input": {"title": "Registration form"},
        }
    ]
    assert {"tool": "send_source_file", "kind": "gateway", "ok": True} in state[
        "tool_calls"
    ]
