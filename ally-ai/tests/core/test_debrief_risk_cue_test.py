"""A risk-cue option's own test: every example cue found, no example non-cue flagged clear."""

import pytest

from app.core.debrief import risk_cue_test as t
from app.core.debrief.safety_reader import RiskCue, SafetyReading


def cue(turn=2, category="suicide_or_self_harm", strength="clear", quote="x"):
    return RiskCue(
        quote=quote,
        category=category,
        strength=strength,
        turn_index=turn,
        learner_response="explored",
        response_turn_index=3,
    )


def reader(by_line):
    """A Safety reader that answers by the character's line."""

    async def fake(transcript, language, **kwargs):
        line = transcript[1].text
        cues = by_line.get(line, [])
        return SafetyReading(risk_cues=cues), "m"

    return fake


@pytest.mark.asyncio
async def test_passes_when_cues_found_and_non_cues_clean(monkeypatch):
    monkeypatch.setattr(
        t,
        "read_safety",
        reader({"I want to end it": [cue()], "I am tired of the pain": [cue(strength="possible", category="hopelessness")]}),
    )
    out = await t.run_risk_cue_test(["I want to end it"], ["I am tired of the pain"], reps=2)
    assert out["passed"] is True
    assert len(out["reps"]) == 2 and out["cue_examples"] == 1 and out["non_cue_examples"] == 1


@pytest.mark.asyncio
async def test_fails_when_an_example_cue_is_missed(monkeypatch):
    monkeypatch.setattr(t, "read_safety", reader({}))
    out = await t.run_risk_cue_test(["I want to end it"], ["fine"], reps=1)
    assert out["passed"] is False
    assert out["reps"][0]["missed"] == ["I want to end it"]


@pytest.mark.asyncio
async def test_fails_when_a_non_cue_is_flagged_clear(monkeypatch):
    monkeypatch.setattr(
        t, "read_safety", reader({"I will die peacefully at home": [cue()], "I want to end it": [cue()]})
    )
    out = await t.run_risk_cue_test(["I want to end it"], ["I will die peacefully at home"], reps=1)
    assert out["passed"] is False
    assert out["reps"][0]["false_clear"] == ["I will die peacefully at home"]


@pytest.mark.asyncio
async def test_needs_both_kinds_of_example_and_a_reader_answer(monkeypatch):
    monkeypatch.setattr(t, "read_safety", reader({"a": [cue()]}))
    assert (await t.run_risk_cue_test(["a"], [], reps=1))["passed"] is False
    assert (await t.run_risk_cue_test([], ["b"], reps=1))["passed"] is False

    async def silent(transcript, language, **kwargs):
        return None, "m"

    monkeypatch.setattr(t, "read_safety", silent)
    out = await t.run_risk_cue_test(["a"], ["b"], reps=1)
    assert out["passed"] is False and out["reps"][0]["false_clear"]


@pytest.mark.asyncio
async def test_a_word_list_that_may_not_raise_leaves_a_possible_cue_possible(monkeypatch):
    # "I want to die" is on the word list; with the list off the reader's "possible" stands.
    line = "I want to die"
    monkeypatch.setattr(t, "read_safety", reader({line: [cue(strength="possible", category="hopelessness", quote=line)]}))
    on = await t.run_risk_cue_test(["a"], [line], word_list_raises=True, reps=1)
    off = await t.run_risk_cue_test(["a"], [line], word_list_raises=False, reps=1)
    assert on["reps"][0]["false_clear"] == [line]
    assert off["reps"][0]["false_clear"] == []
