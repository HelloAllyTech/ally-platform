"""Checkup questions: the model phrases, code keeps the source (chunk 20a-2)."""

import pytest

from app.core.checkup import questions
from app.schemas.checkup import LearnedDetail, QuestionsRequest

META = {"provider": "openai", "model": "gpt-5-mini"}

REQUEST = QuestionsRequest(
    business="Sunrise Mind Clinic",
    facts=[
        LearnedDetail(
            id="f1", section="services", text="A first consultation is Rs. 1,800."
        ),
        LearnedDetail(id="f2", section="hours", text="Closed on Sundays."),
    ],
    count=5,
)


class FakeLLM:
    def __init__(self, output):
        self.output = output
        self.prompts = []

    async def __call__(self, *, schema, prompt, **kwargs):
        self.prompts.append(prompt)
        return schema.model_validate(self.output), META


@pytest.mark.asyncio
async def test_questions_keep_their_details_and_unsourced_ones_are_dropped(
    monkeypatch,
):
    fake = FakeLLM(
        {
            "questions": [
                {"question": "How much is a first session?", "fact_ids": ["f1"]},
                {"question": "Are you open on Sunday?", "fact_ids": ["f2", "f2"]},
                {"question": "Do you take insurance?", "fact_ids": ["f9"]},
                {"question": "Where are you?", "fact_ids": []},
                {"question": "how much is a first session?", "fact_ids": ["f1"]},
            ]
        }
    )
    monkeypatch.setattr(questions, "generate_structured", fake)
    result = await questions.write_questions(REQUEST)
    assert [(q.question, q.fact_ids) for q in result.questions] == [
        ("How much is a first session?", ["f1"]),
        ("Are you open on Sunday?", ["f2"]),
    ]
    assert result.dropped == 3
    assert "[f1] (services) A first consultation is Rs. 1,800." in fake.prompts[0]


@pytest.mark.asyncio
async def test_no_details_no_call(monkeypatch):
    async def boom(**_):
        raise AssertionError("no call expected")

    monkeypatch.setattr(questions, "generate_structured", boom)
    result = await questions.write_questions(REQUEST.model_copy(update={"facts": []}))
    assert result.questions == []


def test_contract_matches_the_default_prompt():
    from app.prompts.contracts import CheckupQuestionsInputs
    from app.prompts.resolver import load_and_format

    fields = set(CheckupQuestionsInputs.model_fields)
    rendered = load_and_format(
        "checkup/questions", prompts=None, **{f: f"<{f}>" for f in fields}
    )
    for f in fields:
        assert f"<{f}>" in rendered
