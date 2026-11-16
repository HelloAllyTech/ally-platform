"""The PM agent's console conversation as a Deep Agent (V2_AUTONOMY C1-C3): one
checkpoint thread per console thread, memory shared with the weekly run, the
investigator and reviewer on read-only tools, and approvals paused with LangGraph
human-in-the-loop until ally-be resumes them."""

from __future__ import annotations

from typing import Any, Dict

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.store.memory import InMemoryStore

from app.core.debrief_graph.circuit import reset_model_circuits
from app.core.pm_agent import agent as agent_module
from app.core.pm_agent.agent import MEMORY_FILE, ReviewVerdict, verdict_confidence
from app.core.pm_agent.conversation import (
    BUDGET_REPLY,
    DEFAULT_TOOLS,
    FAILED_REPLY,
    INTERRUPT_ON,
    run_conversation,
)
from app.core.pm_agent.runner import run_pm_agent
from app.core.pm_agent.schemas import PmAgentRunRequest, PmConversationRequest
from app.core.pm_agent.store import MEMORY_NAMESPACE
from app.core.pm_agent.tools import (
    CONVERSATION_ACTION_TOOLS,
    RUN_TOOLS,
    SUBAGENT_READ_TOOLS,
)
from tests.core.ask_ally.fakes import FakeGateway, ScriptedModel, ai

PRIMARY = "gemini-2.5-pro"
BACKUP = "gemini-2.5-flash"
PRICES = {
    PRIMARY: {"input_per_m": 1.25, "output_per_m": 10.0},
    BACKUP: {"input_per_m": 0.3, "output_per_m": 2.5},
}
IDEA = "11111111-1111-1111-1111-111111111111"
THREAD = "debrief-pm-conversation"
NOTE = "Hindi formality depends on the organisation."


def request(**over: Any) -> PmConversationRequest:
    body: Dict[str, Any] = {
        "turn_id": "turn-1",
        "thread_id": THREAD,
        "model": PRIMARY,
        "backup_model": BACKUP,
        "prices": PRICES,
        "budget_usd": 0.5,
        "message": "Approve the Hindi writer change",
        "author": "Asha",
        "about": {"kind": "change", "id": IDEA, "label": "Hindi writer"},
        "agent_token": "tok",
        "gateway_url": "http://be/api/v1/internal/debrief",
    }
    body.update(over)
    return PmConversationRequest.model_validate(body)


def factory(models: Dict[str, ScriptedModel]):
    def build(primary, backup, prices):
        return {k: v for k, v in models.items() if k in prices}

    return build


class Recording(ScriptedModel):
    """Records each pass's bound tools and messages."""

    def _next(self, messages):
        self.calls.append(
            {"tools": list(self.bound.get("tools") or []), "messages": list(messages)}
        )
        item = self.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.fixture(autouse=True)
def _circuits():
    reset_model_circuits()
    yield
    reset_model_circuits()


async def turn(model, gateway, saver, store, **over):
    return await run_conversation(
        request(**over),
        store=store,
        checkpointer=saver,
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: model}),
        gateway=gateway,
    )


def approve_call(plan="Put the Hindi writer change live for Hindi."):
    return ai(
        "I will approve it: " + plan + " Shall I go ahead? Reply yes to confirm.",
        calls=[
            {
                "name": "change_approve",
                "args": {"idea_id": IDEA, "plan": plan},
                "id": "approve-1",
            }
        ],
    )


def test_conversation_acting_tools_never_reach_a_weekly_run():
    assert not set(CONVERSATION_ACTION_TOOLS) & set(RUN_TOOLS)
    assert set(CONVERSATION_ACTION_TOOLS) <= set(DEFAULT_TOOLS)
    assert "confirm_plan" not in DEFAULT_TOOLS
    assert "builder_handoff" not in DEFAULT_TOOLS
    assert set(INTERRUPT_ON) == {"change_approve", "change_turn_down", "change_retry"}
    for cfg in INTERRUPT_ON.values():
        assert cfg["allowed_decisions"] == ["approve", "reject"]


@pytest.mark.asyncio
async def test_approve_pauses_then_resume_approve_carries_it_out():
    saver, store = InMemorySaver(), InMemoryStore()
    model = Recording(
        script=[
            ai(calls=[{"name": "change_read", "args": {"idea_id": IDEA}, "id": "r"}]),
            approve_call(),
            ai("Approved: the Hindi writer change goes live for Hindi."),
        ]
    )
    gateway = FakeGateway(
        {
            "change_read": {"id": IDEA, "title": "Hindi writer", "rule_text": None},
            "change_approve": {"ok": True, "done": "Approved “Hindi writer”"},
        }
    )
    first = await turn(model, gateway, saver, store)
    assert first["status"] == "finished", first["error"]
    pending = first["pending"]
    assert pending and pending["interrupt_id"]
    (action,) = pending["actions"]
    assert action["tool"] == "change_approve"
    assert action["args"]["idea_id"] == IDEA
    assert action["plan"] == "Put the Hindi writer change live for Hindi."
    assert "Reply yes" in first["reply"]
    # Nothing acted: only the read reached the gateway.
    assert [c["tool"] for c in gateway.calls] == ["change_read"]
    assert "Hindi writer" in first["tool_texts"]

    # The same person says yes; ally-be resumes with approve (and a new token).
    second = await turn(
        model,
        gateway,
        saver,
        store,
        turn_id="turn-2",
        message="yes",
        resume={"interrupt_id": pending["interrupt_id"], "decision": "approve"},
    )
    assert second["status"] == "finished", second["error"]
    assert second["pending"] is None
    assert [c["tool"] for c in gateway.calls] == ["change_read", "change_approve"]
    assert second["reply"].startswith("Approved")


@pytest.mark.asyncio
async def test_resume_reject_never_acts_and_the_agent_answers_their_words():
    saver, store = InMemorySaver(), InMemoryStore()
    model = Recording(
        script=[
            approve_call(),
            ai("Nothing was done. It changes only the Hindi writer's prompt."),
        ]
    )
    gateway = FakeGateway({"change_approve": {"ok": True}})
    first = await turn(model, gateway, saver, store)
    pending = first["pending"]
    second = await turn(
        model,
        gateway,
        saver,
        store,
        turn_id="turn-2",
        message="wait, what does it change?",
        resume={
            "interrupt_id": pending["interrupt_id"],
            "decision": "reject",
            "message": "Asha did not say yes; they wrote: wait, what does it change?",
        },
    )
    assert second["status"] == "finished", second["error"]
    assert not any(c["tool"] == "change_approve" for c in gateway.calls)
    tool_msgs = [m for m in model.calls[-1]["messages"] if m.type == "tool"]
    assert "rejected" in tool_msgs[-1].content
    assert "what does it change?" in tool_msgs[-1].content
    assert second["reply"].startswith("Nothing was done")


@pytest.mark.asyncio
async def test_a_new_message_while_paused_cancels_the_pending_call():
    """ally-be lost the pause (or sends a plain message): the thread goes on and
    the harness marks the dangling call cancelled; nothing acts."""
    saver, store = InMemorySaver(), InMemoryStore()
    model = Recording(script=[approve_call(), ai("Here is what changed this week.")])
    gateway = FakeGateway({"change_approve": {"ok": True}})
    await turn(model, gateway, saver, store)
    out = await turn(
        model, gateway, saver, store, turn_id="turn-2", message="What changed?"
    )
    assert out["status"] == "finished", out["error"]
    assert out["pending"] is None
    assert gateway.calls == []


@pytest.mark.asyncio
async def test_retry_pauses_only_for_a_change_that_always_asks():
    saver, store = InMemorySaver(), InMemoryStore()
    retry = ai(
        calls=[
            {
                "name": "change_retry",
                "args": {"idea_id": IDEA, "plan": "Try the rubric change again."},
                "id": "t",
            }
        ]
    )
    model = Recording(script=[retry, ai("Started trying it again.")])
    gateway = FakeGateway({"change_retry": {"ok": True, "done": "Started"}})
    out = await turn(model, gateway, saver, store, message="Retry it")
    assert out["pending"] is None
    assert [c["tool"] for c in gateway.calls] == ["change_retry"]

    model = Recording(script=[retry])
    gateway = FakeGateway({"change_retry": {"ok": True}})
    out = await turn(
        model,
        gateway,
        InMemorySaver(),
        store,
        message="Retry it",
        always_ask_idea_ids=[IDEA],
    )
    assert out["pending"]["actions"][0]["tool"] == "change_retry"
    # The model wrote nothing with the call: the reply is the plan and the question.
    assert out["reply"].startswith("Try the rubric change again.")
    assert "Reply yes" in out["reply"]
    assert gateway.calls == []


@pytest.mark.asyncio
async def test_the_thread_continues_from_its_checkpoint():
    saver, store = InMemorySaver(), InMemoryStore()
    model = Recording(script=[ai("One change went live."), ai("It was the Hindi one.")])
    await turn(model, FakeGateway(), saver, store, message="What changed?", about=None)
    await turn(
        model,
        FakeGateway(),
        saver,
        store,
        turn_id="turn-2",
        message="Which one?",
        about=None,
    )
    second = [
        m.content for m in model.calls[1]["messages"] if m.type in ("human", "ai")
    ]
    # ally-be sent only the new message; the first turn came from the checkpoint.
    assert "Asha: What changed?" in second
    assert "One change went live." in second
    assert second[-1] == "Asha: Which one?"
    state = await saver.aget_tuple({"configurable": {"thread_id": THREAD}})
    assert state is not None
    # Another thread id is another thread (the clinical advisor's).
    model = Recording(script=[ai("ok")])
    await turn(
        model,
        FakeGateway(),
        saver,
        store,
        thread_id="debrief-pm-conversation:pinned-rules",
        about=None,
    )
    humans = [m for m in model.calls[0]["messages"] if m.type == "human"]
    assert len(humans) == 1


def test_thread_ids_are_the_console_threads_only():
    with pytest.raises(ValueError):
        request(thread_id="pm-agent:run-1")


@pytest.mark.asyncio
async def test_memory_is_the_weekly_runs_and_a_person_s_note_reaches_it():
    store = InMemoryStore()
    model = Recording(
        script=[
            ai(
                calls=[
                    {
                        "name": "edit_file",
                        "args": {
                            "file_path": MEMORY_FILE,
                            "old_string": "Nothing recorded yet.",
                            "new_string": NOTE,
                        },
                        "id": "m",
                    }
                ]
            ),
            ai("Noted."),
        ]
    )
    out = await turn(
        model,
        FakeGateway(),
        InMemorySaver(),
        store,
        message="Remember: Hindi formality depends on the organisation.",
        about=None,
    )
    assert out["status"] == "finished", out["error"]
    (item,) = store.search(MEMORY_NAMESPACE)
    assert "Hindi formality depends on the organisation." in str(item.value)

    weekly = Recording(script=[ai("Report.")])
    await run_pm_agent(
        PmAgentRunRequest.model_validate(
            {
                "agent_run_id": "run-1",
                "model": PRIMARY,
                "prices": PRICES,
                "budget_usd": 1.0,
                "agent_token": "tok",
                "gateway_url": "http://be",
            }
        ),
        store=store,
        checkpointer=InMemorySaver(),
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: weekly}),
        gateway=FakeGateway(),
    )
    system = str(weekly.calls[0]["messages"][0].content)
    assert "Hindi formality depends on the organisation." in system


@pytest.mark.asyncio
async def test_investigator_and_reviewer_get_read_only_tools(monkeypatch):
    seen: Dict[str, Any] = {}
    real = agent_module.create_deep_agent

    def spy(**kw):
        seen.update(kw)
        return real(**kw)

    monkeypatch.setattr(agent_module, "create_deep_agent", spy)
    model = Recording(script=[ai("ok")])
    await turn(model, FakeGateway(), InMemorySaver(), InMemoryStore(), about=None)
    names = {s["name"]: {t.name for t in s["tools"]} for s in seen["subagents"]}
    assert set(names) == {"general-purpose", "reviewer"}
    for tools in names.values():
        assert tools and tools <= set(SUBAGENT_READ_TOOLS)
        assert not tools & set(CONVERSATION_ACTION_TOOLS)
    assert "session_read" in names["general-purpose"]
    assert seen["skills"] == ["/skills/"] and seen["memory"] == [MEMORY_FILE]
    assert set(seen["interrupt_on"]) == set(INTERRUPT_ON)
    # The main agent still has the conversation's tools and the task tool.
    bound = set(model.calls[0]["tools"])
    assert {"change_approve", "change_read", "task", "write_todos"} <= bound


def verdict(**answers: str) -> Dict[str, Any]:
    body: Dict[str, Any] = {"idea_id": IDEA}
    for k in ("supported", "fits_everywhere", "safe"):
        body[k] = {"answer": answers.get(k, "yes"), "evidence": f"{k}: n=40"}
    return body


def test_verdict_is_high_only_when_all_three_are_yes():
    assert verdict_confidence(ReviewVerdict(**verdict()))["level"] == "high"
    for k in ("supported", "fits_everywhere", "safe"):
        for a in ("no", "unclear"):
            low = verdict_confidence(ReviewVerdict(**verdict(**{k: a})))
            assert low["level"] == "low" and low["why"].startswith("Reviewer:")


@pytest.mark.asyncio
async def test_reviewer_verdict_is_recorded_by_code_and_low_makes_it_wait():
    model = Recording(
        script=[
            # main: hand the change to the reviewer
            ai(
                calls=[
                    {
                        "name": "task",
                        "args": {
                            "subagent_type": "reviewer",
                            "description": f"Review change {IDEA}",
                        },
                        "id": "task-1",
                    }
                ]
            ),
            # reviewer: read it, try to write memory (denied), then answer
            ai(
                calls=[
                    {"name": "change_read", "args": {"idea_id": IDEA}, "id": "r"},
                    {
                        "name": "write_file",
                        "args": {"file_path": "/memories/x.md", "content": "x"},
                        "id": "w",
                    },
                ]
            ),
            ai(
                calls=[
                    {
                        "name": "ReviewVerdict",
                        "args": verdict(fits_everywhere="unclear"),
                        "id": "v",
                    }
                ]
            ),
            # main: relays it
            ai("The reviewer is not sure it fits Tamil, so it will wait for you."),
        ]
    )
    gateway = FakeGateway(
        {
            "change_read": {"id": IDEA, "title": "Shorter cards"},
            "change_review_record": {"ok": True, "level": "low"},
        }
    )
    store = InMemoryStore()
    out = await turn(model, gateway, InMemorySaver(), store, message="Review it")
    assert out["status"] == "finished", out["error"]
    # The reviewer's own pass: read-only gateway tools, no action tool, and
    # every file write denied.
    reviewer_tools = set(model.calls[1]["tools"])
    assert "change_read" in reviewer_tools
    acting = set(CONVERSATION_ACTION_TOOLS) | (
        set(RUN_TOOLS) - set(SUBAGENT_READ_TOOLS)
    )
    assert not reviewer_tools & acting
    denied = [
        m
        for m in model.calls[2]["messages"]
        if m.type == "tool" and m.tool_call_id == "w"
    ]
    assert "denied" in str(denied[0].content).lower()
    assert not [i for i in store.search(MEMORY_NAMESPACE) if i.key == "/x.md"]
    record = next(c for c in gateway.calls if c["tool"] == "change_review_record")
    assert record["body"]["idea_id"] == IDEA
    assert record["body"]["fits_everywhere"]["answer"] == "unclear"
    tool_msgs = [m for m in model.calls[-1]["messages"] if m.type == "tool"]
    assert "confidence is low" in tool_msgs[-1].content
    assert ("change_review_record", "done") in {
        (s["step"], s["status"]) for s in out["steps"]
    }


@pytest.mark.asyncio
async def test_a_verdict_for_another_change_is_not_recorded():
    other = "22222222-2222-2222-2222-222222222222"
    body = verdict()
    body["idea_id"] = other
    model = Recording(
        script=[
            ai(
                calls=[
                    {
                        "name": "task",
                        "args": {
                            "subagent_type": "reviewer",
                            "description": f"Review change {IDEA}",
                        },
                        "id": "task-1",
                    }
                ]
            ),
            ai(calls=[{"name": "ReviewVerdict", "args": body, "id": "v"}]),
            ai("ok"),
        ]
    )
    gateway = FakeGateway()
    await turn(model, gateway, InMemorySaver(), InMemoryStore(), about=None)
    assert not any(c["tool"] == "change_review_record" for c in gateway.calls)


@pytest.mark.asyncio
async def test_propose_carries_confidence_as_advice():
    model = Recording(
        script=[
            ai(
                calls=[
                    {
                        "name": "idea_propose",
                        "args": {
                            "problem": {
                                "title": "Tamil cards too long",
                                "summary": "Learners flag length.",
                                "metrics": [{"name": "flag_rate", "value": 0.1}],
                            },
                            "route": "A",
                            "title": "Shorter Tamil cards",
                            "hypothesis": "h",
                            "expected_effect": {
                                "metric": "flag_rate",
                                "direction": "down",
                            },
                            "confidence": {"level": "high", "why": "Clear."},
                        },
                        "id": "a",
                    }
                ]
            ),
            ai("Proposed shorter Tamil cards."),
        ]
    )
    gateway = FakeGateway({"idea_propose": {"idea_id": IDEA}})
    out = await turn(
        model,
        gateway,
        InMemorySaver(),
        InMemoryStore(),
        message="Propose shorter Tamil cards",
    )
    body = gateway.calls[0]["body"]
    # Sent as the agent's own view; ally-be stores it as advice only.
    assert body["confidence"] == {"level": "high", "why": "Clear."}
    assert out["status"] == "finished"


@pytest.mark.asyncio
async def test_budget_spent_gives_a_plain_reply():
    model = Recording(
        script=[
            ai(
                calls=[{"name": "metrics_view", "args": {}, "id": "a"}],
                tokens=(400_000, 1000),
            ),
            ai("never reached"),
        ]
    )
    out = await turn(
        model,
        FakeGateway({"metrics_view": {}}),
        InMemorySaver(),
        InMemoryStore(),
        budget_usd=0.25,
    )
    assert out["status"] == "budget_spent" and out["reply"] == BUDGET_REPLY
    assert len(model.calls) == 1


@pytest.mark.asyncio
async def test_no_model_fails_with_a_plain_reply():
    out = await run_conversation(
        request(),
        store=InMemoryStore(),
        checkpointer=InMemorySaver(),
        default_model=PRIMARY,
        models_factory=lambda *a: {},
        gateway=FakeGateway(),
    )
    assert out["status"] == "failed" and out["reply"] == FAILED_REPLY
