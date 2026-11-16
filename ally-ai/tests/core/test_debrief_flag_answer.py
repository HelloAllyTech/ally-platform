"""The Debrief agent answering a learner's flag (V2_AUTONOMY F1): keep / correct /
remove with a reply, quotes checked against the transcript, the important moment
never removed, one corrected retry, cost counted."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import pytest
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda

from app.core.debrief.flag_answer import (
    CardRewrite,
    FlagAnswerRequest,
    FlagDecision,
    answer_flag,
    problem_with,
)

MODEL = "gemini-2.5-flash"
PRICES = {MODEL: {"input_per_m": 0.3, "output_per_m": 2.5}}


class FakeModel:
    def __init__(self, answers: List[Optional[FlagDecision]]):
        self.answers = list(answers)
        self.calls: List[Any] = []

    def with_structured_output(self, schema, include_raw=False):
        assert schema is FlagDecision and include_raw

        def run(messages):
            self.calls.append(messages)
            raw = AIMessage(
                content="",
                response_metadata={"model_name": MODEL},
                usage_metadata={
                    "input_tokens": 2000,
                    "output_tokens": 200,
                    "total_tokens": 2200,
                },
            )
            return {"raw": raw, "parsed": self.answers.pop(0), "parsing_error": None}

        return RunnableLambda(run)


def request(**over: Any) -> FlagAnswerRequest:
    body: Dict[str, Any] = {
        "flag_id": "f1",
        "run_id": "r1",
        "language": "hi",
        "section": "work_on_this[0]",
        "reason": "didnt_say",
        "note": "I never said that",
        "card": {
            "lead": "You moved on quickly",
            "quote": "let's talk about work",
            "body": "When she said she was tired you changed topic.",
        },
        "transcript": [
            {"turn_index": 1, "role": "client", "text": "I am so tired these days"},
            {"turn_index": 2, "role": "counselor", "text": "let's talk about work"},
        ],
        "model": MODEL,
        "prices": PRICES,
        "budget_usd": 0.05,
    }
    body.update(over)
    return FlagAnswerRequest.model_validate(body)


def factory(model):
    return lambda primary, backup, prices: {MODEL: model}


@pytest.mark.asyncio
async def test_correct_rewrites_only_the_cards_fields():
    model = FakeModel(
        [
            FlagDecision(
                action="correct",
                correction=CardRewrite(
                    body='When she said "I am so tired these days" '
                    "you asked about work.",
                    why="not a field of this card",
                ),
                reply="आपने सही कहा, हमने कार्ड ठीक कर दिया।",
            )
        ]
    )
    out = await answer_flag(request(), models_factory=factory(model))
    assert out["status"] == "finished" and out["action"] == "correct"
    assert set(out["correction"]) == {"body"}
    assert out["reply"].startswith("आपने")
    assert out["estimated_cost_usd"] > 0


def test_a_quote_not_in_the_transcript_is_a_problem():
    d = FlagDecision(
        action="correct",
        correction=CardRewrite(body='She said "I want to quit my job".'),
        reply="ok",
    )
    assert "not in the transcript" in problem_with(d, request())


@pytest.mark.asyncio
async def test_a_bad_answer_is_sent_back_once_then_used():
    model = FakeModel(
        [
            FlagDecision(
                action="correct",
                correction=CardRewrite(body='She said "made up words here".'),
                reply="Fixed.",
            ),
            FlagDecision(action="keep", reply="The card is right: you did move on."),
        ]
    )
    out = await answer_flag(request(), models_factory=factory(model))
    assert out["action"] == "keep" and len(model.calls) == 2
    assert "not in the transcript" in model.calls[1][-1].content


@pytest.mark.asyncio
async def test_the_important_moment_is_never_removed():
    remove = FlagDecision(action="remove", reply="Removed.")
    model = FakeModel([remove, remove])
    out = await answer_flag(
        request(section="important_moment"), models_factory=factory(model)
    )
    assert out["status"] == "failed" and out["action"] is None
    assert "never removed" in out["error"]


@pytest.mark.asyncio
async def test_remove_is_allowed_on_other_cards_and_no_budget_never_calls():
    model = FakeModel([FlagDecision(action="remove", reply="Taken out.")])
    out = await answer_flag(request(), models_factory=factory(model))
    assert out["action"] == "remove" and out["correction"] is None
    out = await answer_flag(request(budget_usd=0), models_factory=factory(model))
    assert out["status"] == "budget_spent"
