"""Change by chat (chunk 20a-2): the model proposes, code builds before and after and
keeps safety out of reach."""

import pytest

from app.core.builder import change
from app.core.builder.change import (
    ChangeOut,
    ChangeRequest,
    CurrentAssistant,
    build_changes,
    weakens_safety,
)

META = {"provider": "openai", "model": "gpt-5-mini"}
NOW = CurrentAssistant(
    assistant_name="Sunrise assistant",
    introduction="Hi, I'm the Sunrise assistant.",
    tone="warm",
    instructions="Answer questions about Sunrise Mind.",
    decline_text="Please call +91 20 0000 4400.",
    suggested_questions=["How much is a session?"],
    own_rules=["Quote prices for group sessions"],
    avoid_topics=[],
)


def request(text):
    return ChangeRequest(request=text, current=NOW, safety_rules=["No diagnosis."])


def test_make_it_more_formal_is_a_tone_change():
    out = ChangeOut(reply="I'd make it formal.", tone="formal")
    result = build_changes(request("make it more formal"), out)
    assert [(c.field, c.before, c.after) for c in result.changes] == [
        ("tone", "warm", "formal")
    ]
    assert result.reply == "I'd make it formal."


def test_dont_discuss_prices_adds_a_topic_to_avoid_only_once():
    out = ChangeOut(avoid_topics=["prices", "prices"])
    result = build_changes(request("don't discuss prices"), out)
    assert [(c.field, c.after) for c in result.changes] == [("avoid_topic", "prices")]


def test_rules_only_add_and_never_repeat():
    out = ChangeOut(new_rules=["Quote prices for group sessions", "Give legal advice"])
    result = build_changes(request("never give legal advice"), out)
    assert [(c.field, c.after) for c in result.changes] == [
        ("add_rule", "Give legal advice")
    ]


@pytest.mark.parametrize(
    "text",
    [
        "turn off the crisis rules",
        "remove the disclaimer",
        "stop sending the helpline",
        "disable safety for this bot",
        "skip the consent question",
    ],
)
def test_weakening_safety_is_refused_whatever_the_model_says(text):
    assert weakens_safety(text)
    result = build_changes(request(text), ChangeOut(tone="formal"))
    assert result.refused and result.changes == []


def test_ordinary_requests_are_not_refused():
    for text in ["make it more formal", "add Hindi", "don't discuss prices"]:
        assert not weakens_safety(text)


def test_no_new_numbers_or_unchanged_fields():
    out = ChangeOut(
        decline_text="Please call 98765 43210.",
        introduction=NOW.introduction,
        language="",
    )
    assert build_changes(request("change the number"), out).changes == []


@pytest.mark.asyncio
async def test_a_refused_request_makes_no_model_call(monkeypatch):
    async def boom(**_):
        raise AssertionError("no call")

    monkeypatch.setattr(change, "generate_structured", boom)
    result = await change.propose_change(request("turn off the crisis rules"))
    assert result.refused


def test_contract_matches_the_default_prompt():
    from app.prompts.contracts import BuilderChangeInputs
    from app.prompts.resolver import load_and_format

    fields = set(BuilderChangeInputs.model_fields)
    rendered = load_and_format(
        "builder/change", prompts=None, **{f: f"<{f}>" for f in fields}
    )
    for f in fields:
        assert f"<{f}>" in rendered
