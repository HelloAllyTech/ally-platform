"""The PM agent's console conversation (V2_AUTONOMY C1-C3): the thread and context
reach the model, actions go through the gateway, an approval waits for a yes, the
budget holds, and confidence travels with every proposed change (A2)."""

from __future__ import annotations

from typing import Any, Dict

import pytest

from app.core.debrief_graph.circuit import reset_model_circuits
from app.core.pm_agent.conversation import (
    BUDGET_REPLY,
    DEFAULT_TOOLS,
    FAILED_REPLY,
    build_messages,
    run_conversation,
)
from app.core.pm_agent.schemas import PmConversationRequest
from app.core.pm_agent.tools import CONVERSATION_TOOLS, RUN_TOOLS
from tests.core.ask_ally.fakes import FakeGateway, ScriptedModel, ai

PRIMARY = "gemini-2.5-pro"
BACKUP = "gemini-2.5-flash"
PRICES = {
    PRIMARY: {"input_per_m": 1.25, "output_per_m": 10.0},
    BACKUP: {"input_per_m": 0.3, "output_per_m": 2.5},
}
IDEA = "11111111-1111-1111-1111-111111111111"


def request(**over: Any) -> PmConversationRequest:
    body: Dict[str, Any] = {
        "turn_id": "turn-1",
        "model": PRIMARY,
        "backup_model": BACKUP,
        "prices": PRICES,
        "budget_usd": 0.5,
        "history": [
            {"who": "person", "author": "Asha", "text": "What changed this week?"},
            {
                "who": "agent",
                "text": "One change went live.",
                "action": None,
            },
        ],
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


@pytest.fixture(autouse=True)
def _circuits():
    reset_model_circuits()
    yield
    reset_model_circuits()


def test_thread_and_context_become_messages():
    msgs = build_messages(request(pending_plan={"plan_id": "p1", "plan": "Approve X"}))
    assert [m.type for m in msgs] == ["human", "ai", "human"]
    assert msgs[0].content.startswith("Asha: ")
    last = msgs[-1].content
    assert last.startswith("Asha: Approve the Hindi writer change")
    assert IDEA in last and "p1" in last and "yes" in last


def test_conversation_tools_never_reach_a_weekly_run():
    assert not set(CONVERSATION_TOOLS) & set(RUN_TOOLS)
    assert set(CONVERSATION_TOOLS) <= set(DEFAULT_TOOLS)


@pytest.mark.asyncio
async def test_approval_answers_awaiting_yes_and_the_reply_repeats_it_back():
    model = ScriptedModel(
        script=[
            ai(calls=[{"name": "change_read", "args": {"idea_id": IDEA}, "id": "a"}]),
            ai(
                calls=[
                    {
                        "name": "change_approve",
                        "args": {"idea_id": IDEA, "plan": "Put it live for Hindi."},
                        "id": "b",
                    }
                ]
            ),
            ai("I will put it live for Hindi. Shall I go ahead? Reply yes to confirm."),
        ]
    )
    gateway = FakeGateway(
        {
            "change_read": {"id": IDEA, "title": "Hindi writer"},
            "change_approve": {
                "status": "awaiting_yes",
                "plan_id": "p1",
                "plan": "Put it live for Hindi.",
            },
        }
    )
    out = await run_conversation(
        request(),
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: model}),
        gateway=gateway,
    )
    assert out["status"] == "finished", out["error"]
    assert "Reply yes" in out["reply"]
    assert [c["tool"] for c in gateway.calls] == ["change_read", "change_approve"]
    # confirm_plan was never called: nothing acted.
    assert not any(c["tool"] == "confirm_plan" for c in gateway.calls)
    assert "builder_handoff" not in DEFAULT_TOOLS
    assert out["estimated_cost_usd"] > 0


@pytest.mark.asyncio
async def test_a_refusal_comes_back_as_words_the_model_can_relay():
    model = ScriptedModel(
        script=[
            ai(calls=[{"name": "confirm_plan", "args": {"plan_id": "p1"}, "id": "a"}]),
            ai(
                "Only the clinical advisor or the owner can approve this; "
                "I've asked them."
            ),
        ]
    )
    gateway = FakeGateway(
        {
            "confirm_plan": {
                "refused": "Only the clinical advisor or the owner can approve this"
            }
        }
    )
    out = await run_conversation(
        request(message="yes"),
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: model}),
        gateway=gateway,
    )
    assert out["refusals"][0]["tool"] == "confirm_plan"
    assert "clinical advisor" in out["reply"]


@pytest.mark.asyncio
async def test_propose_carries_confidence():
    model = ScriptedModel(
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
                            "confidence": {"level": "low", "why": "Only 12 debriefs."},
                        },
                        "id": "a",
                    }
                ]
            ),
            ai("Proposed: shorter Tamil cards (low confidence: only 12 debriefs)."),
        ]
    )
    gateway = FakeGateway({"idea_propose": {"idea_id": IDEA}})
    out = await run_conversation(
        request(message="Propose shorter Tamil cards"),
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: model}),
        gateway=gateway,
    )
    body = gateway.calls[0]["body"]
    assert body["confidence"] == {"level": "low", "why": "Only 12 debriefs."}
    assert out["status"] == "finished"


@pytest.mark.asyncio
async def test_budget_spent_gives_a_plain_reply():
    model = ScriptedModel(
        script=[
            ai(
                calls=[{"name": "metrics_view", "args": {}, "id": "a"}],
                tokens=(400_000, 1000),
            ),
            ai("never reached"),
        ]
    )
    out = await run_conversation(
        request(budget_usd=0.25),
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: model}),
        gateway=FakeGateway({"metrics_view": {}}),
    )
    assert out["status"] == "budget_spent" and out["reply"] == BUDGET_REPLY
    assert len(model.calls) == 1


@pytest.mark.asyncio
async def test_no_model_fails_with_a_plain_reply():
    out = await run_conversation(
        request(),
        default_model=PRIMARY,
        models_factory=lambda *a: {},
        gateway=FakeGateway(),
    )
    assert out["status"] == "failed" and out["reply"] == FAILED_REPLY
