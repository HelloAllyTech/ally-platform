"""Ask Ally's agent: tools through the gateway, the pass and dollar limits, the
closing pass, streaming, the trace, and the endpoint."""

import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.core.ask_ally import agent as ask_agent
from app.core.ask_ally.middleware import TOOL_UNAVAILABLE
from app.core.ask_ally.tools import clean_topic
from app.core.config import settings
from app.core.debrief_graph.gateway import GatewayError
from tests.core.ask_ally.fakes import FakeGateway, ScriptedModel, ai, request

GUIDANCE = {
    "guidance_search": {
        "passages": [
            {"id": "c1", "title": "Risk guide", "text": "Ask about safety plainly."}
        ],
        "no_confident_match": False,
    }
}


async def no_distress(req):
    return False


async def collect(req, model, gateway, distress_reader=no_distress):
    with patch("app.core.ask_ally.middleware.emit_llm_usage") as usage:
        events = [
            e
            async for e in ask_agent.stream_reply(
                req,
                gateway=gateway,
                model_factory=lambda cfg: model,
                distress_reader=distress_reader,
            )
        ]
    return events, usage


@pytest.mark.asyncio
async def test_answers_in_one_pass_and_streams_the_words():
    model = ScriptedModel(script=[ai("Ask it plainly and calmly.")])
    gw = FakeGateway()
    events, usage = await collect(request(), model, gw)

    tokens = [e["text"] for e in events if e["type"] == "token"]
    assert "".join(tokens) == "Ask it plainly and calmly."
    assert len(tokens) > 1
    done = events[-1]
    assert done["type"] == "done"
    assert done["text"] == "Ask it plainly and calmly."
    assert done["trace"]["turns"] == 1
    assert done["trace"]["tools"] == []
    assert gw.closed
    # The history and the message reach the model; the system prompt leads.
    sent = model.calls[0]["messages"]
    assert sent[0].type == "system" and "REPLY PROMPT" in sent[0].content
    assert [m.content for m in sent[1:]] == [
        "earlier question",
        "earlier answer",
        "How should I ask about safety?",
    ]
    # One usage row per pass, under the reply's task label.
    ((args, kwargs),) = usage.call_args_list
    assert args[2] == "debrief_reply"
    assert args[3] == (1000, 100, 1100)
    assert kwargs["metadata"]["runId"] == "run-1"


@pytest.mark.asyncio
async def test_looks_up_guidance_through_the_gateway_and_keeps_what_it_found():
    model = ScriptedModel(
        script=[
            ai(
                calls=[
                    {
                        "name": "search_guidance",
                        "args": {"topic": "asking about suicide"},
                    }
                ]
            ),
            ai("The guidance says ask about safety plainly."),
        ]
    )
    gw = FakeGateway(GUIDANCE)
    events, _ = await collect(request(), model, gw)

    assert gw.calls == [
        {
            "tool": "guidance_search",
            "body": {
                "topics": [{"situation": "asking about suicide"}],
                "per_moment": 3,
            },
        }
    ]
    done = events[-1]
    assert done["tool_texts"] == ["Risk guide: Ask about safety plainly."]
    (call,) = done["trace"]["tools"]
    assert call["name"] == "search_guidance"
    assert call["topic"] == "asking about suicide"
    assert call["ok"] is True
    assert call["found"] == "1 passage(s): Risk guide"
    assert done["trace"]["turns"] == 2
    # The tool's answer went back to the model.
    assert "Risk guide" in model.calls[1]["messages"][-1].content


@pytest.mark.asyncio
async def test_history_and_live_detections_tools():
    model = ScriptedModel(
        script=[
            ai(
                calls=[
                    {"name": "get_learner_history", "id": "h"},
                    {"name": "get_live_detections", "id": "d"},
                ]
            ),
            ai("You keep improving."),
        ]
    )
    gw = FakeGateway(
        {
            "get_learner_history": {
                "points": [
                    {
                        "date": "2026-10-20",
                        "skill": "Exploring risk",
                        "point": "Ask directly",
                    }
                ]
            },
            "get_live_detections": {
                "detections": [
                    {"behaviour": "Asks about safety", "detected": True, "times": 2},
                    {"behaviour": "Summarises", "detected": False, "times": 0},
                ]
            },
        }
    )
    events, _ = await collect(request(), model, gw)
    done = events[-1]
    assert "2026-10-20 · Exploring risk: Ask directly" in done["tool_texts"]
    assert (
        "Asks about safety: detected (2×)\nSummarises: not detected"
        in done["tool_texts"]
    )
    # The two calls run in parallel: either may finish first.
    assert sorted(t["found"] for t in done["trace"]["tools"]) == [
        "1 earlier point(s)",
        "1 of 2 detected",
    ]


@pytest.mark.asyncio
async def test_a_failed_tool_tells_the_model_it_is_unavailable():
    model = ScriptedModel(
        script=[
            ai(calls=[{"name": "get_learner_history"}]),
            ai("From this session alone: ask directly."),
        ]
    )
    gw = FakeGateway(
        {
            "get_learner_history": GatewayError(
                "get_learner_history", None, "ReadTimeout"
            )
        }
    )
    events, _ = await collect(request(), model, gw)
    done = events[-1]
    assert done["type"] == "done"
    assert model.calls[1]["messages"][-1].content == TOOL_UNAVAILABLE
    (call,) = done["trace"]["tools"]
    assert call["ok"] is False
    assert call["found"].startswith("unavailable (")
    assert done["tool_texts"] == []


@pytest.mark.asyncio
async def test_at_most_four_passes_and_the_last_never_calls_a_tool():
    model = ScriptedModel(
        script=[
            ai(calls=[{"name": "get_live_detections", "id": f"x{i}"}]) for i in range(3)
        ]
        + [ai("Done looking; here is my answer.")]
    )
    events, _ = await collect(request(), model, FakeGateway())
    done = events[-1]
    assert done["trace"]["turns"] == 4
    assert done["trace"]["stoppedBy"] == "max_turns"
    assert [c["tool_choice"] for c in model.calls] == [None, None, None, "none"]
    assert done["text"] == "Done looking; here is my answer."


@pytest.mark.asyncio
async def test_closes_early_when_the_budget_cannot_stretch_to_another_tool_pass():
    # 60k input tokens at $0.3/M = $0.0185 a pass: a second tool pass and a
    # closing pass would pass $0.05, so the second pass is the closing one.
    big = (60_000, 200)
    model = ScriptedModel(
        script=[
            ai(calls=[{"name": "get_live_detections"}], tokens=big),
            ai("Short answer.", tokens=big),
        ]
    )
    events, _ = await collect(request(), model, FakeGateway())
    done = events[-1]
    assert [c["tool_choice"] for c in model.calls] == [None, "none"]
    assert done["trace"]["stoppedBy"] == "budget"
    assert done["trace"]["costUsd"] < 0.05


@pytest.mark.asyncio
async def test_one_pass_reply_honours_a_lower_release_limit():
    model = ScriptedModel(script=[ai("Only words.")])
    req = request(
        reply={
            "provider": "gemini",
            "model": "gemini-2.5-flash",
            "maxTokens": 300,
            "maxTurns": 1,
        }
    )
    await collect(req, model, FakeGateway())
    assert model.calls[0]["tool_choice"] == "none"


@pytest.mark.asyncio
async def test_retries_a_pass_that_failed_before_any_words():
    model = ScriptedModel(script=[RuntimeError("503 from provider"), ai("Second try.")])
    events, _ = await collect(request(), model, FakeGateway())
    assert events[-1]["type"] == "done"
    assert events[-1]["text"] == "Second try."


@pytest.mark.asyncio
async def test_reports_an_error_with_what_the_learner_already_saw():
    model = ScriptedModel(
        script=[
            ai("Let me check.", calls=[{"name": "get_live_detections"}]),
            RuntimeError("down"),
            RuntimeError("down"),
        ]
    )
    events, _ = await collect(request(), model, FakeGateway())
    last = events[-1]
    assert last["type"] == "error"
    assert last["text"] == "Let me check."
    assert last["trace"]["turns"] == 1


@pytest.mark.asyncio
async def test_an_unpriced_model_never_runs():
    model = ScriptedModel(script=[ai("never")])
    events, _ = await collect(request(prices={}), model, FakeGateway())
    assert events[-1]["type"] == "error"
    assert "no price" in events[-1]["error"]
    assert model.calls == []


@pytest.mark.asyncio
async def test_the_last_event_carries_the_distress_reading():
    seen = []

    async def distressed(req):
        seen.append((req.message, req.language, req.safety_system))
        return True

    model = ScriptedModel(script=[ai("I hear you.")])
    req = request(language="hi", safety_system="SAFETY PROMPT")
    events, _ = await collect(req, model, FakeGateway(), distressed)
    assert events[-1]["type"] == "done"
    assert events[-1]["distress"] is True
    assert seen == [("How should I ask about safety?", "hi", "SAFETY PROMPT")]
    # Only the last event carries it; the words never wait for it.
    assert all("distress" not in e for e in events[:-1])


@pytest.mark.asyncio
async def test_a_failed_reply_still_carries_the_distress_reading():
    async def distressed(req):
        return True

    model = ScriptedModel(script=[ai("never")])
    events, _ = await collect(request(prices={}), model, FakeGateway(), distressed)
    assert events[-1]["type"] == "error"
    assert events[-1]["distress"] is True


@pytest.mark.asyncio
async def test_a_failed_or_slow_distress_reading_is_false(monkeypatch):
    async def broken(req):
        raise RuntimeError("safety model down")

    events, _ = await collect(
        request(), ScriptedModel(script=[ai("Fine.")]), FakeGateway(), broken
    )
    assert events[-1]["distress"] is False

    import asyncio

    monkeypatch.setattr(ask_agent, "DISTRESS_TIMEOUT_S", 0.01)

    async def slow(req):
        await asyncio.sleep(1)
        return True

    events, _ = await collect(
        request(), ScriptedModel(script=[ai("Fine.")]), FakeGateway(), slow
    )
    assert events[-1]["type"] == "done"
    assert events[-1]["distress"] is False


@pytest.mark.asyncio
async def test_read_distress_reads_the_message_as_one_learner_turn(monkeypatch):
    from app.core.debrief.safety_reader import LearnerDistress, SafetyReading

    calls = []

    async def fake_read(transcript, language, system=None, **kw):
        calls.append((transcript, language, system, kw))
        found = [LearnerDistress(turn_index=1, quote="close to home")]
        return SafetyReading(learner_distress=found), "m"

    monkeypatch.setattr(ask_agent, "read_safety", fake_read)
    req = request(message="this is close to home", language="ta")
    assert await ask_agent.read_distress(req) is True
    ((transcript, language, system, kw),) = calls
    assert [(t.turn_index, t.role, t.text) for t in transcript] == [
        (1, "counselor", "this is close to home")
    ]
    assert language == "ta" and system is None
    assert kw == {"scenario_session_id": "sess-1"}

    async def none_read(*a, **kw):
        return None, "m"

    monkeypatch.setattr(ask_agent, "read_safety", none_read)
    with pytest.raises(ValueError):
        await ask_agent.read_distress(req)


def test_clean_topic():
    assert clean_topic("  open   questions ") == "open questions"
    assert clean_topic("") is None
    assert clean_topic(42) is None
    assert len(clean_topic("word " * 30).split(" ")) == 10


def test_budget_is_never_above_five_cents():
    req = request(
        reply={"provider": "gemini", "model": "m", "maxTokens": 10, "budgetUsd": 1}
    )
    assert req.reply.budget == 0.05


class TestEndpoint:
    def test_streams_ndjson_events(self, monkeypatch):
        from app.main import app

        async def fake_stream(req):
            yield {"type": "token", "text": "Hi"}
            yield {"type": "done", "text": "Hi", "tool_texts": [], "trace": {}}

        monkeypatch.setattr(ask_agent, "stream_reply", fake_stream)
        res = TestClient(app).post(
            "/api/v1/ask-ally/replies",
            headers={"x-api-key": settings.API.X_API_KEY},
            json=request().model_dump(),
        )
        assert res.status_code == 200
        lines = [json.loads(line) for line in res.text.splitlines() if line]
        assert [e["type"] for e in lines] == ["token", "done"]

    def test_needs_the_api_key(self):
        from app.main import app

        res = TestClient(app).post("/api/v1/ask-ally/replies", json={})
        assert res.status_code in (401, 403)
