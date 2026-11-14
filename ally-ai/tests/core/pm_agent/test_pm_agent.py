"""The PM agent's wiring on a scripted model: tools through the gateway, refusals
read as tool errors, the budget, memory in its own namespace, quotes stripped for
Builder and Bug Hunter, read-only subagents."""

from __future__ import annotations

from typing import Any, Dict

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore

from app.core.debrief_graph.circuit import record_model_failure, reset_model_circuits
from app.core.debrief_graph.gateway import GatewayError
from app.core.pm_agent import agent as agent_module
from app.core.pm_agent.middleware import BUDGET_SPENT
from app.core.pm_agent.quotes import REMOVED, strip_quotes
from app.core.pm_agent.runner import run_pm_agent
from app.core.pm_agent.schemas import PmAgentRunRequest
from app.core.pm_agent.store import MEMORY_NAMESPACE
from app.core.pm_agent.tools import ALL_TOOLS, READ_TOOLS
from tests.core.ask_ally.fakes import FakeGateway, ScriptedModel, ai

PRIMARY = "gemini-2.5-pro"
BACKUP = "gemini-2.5-flash"
PRICES = {
    PRIMARY: {"input_per_m": 1.25, "output_per_m": 10.0},
    BACKUP: {"input_per_m": 0.3, "output_per_m": 2.5},
}
IDEA = "11111111-1111-1111-1111-111111111111"
QUOTE = "I don't really know what to say to you right now"


def request(**over: Any) -> PmAgentRunRequest:
    body: Dict[str, Any] = {
        "agent_run_id": "run-1",
        "review": "weekly",
        "model": PRIMARY,
        "backup_model": BACKUP,
        "prices": PRICES,
        "budget_usd": 1.0,
        "inputs": {"comments": [], "metric_failure_points": []},
        "agent_token": "tok",
        "gateway_url": "http://be/api/v1/internal/debrief",
    }
    body.update(over)
    return PmAgentRunRequest.model_validate(body)


def factory(models: Dict[str, ScriptedModel]):
    def build(primary, backup, prices):
        return {k: v for k, v in models.items() if k in prices}

    return build


@pytest.fixture(autouse=True)
def _circuits():
    reset_model_circuits()
    yield
    reset_model_circuits()


def test_strip_quotes_removes_quoted_and_known_text():
    text = (
        f'Learners said "{QUOTE}" and the reviewer wrote “too generic”. '
        f"Also {QUOTE.upper()} appears unquoted.\n> a block quote line"
    )
    out, n = strip_quotes(text, known=[QUOTE])
    assert QUOTE.lower() not in out.lower()
    assert "too generic" not in out and "block quote" not in out
    assert out.count(REMOVED) == n == 4


@pytest.mark.asyncio
async def test_run_proposes_strips_reads_refusals_and_writes_memory():
    model = ScriptedModel(
        script=[
            ai(
                calls=[
                    {
                        "name": "idea_propose",
                        "args": {
                            "problem": {
                                "title": "Practise-next ignored in Hindi",
                                "summary": "Learners skip the card.",
                                "comment_ids": ["c-1"],
                                "metrics": [
                                    {"name": "practise_click_through", "value": 0.1}
                                ],
                            },
                            "route": "B",
                            "title": "Show the card first",
                            "hypothesis": "h",
                            "expected_effect": {
                                "metric": "practise_click_through",
                                "direction": "up",
                            },
                        },
                        "id": "a",
                    }
                ]
            ),
            ai(
                calls=[
                    {
                        "name": "builder_handoff",
                        "args": {
                            "idea_id": IDEA,
                            "problem": f'A learner said "{QUOTE}".',
                            "evidence_summary": "4 comments tagged missed",
                            "expected_effect": "click-through up",
                            "acceptance_checks": ["the card is first"],
                        },
                        "id": "b",
                    },
                    {
                        "name": "release_draft",
                        "args": {
                            "idea_id": IDEA,
                            "kind": "prompt_edit",
                            "prompt_code": "debrief_quality_rubric",
                            "find": "a",
                            "replace": "b",
                        },
                        "id": "c",
                    },
                ]
            ),
            ai(
                calls=[
                    {
                        "name": "write_file",
                        "args": {
                            "file_path": "/memories/AGENTS.md",
                            "content": "Tried: card order (route B).",
                        },
                        "id": "d",
                    }
                ]
            ),
            ai("Report: one idea to Builder."),
        ]
    )
    gateway = FakeGateway(
        {
            "idea_propose": {"idea_id": IDEA},
            "builder_handoff": {"ok": True, "quotes_removed": 0},
            "release_draft": {
                "refused": (
                    "the judge's rubric is never changed by the PM agent (never-list)"
                )
            },
        }
    )
    store = InMemoryStore()
    out = await run_pm_agent(
        request(),
        store=store,
        checkpointer=InMemorySaver(),
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: model}),
        gateway=gateway,
    )
    assert out["status"] == "finished", out["error"]
    assert out["report"] == "Report: one idea to Builder."
    assert out["idea_ids"] == [IDEA]
    # Builder never receives the quote, even before ally-be strips it again.
    handoff = next(c for c in gateway.calls if c["tool"] == "builder_handoff")
    assert QUOTE not in handoff["body"]["problem"]
    assert REMOVED in handoff["body"]["problem"]
    # The refusal reached the model as a readable tool error, and the run went on.
    assert out["refusals"][0]["tool"] == "release_draft"
    tool_messages = [m for c in model.calls for m in c["messages"] if m.type == "tool"]
    assert any(
        "Refused by ally-be: the judge's rubric" in m.content for m in tool_messages
    )
    statuses = {(s["step"], s["status"]) for s in out["steps"]}
    assert ("release_draft", "refused") in statuses
    assert ("idea_propose", "done") in statuses
    # Memory is in the agent's own namespace.
    items = store.search(MEMORY_NAMESPACE)
    assert [i.key for i in items] == ["/AGENTS.md"]
    assert out["estimated_cost_usd"] > 0


@pytest.mark.asyncio
async def test_budget_spent_stops_the_loop_without_calling_the_model():
    model = ScriptedModel(
        script=[
            ai(
                calls=[{"name": "metrics_view", "args": {}, "id": "a"}],
                tokens=(400_000, 1000),
            ),
            ai("never reached"),
        ]
    )
    out = await run_pm_agent(
        request(budget_usd=0.25),
        store=InMemoryStore(),
        checkpointer=InMemorySaver(),
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: model}),
        gateway=FakeGateway({"metrics_view": {"failure_points": []}}),
    )
    assert out["status"] == "budget_spent"
    assert out["report"] == BUDGET_SPENT
    assert len(model.calls) == 1


@pytest.mark.asyncio
async def test_no_budget_left_never_starts():
    out = await run_pm_agent(
        request(budget_usd=0),
        store=InMemoryStore(),
        checkpointer=None,
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: ScriptedModel(script=[])}),
        gateway=FakeGateway(),
    )
    assert out["status"] == "budget_spent" and out["steps"] == []


@pytest.mark.asyncio
async def test_backup_first_while_the_primary_breaker_is_open_and_on_failure():
    for _ in range(5):
        record_model_failure(PRIMARY)
    primary = ScriptedModel(script=[])
    backup = ScriptedModel(script=[ai("done")])
    out = await run_pm_agent(
        request(),
        store=InMemoryStore(),
        checkpointer=None,
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: primary, BACKUP: backup}),
        gateway=FakeGateway(),
    )
    assert out["status"] == "finished" and out["model"] == BACKUP
    assert primary.calls == []

    reset_model_circuits()
    primary = ScriptedModel(script=[RuntimeError("503")])
    backup = ScriptedModel(script=[ai("done on backup")])
    out = await run_pm_agent(
        request(agent_run_id="run-2"),
        store=InMemoryStore(),
        checkpointer=None,
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: primary, BACKUP: backup}),
        gateway=FakeGateway(),
    )
    assert out["report"] == "done on backup"
    assert [s["status"] for s in out["steps"] if s["step"] == "model"] == [
        "failed",
        "done",
    ]


@pytest.mark.asyncio
async def test_an_empty_answer_is_tried_again_not_taken_as_the_end():
    primary = ScriptedModel(script=[ai("", tokens=(1000, 0))])
    backup = ScriptedModel(script=[ai("the report")])
    out = await run_pm_agent(
        request(),
        store=InMemoryStore(),
        checkpointer=None,
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: primary, BACKUP: backup}),
        gateway=FakeGateway(),
    )
    assert out["report"] == "the report"
    models = [
        (s["status"], s.get("note")) for s in out["steps"] if s["step"] == "model"
    ]
    assert models == [("failed", "empty answer"), ("done", "retried")]


@pytest.mark.asyncio
async def test_memory_starts_seeded_and_is_kept():
    store = InMemoryStore()
    await run_pm_agent(
        request(),
        store=store,
        checkpointer=None,
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: ScriptedModel(script=[ai("ok")])}),
        gateway=FakeGateway(),
    )
    (item,) = store.search(MEMORY_NAMESPACE)
    assert "PM agent memory" in "\n".join(
        item.value["content"]
    ) or "PM agent memory" in str(item.value["content"])


@pytest.mark.asyncio
async def test_gateway_error_is_a_tool_error_not_a_crash():
    model = ScriptedModel(
        script=[
            ai(
                calls=[
                    {"name": "reporting_query", "args": {"sql": "SELECT 1"}, "id": "a"}
                ]
            ),
            ai("ok"),
        ]
    )
    out = await run_pm_agent(
        request(),
        store=InMemoryStore(),
        checkpointer=None,
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: model}),
        gateway=FakeGateway(
            {"reporting_query": GatewayError("reporting_query", 403, "no")}
        ),
    )
    assert out["status"] == "finished"
    assert ("reporting_query", "failed") in {
        (s["step"], s["status"]) for s in out["steps"]
    }


@pytest.mark.asyncio
async def test_only_the_tools_the_token_lists():
    class Recording(ScriptedModel):
        def _next(self, messages):
            self.calls.append({"tools": list(self.bound.get("tools") or [])})
            return self.script.pop(0)

    model = Recording(script=[ai("ok")])
    await run_pm_agent(
        request(tools=["comments_read", "metrics_view"]),
        store=InMemoryStore(),
        checkpointer=None,
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: model}),
        gateway=FakeGateway(),
    )
    # Only the listed gateway tools are bound (plus the harness's own tools).
    bound = set(model.calls[0]["tools"])
    assert {"comments_read", "metrics_view", "write_todos", "task"} <= bound
    assert not ({"idea_propose", "reporting_query"} & bound)


def test_subagents_only_get_read_tools(monkeypatch):
    seen: Dict[str, Any] = {}

    def fake_create(**kw):
        seen.update(kw)
        return object()

    monkeypatch.setattr(agent_module, "create_deep_agent", fake_create)
    from app.core.pm_agent.ledger import RunLedger
    from app.core.pm_agent.tools import make_tools

    ledger = RunLedger(run_id="r", budget_usd=1, prices=PRICES)
    tools = make_tools(FakeGateway(), ledger)
    agent_module.build_pm_agent(
        ledger=ledger,
        tools=tools,
        models={PRIMARY: ScriptedModel()},
        primary=PRIMARY,
        backup=None,
        system_prompt="s",
        store=InMemoryStore(),
        checkpointer=None,
    )
    (sub,) = seen["subagents"]
    assert (
        sub["name"] == "general-purpose"
    )  # replaces the default, which would inherit all
    assert {t.name for t in sub["tools"]} == set(READ_TOOLS)
    assert len(seen["tools"]) == len(ALL_TOOLS)
    assert seen["skills"] == ["/skills/"] and seen["memory"] == ["/memories/AGENTS.md"]


@pytest.mark.asyncio
async def test_skills_are_offered_and_read_only():
    class Recording(ScriptedModel):
        def _next(self, messages):
            self.calls.append({"messages": list(messages)})
            return self.script.pop(0)

    model = Recording(
        script=[
            ai(
                calls=[
                    {
                        "name": "read_file",
                        "args": {"file_path": "/skills/builder-brief/SKILL.md"},
                        "id": "a",
                    },
                    {
                        "name": "write_file",
                        "args": {"file_path": "/skills/evil/SKILL.md", "content": "x"},
                        "id": "b",
                    },
                ]
            ),
            ai("ok"),
        ]
    )
    await run_pm_agent(
        request(),
        store=InMemoryStore(),
        checkpointer=None,
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: model}),
        gateway=FakeGateway(),
    )
    system = str(model.calls[0]["messages"][0].content)
    for name in ("prompt-change", "registry-agent", "builder-brief"):
        assert name in system
    tool_out = {
        m.tool_call_id: str(m.content)
        for m in model.calls[1]["messages"]
        if m.type == "tool"
    }
    assert "never see learner words" in tool_out["a"]
    assert "denied" in tool_out["b"].lower() or "permission" in tool_out["b"].lower()
    assert not (agent_module.SKILLS_DIR / "evil").exists()


@pytest.mark.asyncio
async def test_answer_only_run_reads_questions_and_posts_answers():
    """Plan §11.7 "Ask a question": a short run with read tools and
    question_answer only; the answer goes back through the gateway with quotes
    removed."""

    class Recording(ScriptedModel):
        def _next(self, messages):
            self.calls.append(
                {"tools": list(self.bound.get("tools") or []), "messages": messages}
            )
            return self.script.pop(0)

    model = Recording(
        script=[
            ai(calls=[{"name": "questions_read", "args": {}}]),
            ai(
                calls=[
                    {
                        "name": "question_answer",
                        "args": {
                            "idea_id": IDEA,
                            "question_id": "q1",
                            "answer": (
                                "It fixes 14 of 30 cases; one learner said "
                                f'"{QUOTE}".'
                            ),
                        },
                    }
                ]
            ),
            ai("Answered 1 question."),
        ]
    )
    gw = FakeGateway(
        {
            "questions_read": {
                "questions": [
                    {
                        "idea_id": IDEA,
                        "question_id": "q1",
                        "question": "Why only the Writer?",
                    }
                ]
            },
            "question_answer": {"ok": True, "id": "a1"},
        }
    )
    tools = [
        "questions_read",
        "question_answer",
        "reporting_query",
        "comments_read",
        "metrics_view",
    ]
    out = await run_pm_agent(
        request(
            review="questions",
            tools=tools,
            inputs={"open_questions": [{"idea_id": IDEA, "question_id": "q1"}]},
        ),
        store=InMemoryStore(),
        checkpointer=None,
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: model}),
        gateway=gw,
    )
    assert out["status"] == "finished"
    assert out["report"] == "Answered 1 question."
    bound = set(model.calls[0]["tools"])
    assert {"questions_read", "question_answer"} <= bound
    assert not ({"idea_propose", "release_draft", "ladder_start_quick_test"} & bound)
    first = model.calls[0]["messages"][-1].content
    assert first.startswith("REVIEW: questions.")
    answer = next(c for c in gw.calls if c["tool"] == "question_answer")["body"]
    assert answer["idea_id"] == IDEA and answer["question_id"] == "q1"
    assert QUOTE not in answer["answer"] and REMOVED in answer["answer"]
    assert "question_answer" in [s["step"] for s in out["steps"]]


@pytest.mark.asyncio
async def test_guidance_propose_goes_to_a_person_with_quotes_stripped():
    """Route D (spec C4): the agent drafts a Debrief Guidance entry; ally-be stores
    it for the clinical advisor. The tool never writes to the Context Library."""
    model = ScriptedModel(
        script=[
            ai(
                calls=[
                    {
                        "name": "guidance_propose",
                        "args": {
                            "idea_id": IDEA,
                            "title": "Asking about hopelessness first",
                            "situation": "A client hints at hopelessness",
                            "guidance": f'Ask about it directly. "{QUOTE}" was missed.',
                            "run_ids": ["r1"],
                        },
                        "id": "g",
                    }
                ]
            ),
            ai("ok"),
        ]
    )
    gateway = FakeGateway({"guidance_propose": {"ok": True}})
    await run_pm_agent(
        request(),
        store=InMemoryStore(),
        checkpointer=None,
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: model}),
        gateway=gateway,
    )
    sent = [c for c in gateway.calls if c["tool"] == "guidance_propose"]
    assert len(sent) == 1
    assert QUOTE not in sent[0]["body"]["guidance"]
    assert sent[0]["body"]["action"] == "new"
    assert "guidance_propose" in ALL_TOOLS and "guidance_propose" not in READ_TOOLS


@pytest.mark.asyncio
async def test_release_draft_passes_run_ids_through_to_ally_be():
    from app.core.pm_agent.ledger import RunLedger
    from app.core.pm_agent.tools import make_tools

    gateway = FakeGateway({"release_draft": {"ok": True}})
    ledger = RunLedger(run_id="r", budget_usd=1, prices=PRICES)
    tool = next(t for t in make_tools(gateway, ledger) if t.name == "release_draft")
    run_ids = [
        "22222222-2222-2222-2222-222222222222",
        "33333333-3333-3333-3333-333333333333",
    ]
    await tool.ainvoke(
        {
            "idea_id": IDEA,
            "kind": "prompt_edit",
            "prompt_code": "debrief_writer_system",
            "find": "a",
            "replace": "b",
            "run_ids": run_ids,
        }
    )
    (call,) = gateway.calls
    assert call["tool"] == "release_draft"
    assert call["body"]["run_ids"] == run_ids
    # Without run_ids the body still sends an empty list, which ally-be ignores.
    await tool.ainvoke(
        {"idea_id": IDEA, "kind": "setting", "setting_key": "k", "setting_value": 1}
    )
    assert gateway.calls[1]["body"]["run_ids"] == []
