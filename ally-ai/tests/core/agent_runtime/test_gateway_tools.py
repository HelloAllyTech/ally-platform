"""Gateway tools (chunk 3b): tools that ask ally-be to act, and `hand_over`.

The graph runs with FakeLLM and a fake gateway; the HTTP client is checked against
httpx's MockTransport. Without a gateway a run must be exactly today's.
"""

import json
import logging
from unittest.mock import patch

import httpx
import pytest

from app.core.agent_runtime import runner
from app.core.agent_runtime.budget import MAX_TOOL_STEPS
from app.core.agent_runtime.gateway import AgentGatewayClient
from app.core.agent_runtime.graph import get_run_state, run_agent
from app.core.agent_runtime.prompt import format_searches
from app.core.agent_runtime.tools import REGISTRY, allowed_tools
from app.core.agent_runtime.tools.hand_over import DESCRIPTION, HandOverInput
from app.core.config import settings
from app.schemas.agent_runtime import AgentRunRequest
from tests.core.agent_runtime.conftest import BODY, URL, make_bot
from tests.core.agent_runtime.steps import CONVERSATION, FakeLLM, nodes, reply, search
from tests.core.agent_runtime.test_stream import STREAM_URL, events, names
from tests.core.knowledge_agent.test_agent import CHUNK_A, passage

TOKEN = "secret-run-token-do-not-leak"
GATEWAY = {
    "url": "http://ally-be.test/api/v1/internal/agent",
    "token": TOKEN,
    "tools": ["hand_over"],
}
BRIEF_DESCRIPTION = (
    "Pass this chat to a person on the team. Use it when someone asks to talk to a "
    "person, when you can't help with what they need and the team can, or when "
    "they're unhappy with your answers. Never for someone at risk: that is handled "
    "before you. Write one line for the team about what they need."
)


def hand_over(summary="Wants a call back about a bill.", language="en"):
    return {
        "action": "hand_over",
        "turn_type": "question",
        "hand_over": {"summary": summary},
        "language": language,
    }


class FakeGateway:
    """Stands in for AgentGatewayClient: records calls, answers what it's told."""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes) or [
            {"ok": True, "result": {"needs_person": True}}
        ]
        self.calls = []

    async def call(self, name, *, run_id, step, input):
        self.calls.append(
            {"name": name, "run_id": run_id, "step": step, "input": input}
        )
        return self.outcomes.pop(0) if len(self.outcomes) > 1 else self.outcomes[0]

    async def aclose(self):
        pass


@pytest.fixture
def run_with(graph):
    async def _run(question="call me back", *, gateway=None, run_id="run-1", **bot):
        return await run_agent(
            graph,
            run_id=run_id,
            conversation_id="conv-1",
            chatbot_id="bot-1",
            question=question,
            history=[],
            bot=make_bot(**bot),
            gateway=gateway,
        )

    return _run


def offered(call):
    return call["schema"].model_json_schema()["$defs"]["AgentAction"]["enum"]


class TestWithoutAGateway:
    def test_the_request_and_bot_are_exactly_todays(self):
        request = AgentRunRequest(**BODY)
        assert request.gateway is None
        assert "gateway_tools" not in request.to_bot()

    def test_only_the_search_tools_are_offered(self):
        assert [t.name for t in allowed_tools(make_bot())] == ["search_knowledge"]
        assert [t.name for t in allowed_tools(make_bot(gateway_tools=[]))] == [
            "search_knowledge"
        ]

    @pytest.mark.asyncio
    async def test_the_prompt_and_schema_are_unchanged(self, run_with):
        llm = FakeLLM(reply("decline", "I can't help with that."))
        with patch(f"{CONVERSATION}.generate_structured", llm):
            await run_with()
        call = llm.calls[0]
        assert offered(call) == ["reply", "search_knowledge"]
        assert "hand_over" not in call["prompt"]
        assert "hand_over" not in json.dumps(call["schema"].model_json_schema())


class TestOffered:
    def test_only_when_named_and_registered(self):
        bot = make_bot(gateway_tools=["hand_over", "not_a_tool"])
        assert [t.name for t in allowed_tools(bot)] == ["search_knowledge", "hand_over"]

    def test_hand_over_is_built_as_the_brief_says(self):
        tool = REGISTRY["hand_over"]
        assert tool.description == BRIEF_DESCRIPTION == DESCRIPTION
        assert (tool.kind, tool.risk, tool.ends_run) == ("gateway", "medium", True)
        assert list(tool.input_model.model_fields) == ["summary"]

    def test_the_summary_is_one_line_clipped_to_300(self):
        assert HandOverInput(summary="a\nb   c").summary == "a b c"
        assert len(HandOverInput(summary="x" * 500).summary) == 300
        assert HandOverInput().summary == ""

    @pytest.mark.asyncio
    async def test_the_prompt_shows_it_and_the_schema_offers_it(self, run_with):
        llm = FakeLLM(reply("decline", "I can't help with that."))
        with patch(f"{CONVERSATION}.generate_structured", llm):
            await run_with(gateway=FakeGateway(), gateway_tools=["hand_over"])
        call = llm.calls[0]
        assert offered(call) == ["reply", "search_knowledge", "hand_over"]
        assert f"- `hand_over`: {BRIEF_DESCRIPTION} Input: `summary`: summary." in (
            call["prompt"]
        )


class TestHandOver:
    @pytest.mark.asyncio
    async def test_ends_the_run_with_handover(self, run_with):
        gateway = FakeGateway()
        llm = FakeLLM(hand_over())
        with patch(f"{CONVERSATION}.generate_structured", llm):
            state = await run_with(gateway=gateway, gateway_tools=["hand_over"])
        assert gateway.calls == [
            {
                "name": "hand_over",
                "run_id": "run-1",
                "step": 0,
                "input": {"summary": "Wants a call back about a bill."},
            }
        ]
        # No further model step and no check after it.
        assert nodes(state) == ["agent", "tool"]
        assert len(llm.calls) == 1
        assert state["trace"][-1]["summary"] == "hand_over: ok"
        result = state["result"]
        assert result["handover"] is True
        assert (result["intent"], result["answer"], result["citations"]) == (
            "decline",
            "",
            [],
        )
        assert state["tool_calls"] == [
            {"tool": "hand_over", "kind": "gateway", "ok": True}
        ]

    @pytest.mark.asyncio
    async def test_its_step_is_its_index_in_the_run(self, run_with, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        gateway = FakeGateway()
        llm = FakeLLM(search("bill"), hand_over())
        with patch(f"{CONVERSATION}.generate_structured", llm):
            state = await run_with(gateway=gateway, gateway_tools=["hand_over"])
        assert gateway.calls[0]["step"] == 1
        assert state["result"]["handover"] is True

    @pytest.mark.asyncio
    async def test_a_failure_is_read_by_the_agent_never_a_crash(self, run_with):
        gateway = FakeGateway({"ok": False, "error": "timeout"})
        llm = FakeLLM(
            hand_over(),
            reply("decline", "I couldn't reach the team just now."),
            reply("decline", "I couldn't reach the team just now."),
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            state = await run_with(gateway=gateway, gateway_tools=["hand_over"])
        assert state["trace"][1]["summary"] == "hand_over: error timeout"
        assert "- `hand_over`: failed (timeout), not done" in llm.calls[1]["prompt"]
        assert not state["result"].get("handover")
        assert state["tool_calls"][0] == {
            "tool": "hand_over",
            "kind": "gateway",
            "ok": False,
            "error": "timeout",
        }

    @pytest.mark.asyncio
    async def test_a_run_without_a_client_fails_the_call_not_the_run(self, run_with):
        llm = FakeLLM(
            hand_over(), reply("decline", "Sorry."), reply("decline", "Sorry.")
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            state = await run_with(gateway=None, gateway_tools=["hand_over"])
        assert state["tool_calls"][0]["error"] == "no_gateway"
        assert not state["result"].get("handover")


class TestBudget:
    @pytest.mark.asyncio
    async def test_nothing_new_ends_searching_but_not_gateway_tools(self, run_with):
        llm = FakeLLM(search("bill"), hand_over())
        with patch(f"{CONVERSATION}.generate_structured", llm):
            state = await run_with(gateway=FakeGateway(), gateway_tools=["hand_over"])
        # The search found nothing new: the next step offers hand_over, not search.
        assert offered(llm.calls[1]) == ["reply", "hand_over"]
        assert state["result"]["handover"] is True

    @pytest.mark.asyncio
    async def test_search_keeps_its_limit_and_statuses(self, run_with, chunk_service):
        chunk_service.search.side_effect = [
            [passage(CHUNK_A, 0.7)],
            [passage("chunk-b", 0.7)],
        ]
        llm = FakeLLM(
            search("a"), search("b"), reply(answer="A.", citations=[1]), reply()
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            await run_with(gateway=FakeGateway(), gateway_tools=["hand_over"])
        assert settings.AGENT_RUNTIME.MAX_TOOL_CALLS == 2
        # After two searches only hand_over is left to call.
        assert offered(llm.calls[2]) == ["reply", "hand_over"]

    @pytest.mark.asyncio
    async def test_at_most_four_tool_steps(self, run_with):
        failing = FakeGateway({"ok": False, "error": "http_503"})
        llm = FakeLLM(
            *[hand_over() for _ in range(MAX_TOOL_STEPS)],
            reply("decline", "Sorry."),
            reply("decline", "Sorry."),
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            state = await run_with(gateway=failing, gateway_tools=["hand_over"])
        assert [c["step"] for c in failing.calls] == [0, 1, 2, 3]
        assert offered(llm.calls[MAX_TOOL_STEPS]) == ["reply"]
        assert len(state["tool_calls"]) == MAX_TOOL_STEPS


class TestFormat:
    def test_gateway_records_read_as_done_or_not_done(self):
        assert format_searches(
            [
                {"tool": "search_knowledge", "query": "bill", "added": [1]},
                {"tool": "hand_over", "kind": "gateway", "ok": True},
                {
                    "tool": "hand_over",
                    "kind": "gateway",
                    "ok": False,
                    "error": "timeout",
                },
            ]
        ) == (
            '- search_knowledge: "bill" → added passages 1\n'
            "- `hand_over`: done\n"
            "- `hand_over`: failed (timeout), not done"
        )


def mock_client(handler):
    return AgentGatewayClient(
        GATEWAY["url"], TOKEN, transport=httpx.MockTransport(handler)
    )


class TestClient:
    @pytest.mark.asyncio
    async def test_sends_both_credentials_the_run_id_and_the_step(self):
        seen = {}

        def handler(request):
            seen["url"] = str(request.url)
            seen["headers"] = request.headers
            seen["body"] = json.loads(request.content)
            return httpx.Response(
                200,
                json={"ok": True, "result": {"needs_person": True}, "replayed": False},
            )

        client = mock_client(handler)
        out = await client.call(
            "hand_over", run_id="run-1", step=2, input={"summary": "x"}
        )
        await client.aclose()
        assert out == {"ok": True, "result": {"needs_person": True}}
        assert seen["url"] == f"{GATEWAY['url']}/tools/hand_over"
        assert seen["headers"]["x-api-key"] == settings.API.X_API_KEY
        assert seen["headers"]["authorization"] == f"Bearer {TOKEN}"
        assert seen["body"] == {"run_id": "run-1", "step": 2, "input": {"summary": "x"}}

    @pytest.mark.parametrize(
        "respond, code",
        [
            (
                lambda r: (_ for _ in ()).throw(httpx.ReadTimeout("slow", request=r)),
                "timeout",
            ),
            (
                lambda r: (_ for _ in ()).throw(httpx.ConnectError("down", request=r)),
                "network",
            ),
            (lambda r: httpx.Response(403, json={"message": "off"}), "http_403"),
            (lambda r: httpx.Response(503, text="busy"), "http_503"),
            (lambda r: httpx.Response(200, text="not json"), "bad_response"),
            (
                lambda r: httpx.Response(
                    200, json={"ok": False, "error": "no_conversation"}
                ),
                "no_conversation",
            ),
        ],
    )
    @pytest.mark.asyncio
    async def test_every_failure_is_a_result(self, respond, code):
        client = mock_client(respond)
        out = await client.call("hand_over", run_id="r", step=0, input={})
        await client.aclose()
        assert out == {"ok": False, "error": code}

    def test_uses_a_5s_timeout_and_never_shows_its_token(self):
        client = mock_client(lambda r: httpx.Response(200, json={"ok": True}))
        assert client._client.timeout.read == 5.0
        assert TOKEN not in repr(client)


@pytest.mark.usefixtures("enabled")
class TestEndpoint:
    def _patched(self, gateway):
        return patch.object(runner, "AgentGatewayClient", lambda url, token: gateway)

    def test_hand_over_returns_handover_true_and_no_token_anywhere(
        self, client, graph, caplog
    ):
        gateway = FakeGateway()
        body = {**BODY, "conversation_id": "conv-h", "gateway": GATEWAY}
        caplog.set_level(logging.DEBUG)
        with patch(f"{CONVERSATION}.generate_structured", FakeLLM(hand_over())):
            with self._patched(gateway):
                response = client.post(URL, json=body)
        assert response.status_code == 200
        data = response.json()
        assert data["handover"] is True
        assert data["answer"] == ""
        assert [s["summary"] for s in data["trace"]][-1] == "hand_over: ok"
        assert TOKEN not in response.text
        assert TOKEN not in caplog.text

    @pytest.mark.asyncio
    async def test_the_token_is_never_in_the_checkpointed_state(self, graph):
        payload = AgentRunRequest(
            **{**BODY, "conversation_id": "conv-t", "gateway": GATEWAY}
        )
        gateway = FakeGateway()
        with patch(f"{CONVERSATION}.generate_structured", FakeLLM(hand_over())):
            with self._patched(gateway):
                response = await runner.execute(graph, payload)
        stored = await get_run_state("conv-t", response.run_id, graph=graph)
        assert stored["bot"]["gateway_tools"] == ["hand_over"]
        assert TOKEN not in json.dumps(stored, default=str)
        history = [
            snap
            async for snap in graph.aget_state_history(
                {"configurable": {"thread_id": "conv-t"}}
            )
        ]
        assert TOKEN not in json.dumps(
            [(s.values, s.metadata, s.config) for s in history], default=str
        )
        assert TOKEN not in repr(payload)

    def test_a_response_without_handover_is_todays(self, client):
        with patch(
            f"{CONVERSATION}.generate_structured",
            FakeLLM(reply("decline", "No."), reply("decline", "No.")),
        ):
            data = client.post(URL, json=BODY).json()
        assert "handover" not in data

    def test_streaming_a_hand_over_sends_no_tokens_and_final_carries_it(self, client):
        body = {**BODY, "conversation_id": "conv-s", "gateway": GATEWAY}
        with patch(f"{CONVERSATION}.generate_structured", FakeLLM(hand_over())):
            with self._patched(FakeGateway()):
                evts = events(client.post(STREAM_URL, json=body))
        assert "token" not in names(evts)
        statuses = [data["code"] for name, data in evts if name == "status"]
        assert "searching" not in statuses and "found" not in statuses
        assert names(evts)[-1] == "final"
        assert evts[-1][1]["handover"] is True
