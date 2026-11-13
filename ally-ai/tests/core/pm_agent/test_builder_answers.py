"""The PM agent answering Builder's interview: answers from the brief, escalates
what the brief does not settle, never sends a quote, counts its cost."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableLambda

from app.core.pm_agent import builder_answers as module
from app.core.pm_agent.builder_answers import (
    BuilderAnswer,
    BuilderAnswers,
    answer_builder_questions,
)
from app.core.pm_agent.schemas import BuilderAnswersRequest

PRIMARY = "gemini-2.5-pro"
BACKUP = "gemini-2.5-flash"
PRICES = {
    PRIMARY: {"input_per_m": 1.25, "output_per_m": 10.0},
    BACKUP: {"input_per_m": 0.3, "output_per_m": 2.5},
}
QUOTE = "she said nothing after the call ended at all"


class FakeModel:
    """A chat model whose structured output is scripted (or raises)."""

    def __init__(self, name: str, parsed: Optional[BuilderAnswers], fail=False):
        self.name = name
        self.parsed = parsed
        self.fail = fail
        self.calls: List[Any] = []

    def with_structured_output(self, schema, include_raw=False):
        assert schema is BuilderAnswers and include_raw

        def run(messages):
            self.calls.append(messages)
            if self.fail:
                raise RuntimeError("provider down")
            raw = AIMessage(
                content="",
                response_metadata={"model_name": self.name},
                usage_metadata={
                    "input_tokens": 1000,
                    "output_tokens": 100,
                    "total_tokens": 1100,
                },
            )
            return {"raw": raw, "parsed": self.parsed, "parsing_error": None}

        return RunnableLambda(run)


def request(**over: Any) -> BuilderAnswersRequest:
    body: Dict[str, Any] = {
        "idea_id": "idea-1",
        "model": PRIMARY,
        "backup_model": BACKUP,
        "prices": PRICES,
        "budget_usd": 0.2,
        "brief": {
            "title": "Let the Analyst read the post-session voice-note",
            "problem": "The Analyst cannot read the learner's voice-note.",
            "evidence_summary": "9 reviewer comments this month name it.",
            "expected_effect": "Fewer missed-moment comments.",
            "acceptance_checks": ["The tool is read-only"],
        },
        "questions": [
            {
                "id": "q1",
                "prompt": "Should the tool write anything?",
                "options": [
                    {"id": "ro", "label": "Read-only"},
                    {"id": "rw", "label": "Read and write"},
                ],
            },
            {"id": "q2", "prompt": "Which organisations should see voice-notes?"},
        ],
        "known_texts": [QUOTE],
    }
    body.update(over)
    return BuilderAnswersRequest.model_validate(body)


def factory(models: Dict[str, FakeModel]):
    def build(primary, backup, prices):
        return {k: v for k, v in models.items() if k in prices}

    return build


@pytest.fixture(autouse=True)
def usage(monkeypatch):
    seen: List[tuple] = []
    monkeypatch.setattr(module, "emit_llm_usage", lambda *a, **k: seen.append(a))
    return seen


@pytest.mark.asyncio
async def test_answers_what_the_brief_settles_and_escalates_the_rest(usage):
    parsed = BuilderAnswers(
        answers=[
            BuilderAnswer(
                question_id="q1",
                can_answer=True,
                selected_option_ids=["ro", "nope"],
                answer="Read-only: the acceptance checks say so.",
            ),
            BuilderAnswer(
                question_id="q2",
                can_answer=False,
                reason="The brief does not say which organisations.",
            ),
        ]
    )
    out = await answer_builder_questions(
        request(),
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: FakeModel(PRIMARY, parsed)}),
    )
    assert out["status"] == "finished"
    q1, q2 = out["answers"]
    assert q1["can_answer"] and q1["selected_option_ids"] == ["ro"]
    assert q2["can_answer"] is False and "organisations" in q2["reason"]
    assert out["estimated_cost_usd"] == pytest.approx(0.00225, abs=1e-4)
    assert usage and usage[0][2] == "debrief_improver"


@pytest.mark.asyncio
async def test_an_answer_that_quotes_is_never_sent():
    parsed = BuilderAnswers(
        answers=[
            BuilderAnswer(
                question_id="q1",
                can_answer=True,
                answer=f"Because {QUOTE}, keep it read-only.",
            ),
            BuilderAnswer(
                question_id="q2",
                can_answer=True,
                answer='The reviewer wrote "missed what she said" so all of them.',
            ),
        ]
    )
    out = await answer_builder_questions(
        request(),
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: FakeModel(PRIMARY, parsed)}),
    )
    for a in out["answers"]:
        assert a["can_answer"] is False
        assert a["answer"] == ""
        assert QUOTE not in a["reason"] and "missed what she said" not in a["reason"]


@pytest.mark.asyncio
async def test_a_missing_answer_is_escalated():
    parsed = BuilderAnswers(
        answers=[BuilderAnswer(question_id="q1", can_answer=True, answer="Read-only.")]
    )
    out = await answer_builder_questions(
        request(),
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: FakeModel(PRIMARY, parsed)}),
    )
    assert [a["can_answer"] for a in out["answers"]] == [True, False]


@pytest.mark.asyncio
async def test_backup_answers_when_primary_fails():
    parsed = BuilderAnswers(
        answers=[
            BuilderAnswer(question_id="q1", can_answer=True, answer="Read-only."),
            BuilderAnswer(question_id="q2", can_answer=False, reason="Not settled."),
        ]
    )
    out = await answer_builder_questions(
        request(),
        default_model=PRIMARY,
        models_factory=factory(
            {
                PRIMARY: FakeModel(PRIMARY, None, fail=True),
                BACKUP: FakeModel(BACKUP, parsed),
            }
        ),
    )
    assert out["status"] == "finished" and out["model"] == BACKUP
    assert out["answers"][0]["can_answer"] is True


@pytest.mark.asyncio
async def test_no_budget_or_no_model_escalates_everything_without_a_call():
    model = FakeModel(PRIMARY, None)
    spent = await answer_builder_questions(
        request(budget_usd=0),
        default_model=PRIMARY,
        models_factory=factory({PRIMARY: model}),
    )
    assert spent["status"] == "budget_spent" and not model.calls
    assert all(not a["can_answer"] for a in spent["answers"])
    none = await answer_builder_questions(
        request(), default_model=PRIMARY, models_factory=factory({})
    )
    assert none["status"] == "failed"
    assert all(not a["can_answer"] for a in none["answers"])


@pytest.mark.asyncio
async def test_both_models_failing_escalates_everything():
    out = await answer_builder_questions(
        request(),
        default_model=PRIMARY,
        models_factory=factory(
            {
                PRIMARY: FakeModel(PRIMARY, None, fail=True),
                BACKUP: FakeModel(BACKUP, None, fail=True),
            }
        ),
    )
    assert out["status"] == "failed"
    assert all(not a["can_answer"] for a in out["answers"])


def test_endpoint_returns_the_answers(monkeypatch):
    from app.core.config import settings
    from app.main import app

    async def fake(req, default_model):
        return {
            "status": "finished",
            "answers": [
                {
                    "question_id": "q1",
                    "can_answer": True,
                    "selected_option_ids": ["ro"],
                    "answer": "Read-only.",
                    "reason": "",
                }
            ],
            "estimated_cost_usd": 0.001,
            "model": PRIMARY,
            "error": None,
        }

    from app.api.v1.endpoints import pm_agent as endpoint

    monkeypatch.setattr(endpoint, "answer_builder_questions", fake)
    client = TestClient(app)
    res = client.post(
        "/api/v1/pm-agent/builder-answers",
        json=request().model_dump(),
        headers={"x-api-key": settings.API.X_API_KEY},
    )
    assert res.status_code == 200
    assert res.json()["answers"][0]["question_id"] == "q1"
