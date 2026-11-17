"""Guidance as one mechanism: the lookup's searches run concurrently, the agent
is the fixed step when the lookup is off, and the run records which produced
what (`workspace.guidanceMode` / `guidanceGiven` / `guidanceTimings`)."""

import asyncio
import time

import pytest

from app.core.debrief_graph.orchestrator import offered_agents
from tests.core.debrief_graph.fakes import FakeGateway, FakeSteps, make_ctx, run
from tests.core.debrief_graph.test_guidance_agent import (  # noqa: F401
    agent_bundle,
    call,
    closed_circuits,
    gateway,
    orun,
    records,
    use,
    writer_bodies,
)

pytestmark = pytest.mark.asyncio


class SlowGateway(FakeGateway):
    """guidance_search sleeps; the first moment is the slowest."""

    def __init__(self, delay: float = 0.3) -> None:
        super().__init__()
        self.delay = delay
        self.answers = {}

    async def call(self, tool, body):
        if tool == "guidance_search":
            first = body["topics"][0]["situation"] == self._first
            await asyncio.sleep(self.delay * (1.5 if first else 1))
        return await super().call(tool, body)


async def test_lookup_searches_run_concurrently_in_moment_order():
    gw = SlowGateway()
    probe = FakeGateway()
    base = await run(FakeSteps(), probe)
    moments = [
        s for s in base["steps"] if s["step"] == "guidance_lookup"
    ][0]["citations"]
    gw._first = probe.tools("guidance_search")[0]["topics"][0]["situation"]
    t0 = time.perf_counter()
    result = await run(FakeSteps(), gw)
    took = time.perf_counter() - t0
    assert len(gw.tools("guidance_search")) == 2
    # Two sequential calls would take 0.75 s; concurrently ~0.45 s.
    assert took < 0.7
    rec = [s for s in result["steps"] if s["step"] == "guidance_lookup"][0]
    assert rec["citations"] == moments  # same results, same (moment) order
    assert rec["note"] == "2 lookup(s), 2 passage(s)"
    assert result["workspace"]["passages"] == base["workspace"]["passages"]


async def test_lookup_on_the_planner_may_still_skip_the_agent(gateway, monkeypatch):
    chat = use(monkeypatch, [[]])
    ctx = make_ctx(FakeSteps(), gateway, bundle=agent_bundle(orchestrated=True))
    offered = offered_agents({}, ctx, {"analyst": True})
    assert "guidance_agent" in offered and "guidance_lookup" in offered
    result, _ = await orun(gateway, ["guidance_lookup"])
    assert records(result) == [] and chat.seen == []
    ws = result["workspace"]
    assert ws["guidanceMode"] == "lookup"
    assert ws["guidanceGiven"] == [{"code": "DG-1", "via": "lookup"}]
    assert ws["guidanceTimings"]["agentMs"] is None
    assert ws["guidanceTimings"]["lookupMs"] is not None


async def test_lookup_off_the_agent_is_the_mechanism_on_the_orchestrated_path(
    gateway, monkeypatch
):
    use(monkeypatch, [[call("get_guidance", {"codes": ["DG-LEVEL"]}, "1")], []])
    b = agent_bundle(orchestrated=True, guidancePassagesPerMoment=0)
    ctx = make_ctx(FakeSteps(), gateway, bundle=b)
    offered = offered_agents({}, ctx, {"analyst": True})
    assert "guidance_agent" not in offered and "guidance_lookup" not in offered
    # The planner chooses nothing about guidance, yet the agent runs.
    result, steps = await orun(gateway, ["language_specialist"], b)
    assert result["status"] == "published"
    assert len(records(result)) == 1
    assert gateway.tools("guidance_search") == []
    body = writer_bodies(steps, "writer")[0]
    assert body["passages"] == [{"title": "Title DG-LEVEL", "text": "Text DG-LEVEL"}]
    ws = result["workspace"]
    assert ws["guidanceMode"] == "agent"
    assert ws["guidanceGiven"] == [{"code": "DG-LEVEL", "via": "agent_fetch"}]
    assert ws["guidanceTimings"]["lookupMs"] is None
    assert ws["guidanceTimings"]["agentMs"] is not None
    assert ws["guidanceCalls"] and ws["guidanceIndexVersion"] == 7


async def test_lookup_off_still_needs_a_model_and_a_tool(gateway, monkeypatch):
    chat = use(monkeypatch, [[]])
    b = agent_bundle(orchestrated=True, guidancePassagesPerMoment=0, max_calls=0)
    result, _ = await orun(gateway, ["language_specialist"], b)
    assert records(result) == [] and chat.seen == []
    assert result["workspace"]["guidanceMode"] == "none"
    assert result["workspace"]["guidanceGiven"] == []


async def test_both_mechanisms_are_recorded_deduped_by_code(gateway, monkeypatch):
    use(
        monkeypatch,
        [[call("get_guidance", {"codes": ["DG-LEVEL", "DG-1"]}, "1")], []],
    )
    result, _ = await orun(gateway, ["guidance_lookup", "guidance_agent"])
    ws = result["workspace"]
    assert ws["guidanceMode"] == "both"
    assert ws["guidanceGiven"] == [
        {"code": "DG-1", "via": "lookup"},
        {"code": "DG-LEVEL", "via": "agent_fetch"},
    ]
    assert set(ws["guidanceTimings"]) == {"lookupMs", "agentMs"}
    assert None not in ws["guidanceTimings"].values()


async def test_writer_never_sees_code_or_via(gateway, monkeypatch):
    use(monkeypatch, [[]])
    steps = FakeSteps()
    await run(steps, gateway, bundle=agent_bundle())
    for p in writer_bodies(steps, "writer")[0]["passages"]:
        assert set(p) == {"title", "text"}
