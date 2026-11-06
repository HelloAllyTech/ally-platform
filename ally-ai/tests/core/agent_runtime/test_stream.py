"""Tests for POST /api/v1/agent/run/stream and the runner it shares with /run.

The contract: run_started → status/step… → token… → final, where `final` is exactly
/run's body for the same input, no reply text before the check has passed it, an
`error {code}` instead of `final` when the run fails, and a disconnect that cancels
the run.
"""

import asyncio
import json
import types
from unittest.mock import patch

import pytest
from pydantic import BaseModel

from app.core.agent_runtime import runner
from app.core.agent_runtime.tools import REGISTRY
from app.core.agent_runtime.tools.base import Tool, ToolResult
from app.core.agent_runtime.trace import emit
from app.core.config import settings
from app.schemas.agent_runtime import AgentRunRequest
from tests.core.agent_runtime.conftest import BODY, URL
from tests.core.agent_runtime.steps import CONVERSATION, FakeLLM, chat, reply, search
from tests.core.knowledge_agent.test_agent import CHUNK_A, passage

STREAM_URL = f"{URL}/stream"


def events(response):
    """The (event, data) pairs of an SSE body; comment lines are skipped."""
    out = []
    for block in response.text.split("\n\n"):
        lines = [line for line in block.splitlines() if not line.startswith(":")]
        if not lines:
            continue
        name = lines[0].removeprefix("event: ")
        data = json.loads(lines[1].removeprefix("data: "))
        out.append((name, data))
    return out


def names(evts):
    return [name for name, _ in evts]


@pytest.fixture
def frozen_clock(monkeypatch):
    """Every step takes 0 ms, so two runs of the same input have equal traces."""
    clock = types.SimpleNamespace(monotonic=lambda: 0.0)
    monkeypatch.setattr("app.core.agent_runtime.trace.time", clock)
    monkeypatch.setattr("app.core.agent_runtime.nodes.tools.time", clock)


@pytest.mark.usefixtures("enabled")
class TestStream:
    def test_events_come_in_order_and_tokens_spell_the_answer(
        self, client, chunk_service
    ):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        answer = "Ally is a training platform for counsellors, built with care."
        llm = FakeLLM(search("What is Ally?"), reply(answer=answer, citations=[1]))
        with patch(f"{CONVERSATION}.generate_structured", llm):
            response = client.post(STREAM_URL, json=BODY)

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["x-accel-buffering"] == "no"
        evts = events(response)
        order = names(evts)
        assert order[0] == "run_started"
        assert order[-1] == "final"
        first_token = order.index("token")
        assert set(order[1:first_token]) <= {"status", "step"}
        assert set(order[first_token:-1]) == {"token"}
        assert "".join(d["text"] for n, d in evts if n == "token") == answer
        steps = [d["node"] for n, d in evts if n == "step"]
        assert steps == ["agent", "tool", "agent", "check"]
        codes = [d["code"] for n, d in evts if n == "status"]
        assert codes == [
            "thinking",
            "searching",
            "found",
            "thinking",
            "checking",
            "writing",
        ]
        searching = next(
            d for n, d in evts if n == "status" and d["code"] == "searching"
        )
        assert searching["detail"] == "What is Ally?"
        assert searching["label"] == "Looking up “What is Ally?”…"

    @pytest.mark.usefixtures("frozen_clock")
    def test_final_is_exactly_what_run_returns(self, client, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]

        def llm():
            return FakeLLM(search("What is Ally?"), reply(answer="A.", citations=[1]))

        body = {**BODY, "run_id": "run-same"}
        with patch(f"{CONVERSATION}.generate_structured", llm()):
            plain = client.post(URL, json={**body, "conversation_id": "c-plain"})
        with patch(f"{CONVERSATION}.generate_structured", llm()):
            streamed = client.post(
                STREAM_URL, json={**body, "conversation_id": "c-stream"}
            )

        final = events(streamed)[-1]
        assert final[0] == "final"
        assert final[1] == plain.json()

    def test_a_refused_draft_streams_only_the_rewrite(self, client, chunk_service):
        chunk_service.search.return_value = []
        rewrite = "I don't have anything on refunds — your admin would."
        llm = FakeLLM(
            reply("answer", "Refunds take 5 days."),
            search("refund policy"),
            reply("decline", rewrite),
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            evts = events(client.post(STREAM_URL, json=BODY))

        text = "".join(d["text"] for n, d in evts if n == "token")
        assert text == rewrite
        assert "Refunds take 5 days" not in json.dumps(evts[:-1])
        # No reply text before the last check step.
        order = names(evts)
        last_check = max(
            i for i, (n, d) in enumerate(evts) if n == "step" and d["node"] == "check"
        )
        assert order.index("token") > last_check
        codes = [d["code"] for n, d in evts if n == "status"]
        assert "rewriting" in codes

    def test_a_decline_without_text_streams_no_tokens(self, client):
        # Sent back once, then final with no text: ally-be sends its decline wording.
        llm = FakeLLM(search("q"), reply("decline", ""), reply("decline", ""))
        with patch(f"{CONVERSATION}.generate_structured", llm):
            evts = events(client.post(STREAM_URL, json=BODY))
        assert "token" not in names(evts)
        assert names(evts)[-1] == "final"

    def test_a_model_failure_is_an_upstream_error_without_text(self, client):
        from app.exceptions.custom_exceptions import LLMInvocationFailedException

        async def boom(**_):
            raise LLMInvocationFailedException("openai said: What is Ally?")

        with patch(f"{CONVERSATION}.generate_structured", boom):
            evts = events(client.post(STREAM_URL, json=BODY))
        assert evts[-1] == ("error", {"code": "upstream"})
        assert "What is Ally" not in json.dumps(evts[-1])

    def test_off_is_404(self, client, monkeypatch):
        monkeypatch.setattr(settings.AGENT_RUNTIME, "ENABLED", False)
        assert client.post(STREAM_URL, json=BODY).status_code == 404


class SlowLLM:
    """A model call that never finishes on its own; records whether it was cancelled."""

    def __init__(self):
        self.calls = 0
        self.cancelled = False

    async def __call__(self, **_):
        self.calls += 1
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            self.cancelled = True
            raise


@pytest.mark.usefixtures("enabled")
class TestTimeout:
    def test_run_past_the_cap_is_504(self, client, monkeypatch):
        monkeypatch.setattr(settings.AGENT_RUNTIME, "RUN_TIMEOUT_SECONDS", 0.05)
        llm = SlowLLM()
        with patch(f"{CONVERSATION}.generate_structured", llm):
            response = client.post(URL, json=BODY)
        assert response.status_code == 504
        assert response.json()["detail"] == "The agent run timed out"
        assert llm.cancelled

    def test_stream_past_the_cap_sends_error_timeout(self, client, monkeypatch):
        monkeypatch.setattr(settings.AGENT_RUNTIME, "RUN_TIMEOUT_SECONDS", 0.05)
        with patch(f"{CONVERSATION}.generate_structured", SlowLLM()):
            evts = events(client.post(STREAM_URL, json=BODY))
        assert names(evts)[0] == "run_started"
        assert evts[-1] == ("error", {"code": "timeout"})

    @pytest.mark.asyncio
    async def test_the_agent_step_timeout_is_within_the_cap(self, run):
        llm = FakeLLM(chat())
        with patch(f"{CONVERSATION}.generate_structured", llm):
            await run("hi")
        timeout = llm.calls[0]["timeout"]
        assert 1.0 <= timeout <= settings.AGENT_RUNTIME.RUN_TIMEOUT_SECONDS


class TestDisconnect:
    @pytest.mark.asyncio
    async def test_closing_the_stream_cancels_the_run(self, graph):
        llm = SlowLLM()
        payload = AgentRunRequest(**BODY)
        with patch(f"{CONVERSATION}.generate_structured", llm):
            gen = runner.stream(graph, payload)
            first = await gen.__anext__()
            assert first.startswith("event: run_started")
            await asyncio.sleep(0.05)  # the run reaches its model call
            assert llm.calls == 1
            await gen.aclose()
            await asyncio.sleep(0)
        assert llm.cancelled
        assert llm.calls == 1


class LookUpInput(BaseModel):
    query: str


async def look_up(args, ctx):
    return ToolResult(summary="look_up: 1 thing", record={"tool": "look_up"})


@pytest.mark.usefixtures("enabled")
class TestToolsStreamWithoutCode:
    def test_a_new_tool_streams_its_status_and_step(self, client, monkeypatch):
        tool = Tool(
            name="look_up",
            description="Look something up.",
            input_model=LookUpInput,
            risk="low",
            handler=look_up,
        )
        monkeypatch.setitem(REGISTRY, "look_up", tool)
        llm = FakeLLM(
            {
                "action": "look_up",
                "turn_type": "question",
                "look_up": {"query": "opening hours"},
                "language": "en",
            },
            chat("Happy to help."),
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            evts = events(client.post(STREAM_URL, json=BODY))

        statuses = [(d["code"], d.get("detail")) for n, d in evts if n == "status"]
        assert ("searching", "opening hours") in statuses
        assert ("found", "nothing new") in statuses
        tool_steps = [d for n, d in evts if n == "step" and d["node"] == "tool"]
        assert [s["summary"] for s in tool_steps] == ["look_up: 1 thing"]


class TestHelpers:
    def test_emit_outside_a_run_does_nothing(self):
        emit("status", {"code": "thinking"})  # no graph, no error

    @pytest.mark.parametrize(
        "text",
        ["", "One.", "Two words here and more words follow.", "  lead\nand trail  "],
    )
    def test_chunks_join_back_to_the_text(self, text):
        assert "".join(runner.chunk_reply(text)) == text

    def test_chunks_are_a_few_words(self):
        assert runner.chunk_reply("a b c d e f g") == ["a b c", " d e f", " g"]
