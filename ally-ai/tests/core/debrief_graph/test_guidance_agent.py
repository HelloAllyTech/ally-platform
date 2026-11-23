"""The guidance agent: a bounded tool-calling loop between guidance_lookup and
the Writer. No live model: a fake chat model scripts the tool calls."""

import json
from typing import Any, Dict, List

import pytest
from langchain_core.messages import AIMessage

from app.core.debrief_graph import circuit
from app.core.debrief_graph import guidance_toolbox as toolbox
from app.core.debrief_graph.graph import build_graph
from tests.core.debrief_graph.fakes import (
    PRICES,
    FakeGateway,
    FakeSteps,
    bundle,
    evaluation,
    make_ctx,
    new_graph,
    orchestrated_bundle,
    run,
    step,
)

pytestmark = pytest.mark.asyncio

INDEX = {
    "version": 7,
    "entries": [
        {
            "code": "DG-LEVEL",
            "kind": "guide",
            "level": ["beginner"],
            "title": "Beginner level guide",
            "hint": "how to coach a lay helper",
        },
        {
            "code": "DG-ORG",
            "kind": "organisation_protocol",
            "level": [],
            "title": "Suicide protocol",
            "hint": "what to do",
        },
    ],
}


def call(name: str, args: Dict[str, Any], cid: str) -> Dict[str, Any]:
    return {"name": name, "args": args, "id": cid}


class FakeChat:
    """A scripted chat model: each `ainvoke` pops the next AIMessage."""

    def __init__(self, script: List[List[Dict[str, Any]]]) -> None:
        self.script = list(script)
        self.seen: List[List[Any]] = []
        self.bound: List[Any] = []

    def bind_tools(self, tools):
        self.bound = tools
        return self

    async def ainvoke(self, messages):
        self.seen.append(list(messages))
        calls = self.script.pop(0) if self.script else []
        return AIMessage(content="Enough." if not calls else "", tool_calls=calls)


@pytest.fixture(autouse=True)
def closed_circuits():
    circuit.reset_model_circuits()
    yield
    circuit.reset_model_circuits()


@pytest.fixture
def gateway():
    gw = FakeGateway()

    def fetch(body):
        return {
            "passages": [
                {
                    "id": f"id-{c}",
                    "code": c,
                    "title": f"Title {c}",
                    "text": f"Text {c}",
                }
                for c in body["codes"]
            ]
        }

    gw.answers["guidance_index"] = INDEX
    gw.answers["guidance_fetch"] = fetch
    return gw


def agent_bundle(max_calls=3, orchestrated=False, **settings):
    """Gated by settings only: no recipe step; the model is `models.guidanceAgent`."""
    b = orchestrated_bundle() if orchestrated else bundle()
    b["settings"]["guidanceAgentMaxCalls"] = max_calls
    b["settings"].update(settings)
    b["models"] = {"guidanceAgent": "agent-m"}
    return b


def use(monkeypatch, script):
    chat = FakeChat(script)
    monkeypatch.setattr(toolbox, "build_chat_model", lambda model: chat)
    return chat


async def go(gateway, **kw):
    kw.setdefault("bundle", agent_bundle())
    result = await run(FakeSteps(), gateway, **kw)
    return result


def record(result):
    return next((s for s in result["steps"] if s["step"] == "guidance_agent"), None)


async def test_off_by_default_records_nothing(gateway, monkeypatch):
    use(monkeypatch, [])
    result = await go(gateway, bundle=agent_bundle(max_calls=0))
    assert record(result) is None
    assert gateway.tools("guidance_index") == []
    result = await run(FakeSteps(), gateway)  # no setting at all
    assert record(result) is None and result["status"] == "published"


async def test_on_by_settings_alone_and_the_model_comes_from_the_bundle(
    gateway, monkeypatch
):
    asked = []
    chat = FakeChat([[]])
    monkeypatch.setattr(
        toolbox, "build_chat_model", lambda m: (asked.append(m), chat)[1]
    )
    result = await go(gateway)  # no recipe step, no release agent entry
    assert record(result)["status"] == "done" and asked == ["agent-m"]


async def test_no_model_in_the_release_means_off_with_a_recorded_reason(
    gateway, monkeypatch
):
    from app.core.debrief_graph.orchestrator import offered_agents

    chat = use(monkeypatch, [[]])
    b = agent_bundle()
    del b["models"]
    ctx = make_ctx(FakeSteps(), gateway, bundle=b)
    assert toolbox.agent_model(ctx, {"recipe_key": "standard"}) is None
    result = await go(gateway, bundle=b)
    rec = record(result)
    assert (rec["status"], rec["note"]) == ("skipped", "no model set in this release")
    assert chat.seen == [] and gateway.tools("guidance_index") == []
    # Nor is the planner offered it.
    ob = agent_bundle(orchestrated=True)
    del ob["models"]
    for e in ob["orchestrator"]["agents"]:
        e.pop("model", None)
    octx = make_ctx(FakeSteps(), gateway, bundle=ob)
    assert "guidance_agent" not in offered_agents({}, octx, {"analyst": True})


async def test_the_model_can_come_from_the_recipe_step_or_the_agent_entry(
    gateway, monkeypatch
):
    b = agent_bundle()
    del b["models"]
    b["recipes"]["standard"]["steps"] = b["recipes"]["standard"]["steps"] + [
        step("guidance_agent", "recipe-m", None, "G")
    ]
    ctx = make_ctx(FakeSteps(), gateway, bundle=b)
    assert toolbox.agent_model(ctx, {"recipe_key": "standard"}) == "recipe-m"
    assert toolbox.agent_model(ctx) == "recipe-m"
    ob = agent_bundle(orchestrated=True)
    del ob["models"]
    ob["orchestrator"]["agents"] = [
        {"id": "guidance_agent", "version": 1, "model": "entry-m"}
    ]
    octx = make_ctx(FakeSteps(), gateway, bundle=ob)
    assert toolbox.agent_model(octx, {"recipe_key": "standard"}) == "entry-m"


async def test_off_with_only_the_index_tool(gateway, monkeypatch):
    chat = use(monkeypatch, [[]])
    b = agent_bundle(guidanceTools={"guidance_agent": ["guidance_index"]})
    result = await go(gateway, bundle=b)
    assert record(result) is None and chat.seen == []
    assert gateway.tools("guidance_index") == []


async def test_a_two_call_run_end_to_end(gateway, monkeypatch):
    chat = use(
        monkeypatch,
        [
            [call("get_guidance", {"codes": ["DG-LEVEL", "DG-ORG"]}, "1")],
            [call("search_guidance", {"situation": "a hopeless client"}, "2")],
            [],
        ],
    )
    steps = FakeSteps()
    result = await run(steps, gateway, bundle=agent_bundle())
    rec = record(result)
    assert result["status"] == "published"
    assert rec["status"] == "done"
    assert rec["note"] == "2 call(s), 3 passage(s) added"
    assert [c["code"] for c in rec["citations"]] == ["DG-LEVEL", "DG-ORG", "DG-1"]
    # The exact gateway calls, each tagged with the step.
    assert gateway.tools("guidance_index") == [{"step": "guidance_agent"}]
    assert gateway.tools("guidance_fetch") == [
        {"codes": ["DG-LEVEL", "DG-ORG"], "step": "guidance_agent"}
    ]
    searches = [
        b for b in gateway.tools("guidance_search") if b.get("step") == "guidance_agent"
    ]
    assert searches == [
        {
            "topics": [{"situation": "a hopeless client"}],
            "per_moment": 2,
            "step": "guidance_agent",
        }
    ]
    # The Writer reads baseline first, then the fetched passages.
    writer = [c for c in steps.calls if c["path"] == "writer"][0]["body"]
    titles = [p["title"] for p in writer["passages"]]
    assert titles[:2] == ["Guide on client signals hopelessness", titles[1]]
    assert titles[-3:] == [
        "Title DG-LEVEL",
        "Title DG-ORG",
        "Guide on a hopeless client",
    ]
    # Observability for analytics.
    ws = result["workspace"]
    assert ws["guidanceIndexVersion"] == 7
    assert [(c["tool"], c["ok"], c["order"]) for c in ws["guidanceCalls"]] == [
        ("guidance_index", True, 1),
        ("guidance_fetch", True, 2),
        ("guidance_search", True, 3),
    ]
    assert ws["guidanceCalls"][1]["args"] == ["DG-LEVEL", "DG-ORG"]
    assert ws["guidanceCalls"][1]["codes_returned"] == ["DG-LEVEL", "DG-ORG"]
    assert ws["guidanceCalls"][2]["args"] == "a hopeless client"
    assert all("ms" in c and c["step"] == "guidance_agent" for c in ws["guidanceCalls"])
    assert chat.script == []


async def test_the_model_sees_only_the_index_and_analyst_summaries(
    gateway, monkeypatch
):
    chat = use(monkeypatch, [[]])
    result = await go(gateway)
    system = chat.seen[0][0].content
    assert "DG-ORG | organisation_protocol" in system
    assert "client signals hopelessness" in system  # the Analyst's summary
    assert "I don't see the point anymore" not in json.dumps(
        [m.content for m in chat.seen[0]]
    )  # never a learner line
    assert "beginner" in system and "3" in system
    assert [t.name for t in chat.bound] == ["search_guidance", "get_guidance"]
    assert record(result)["note"] == "0 call(s), 0 passage(s) added"


async def test_the_call_cap_is_hard(gateway, monkeypatch):
    chat = use(
        monkeypatch,
        [[call("search_guidance", {"situation": f"s{i}"}, str(i)) for i in range(5)]]
        * 5,
    )
    result = await go(gateway, bundle=agent_bundle(max_calls=2))
    assert len(gateway.tools("guidance_search")) == 2 + 2  # + the lookup's own
    tool_calls = [
        c for c in result["workspace"]["guidanceCalls"] if c["tool"] != "guidance_index"
    ]
    assert len(tool_calls) == 2
    assert len(chat.seen) == 1  # no further model pass once the cap is spent


async def test_fetch_takes_five_codes_and_the_total_is_six(gateway, monkeypatch):
    codes = [f"C{i}" for i in range(9)]
    use(
        monkeypatch,
        [
            [call("get_guidance", {"codes": codes + codes}, "1")],
            [call("get_guidance", {"codes": ["D1", "D2", "D3", "D4", "D5"]}, "2")],
        ],
    )
    result = await go(gateway, bundle=agent_bundle(max_calls=2))
    assert gateway.tools("guidance_fetch")[0]["codes"] == codes[:5]
    rec = record(result)
    assert len(rec["citations"]) == 6  # 5, then only 1 more
    assert rec["note"] == "2 call(s), 6 passage(s) added"


async def test_passages_dedupe_with_the_baseline(gateway, monkeypatch):
    gateway.answers["guidance_fetch"] = lambda b: {
        "passages": [
            {"id": "g-client signals hopelessness", "code": "DG-1", "title": "x"},
            {"id": "new", "code": "DG-N", "title": "New", "text": "t"},
            {"id": "new", "code": "DG-N", "title": "New", "text": "t"},
        ]
    }
    use(monkeypatch, [[call("get_guidance", {"codes": ["DG-N"]}, "1")], []])
    result = await go(gateway)
    assert [c["code"] for c in record(result)["citations"]] == ["DG-N"]


async def test_unavailable_index_and_gateway_errors_never_fail_the_run(
    gateway, monkeypatch
):
    gateway.answers["guidance_index"] = {"unavailable": True, "entries": []}
    gateway.raise_on["guidance_fetch"] = lambda: RuntimeError("boom")
    use(
        monkeypatch,
        [[call("get_guidance", {"codes": ["A"]}, "1")], [call("nope", {}, "2")], []],
    )
    result = await go(gateway)
    assert result["status"] == "published"
    ws = result["workspace"]
    assert [c["ok"] for c in ws["guidanceCalls"]] == [False, False]  # index, fetch
    assert record(result)["note"] == "1 call(s), 0 passage(s) added"


async def test_a_model_failure_is_recorded_and_the_run_goes_on(gateway, monkeypatch):
    class Boom(FakeChat):
        async def ainvoke(self, messages):
            raise RuntimeError("model down")

    monkeypatch.setattr(toolbox, "build_chat_model", lambda m: Boom([]))
    result = await go(gateway)
    assert result["status"] == "published"
    assert record(result)["status"] == "failed"


async def test_guidance_tools_setting_limits_the_tools(gateway, monkeypatch):
    chat = use(monkeypatch, [[]])
    b = agent_bundle(guidanceTools={"guidance_agent": ["guidance_search"]})
    await go(gateway, bundle=b)
    assert gateway.tools("guidance_index") == []
    assert [t.name for t in chat.bound] == ["search_guidance"]
    # No tool left for the step: it is off.
    chat = use(monkeypatch, [[]])
    gateway.calls.clear()
    b = agent_bundle(guidanceTools={"guidance_agent": []})
    result = await go(gateway, bundle=b)
    assert record(result) is None and chat.seen == []


async def test_skipped_when_the_deadline_is_near(gateway, monkeypatch):
    use(monkeypatch, [[]])
    result = await go(gateway, bundle=agent_bundle(deadlineMs=1, riskDeadlineMs=1))
    rec = record(result)
    assert (rec["status"], rec["note"]) == ("skipped", "deadline")


async def test_skipped_when_the_budget_is_short(gateway, monkeypatch):
    chat = use(monkeypatch, [[]])
    prices = {**PRICES, "agent-m": {"input_per_m": 1e6, "output_per_m": 1e6}}
    result = await go(gateway, prices=prices)
    rec = record(result)
    assert (rec["status"], rec["note"]) == ("skipped", "budget")
    assert chat.seen == [] and result["status"] == "published"


def plan(*agents):
    return {
        "plan": {
            "actions": [
                {"agent": a, "why": f"{a} fits", "focus_turns": []} for a in agents
            ],
            "considered": [],
        },
        "reasoning": "From the profile.",
    }


async def orun(gateway, planned, bundle_=None, **kw):
    steps = FakeSteps()
    steps.answers["planner"] = plan(*planned)
    result = await run(
        steps, gateway, bundle=bundle_ or agent_bundle(orchestrated=True), **kw
    )
    return result, steps


def records(result):
    return [s for s in result["steps"] if s["step"] == "guidance_agent"]


async def test_the_planner_can_choose_it_and_it_runs_once(gateway, monkeypatch):
    use(monkeypatch, [[call("get_guidance", {"codes": ["DG-LEVEL"]}, "1")], []])
    result, _ = await orun(gateway, ["guidance_agent"])
    assert result["status"] == "published"
    assert [r["note"] for r in records(result)] == ["1 call(s), 1 passage(s) added"]
    assert len(gateway.tools("guidance_fetch")) == 1  # no second run at the hop
    assert len(gateway.tools("guidance_index")) == 1


async def test_a_skip_by_the_planner_is_honoured(gateway, monkeypatch):
    chat = use(monkeypatch, [[]])
    result, _ = await orun(gateway, ["language_specialist"])
    assert records(result) == [] and chat.seen == []
    assert gateway.tools("guidance_index") == []


async def test_the_planner_is_offered_it_only_with_cap_and_tools(gateway, monkeypatch):
    from app.core.debrief_graph.orchestrator import offered_agents

    def offered(b):
        ctx = make_ctx(FakeSteps(), gateway, bundle=b)
        return "guidance_agent" in offered_agents({}, ctx, {"analyst": True})

    assert offered(agent_bundle(orchestrated=True))
    assert not offered(agent_bundle(max_calls=0, orchestrated=True))
    assert not offered(
        agent_bundle(orchestrated=True, guidanceTools={"guidance_agent": []})
    )
    assert not offered(
        agent_bundle(
            orchestrated=True, guidanceTools={"guidance_agent": ["guidance_index"]}
        )
    )
    # Not listed by the release: not offered either.
    listed = orchestrated_bundle(agents=["analyst", "guidance_lookup"])
    listed["settings"]["guidanceAgentMaxCalls"] = 3
    assert not offered(listed)


async def test_not_listed_by_the_release_the_fixed_hop_still_runs_it(
    gateway, monkeypatch
):
    use(monkeypatch, [[call("get_guidance", {"codes": ["DG-LEVEL"]}, "1")], []])
    b = agent_bundle(orchestrated=True)
    b["orchestrator"]["agents"] = [
        e for e in b["orchestrator"]["agents"] if e["id"] != "guidance_agent"
    ]
    result, _ = await orun(gateway, ["guidance_lookup"], b)
    assert [r["note"] for r in records(result)] == ["1 call(s), 1 passage(s) added"]


async def test_graph_topology_has_the_node_on_both_paths():
    graph = build_graph(None).get_graph()
    edges = {(e.source, e.target) for e in graph.edges}
    assert ("guidance_lookup", "guidance_agent") in edges
    assert ("guidance_agent", "prepare_writer") in edges
    assert "guidance_agent" in graph.nodes
    assert new_graph() is not None


# --- the reusable toolbox and the Writer / Reviser phases ------------------------


async def test_the_tools_are_real_langchain_tools(gateway):
    from langchain_core.tools import BaseTool

    box = toolbox.GuidanceCalls(
        step="writer",
        gateway=gateway,
        enabled=["guidance_search", "guidance_fetch"],
        max_calls=1,
        clock=lambda: 0.0,
    )
    tools = toolbox.make_tools(box)
    assert all(isinstance(t, BaseTool) for t in tools)
    assert [t.name for t in tools] == ["search_guidance", "get_guidance"]
    assert set(tools[1].args) == {"codes"}
    out = await tools[1].ainvoke({"codes": ["A", "A", "B", "C", "D", "E", "F"]})
    assert "Title A" in out
    assert gateway.tools("guidance_fetch") == [
        {"codes": ["A", "B", "C", "D", "E"], "step": "writer"}
    ]
    # The second call is over the cap: refused, never sent.
    assert await tools[0].ainvoke({"situation": "x"}) == toolbox.LIMIT_TEXT
    assert gateway.tools("guidance_search") == []


async def test_the_loop_ends_at_the_cap_in_the_routing(gateway):
    box = toolbox.GuidanceCalls(
        step="x",
        gateway=gateway,
        enabled=["guidance_search"],
        max_calls=2,
        clock=lambda: 0.0,
    )
    chat = FakeChat(
        [[call("search_guidance", {"situation": "s"}, str(i))] for i in range(9)]
    )
    loop = toolbox.build_tool_loop(
        model=chat,
        tools=toolbox.make_tools(box),
        max_calls=2,
        calls_used=lambda: box.used,
        keep_going=lambda spent: True,
        price=lambda usage: 0.0,
    )
    out = await loop.ainvoke({"messages": [("user", "go")], "calls": 0, "spent": 0.0})
    assert box.used == 2 and out["calls"] == 2 and len(chat.seen) == 2


def writer_bodies(steps, path):
    return [c["body"] for c in steps.calls if c["path"] == path]


async def test_writer_and_reviser_requests_are_identical_when_their_lists_are_empty(
    gateway, monkeypatch
):
    chat = use(monkeypatch, [])
    low = FakeCheckBundle = None  # noqa: F841 - (kept for readability)
    base = FakeSteps()
    base.answers["evaluator"] = lambda body: {"evaluation": evaluation(3)}
    await run(base, FakeGateway(), bundle=bundle())
    steps = FakeSteps()
    steps.answers["evaluator"] = base.answers["evaluator"]
    b = agent_bundle(guidanceTools={"guidance_agent": [], "writer": [], "reviser": []})
    await run(steps, gateway, bundle=b)
    for path in ("writer", "reviser"):
        assert writer_bodies(steps, path) == writer_bodies(base, path) != []
    assert chat.seen == [] and gateway.tools("guidance_index") == []


async def test_the_writer_can_call_the_toolbox_behind_its_own_entry(
    gateway, monkeypatch
):
    use(monkeypatch, [[call("get_guidance", {"codes": ["DG-LEVEL"]}, "1")], []])
    steps = FakeSteps()
    b = agent_bundle(
        guidanceTools={"guidance_agent": [], "writer": list(toolbox.ALL_TOOLS)}
    )
    result = await run(steps, gateway, bundle=b)
    body = writer_bodies(steps, "writer")[0]
    assert body["passages"][-1]["title"] == "Title DG-LEVEL"
    assert gateway.tools("guidance_fetch") == [
        {"codes": ["DG-LEVEL"], "step": "writer"}
    ]
    assert gateway.tools("guidance_index") == [{"step": "writer"}]
    assert [c["step"] for c in result["workspace"]["guidanceCalls"]] == ["writer"] * 2
    rec = record(result)
    assert rec["calledBy"] == "writer" and rec["note"].startswith("1 call(s)")


async def test_the_reviser_gets_only_what_it_fetched(gateway, monkeypatch):
    use(monkeypatch, [[call("get_guidance", {"codes": ["DG-ORG"]}, "1")], []])
    steps = FakeSteps()
    steps.answers["evaluator"] = lambda body: {"evaluation": evaluation(3)}
    b = agent_bundle(
        guidanceTools={"guidance_agent": [], "reviser": list(toolbox.ALL_TOOLS)}
    )
    await run(steps, gateway, bundle=b)
    bodies = writer_bodies(steps, "reviser")
    assert bodies and bodies[0]["passages"] == [
        {"title": "Title DG-ORG", "text": "Text DG-ORG"}
    ]


async def test_revise_prompt_is_unchanged_without_passages(monkeypatch):
    from app.core.debrief import steps as S
    from app.core.llm import dispatch

    sent = []

    async def fake(**kwargs):
        sent.append(kwargs["prompt"])
        return None, {"provider": "gemini", "model": "m"}

    monkeypatch.setattr(dispatch, "generate_structured", fake)
    await S.revise({}, [], {}, [], "en", "m")
    await S.revise({}, [], {}, [], "en", "m", passages=[])
    await S.revise({}, [], {}, [], "en", "m", passages=[{"title": "T", "text": "x"}])
    assert sent[0] == sent[1] and "<guidance>" not in sent[0]
    assert "<guidance>" in sent[2]


async def test_writer_phase_reads_the_index_only_when_it_is_in_its_list(
    gateway, monkeypatch
):
    use(monkeypatch, [[call("get_guidance", {"codes": ["DG-LEVEL"]}, "1")], []])
    b = agent_bundle(
        guidanceTools={
            "guidance_agent": [],
            "writer": ["guidance_search", "guidance_fetch"],
        }
    )
    await go(gateway, bundle=b)
    assert gateway.tools("guidance_index") == []
    assert gateway.tools("guidance_fetch") == [
        {"codes": ["DG-LEVEL"], "step": "writer"}
    ]


# --- the compiled orchestrated graph, both agents in one wave ----------------------


async def test_lookup_and_agent_in_one_wave_merge_passages_once(gateway, monkeypatch):
    chat = use(
        monkeypatch,
        [[call("get_guidance", {"codes": ["DG-LEVEL", "DG-ORG"]}, "1")], []],
    )
    result, steps = await orun(gateway, ["guidance_lookup", "guidance_agent"])
    assert result["status"] == "published"  # no InvalidUpdateError
    writer = writer_bodies(steps, "writer")[0]
    titles = [p["title"] for p in writer["passages"]]
    # The lookup's baseline first, then the agent's fetched entries, each once.
    assert titles == [
        "Guide on client signals hopelessness",
        "Guide on client describes heaviness",
        "Title DG-LEVEL",
        "Title DG-ORG",
    ]
    assert len(titles) == len(set(titles))
    # The agent saw the baseline the lookup produced (titles in its prompt).
    system = chat.seen[0][0].content
    assert "Guide on client signals hopelessness" in system
    done = [s for s in result["steps"] if s["step"] == "guidance_lookup"]
    assert len(done) == 1 and len(records(result)) == 1
    assert records(result)[0]["note"] == "1 call(s), 2 passage(s) added"
    assert len(gateway.tools("guidance_fetch")) == 1
    assert result["workspace"]["findings"]["guidance_agent"]["findings"]


async def test_a_planner_skip_of_the_agent_is_honoured_with_the_lookup(
    gateway, monkeypatch
):
    chat = use(monkeypatch, [[]])
    result, steps = await orun(gateway, ["guidance_lookup"])
    assert result["status"] == "published"
    assert records(result) == [] and chat.seen == []
    titles = [p["title"] for p in writer_bodies(steps, "writer")[0]["passages"]]
    assert titles == [
        "Guide on client signals hopelessness",
        "Guide on client describes heaviness",
    ]


async def test_the_fixed_path_merges_after_the_lookup(gateway, monkeypatch):
    use(monkeypatch, [[call("get_guidance", {"codes": ["DG-LEVEL"]}, "1")], []])
    steps = FakeSteps()
    result = await run(steps, gateway, bundle=agent_bundle())
    titles = [p["title"] for p in writer_bodies(steps, "writer")[0]["passages"]]
    assert titles[-1] == "Title DG-LEVEL" and len(titles) == len(set(titles)) == 3
    assert len(records(result)) == 1
