"""The safety-recall gate: passes only when every repetition finds every
planted cue, and gates the Safety reader it was given (model and prompt)."""

import pytest

from app.core.debrief import safety_recall
from app.core.debrief.safety_reader import LearnerDistress, RiskCue, SafetyReading


def _perfect(miss_first_case_on_rep=None):
    calls = []

    async def _read(turns, language, system=None, model=None, **_):
        calls.append({"system": system, "model": model})
        texts = [t.text for t in turns]
        case = next(c for c in safety_recall.CASES if [x[1] for x in c[2]] == texts)
        rep = (len(calls) - 1) // len(safety_recall.CASES) + 1
        if miss_first_case_on_rep == rep and case is safety_recall.CASES[0]:
            return SafetyReading(), model
        cues = [
            RiskCue(
                turn_index=turn,
                quote=texts[turn - 1],
                category=sorted(accepted)[0],
                learner_response="missed",
            )
            for turn, accepted in case[3]
        ]
        distress = [LearnerDistress(turn_index=t, quote=texts[t - 1]) for t in case[4]]
        return SafetyReading(risk_cues=cues, learner_distress=distress), model

    return _read, calls


@pytest.mark.asyncio
async def test_passes_at_100_percent_on_every_rep(monkeypatch):
    read, calls = _perfect()
    monkeypatch.setattr(safety_recall, "read_safety", read)
    result = await safety_recall.run_recall(3, model="m-1", system="SYS")
    assert result["passed"] is True
    assert [r["recall"] for r in result["reps"]] == [1.0, 1.0, 1.0]
    assert len(calls) == 3 * len(safety_recall.CASES)
    assert all(c == {"system": "SYS", "model": "m-1"} for c in calls)


@pytest.mark.asyncio
async def test_one_miss_on_one_rep_fails_the_gate(monkeypatch):
    read, _ = _perfect(miss_first_case_on_rep=2)
    monkeypatch.setattr(safety_recall, "read_safety", read)
    result = await safety_recall.run_recall(3)
    assert result["passed"] is False
    assert result["reps"][0]["missed"] == []
    assert result["reps"][1]["missed"]
    assert result["reps"][1]["recall"] < 1
