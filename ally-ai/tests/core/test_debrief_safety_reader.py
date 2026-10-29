"""The Safety reader: a missing answer is never a safe session, and a cue must
point at a real turn of the right speaker."""

import pytest
from fastapi.testclient import TestClient

from app.core.debrief.safety_reader import (
    LearnerDistress,
    RiskCue,
    SafetyReading,
    TranscriptTurn,
    build_prompt,
)

TRANSCRIPT = [
    TranscriptTurn(turn_index=1, role="counselor", text="How are you?"),
    TranscriptTurn(turn_index=2, role="client", text="There's no point any more."),
    TranscriptTurn(
        turn_index=3, role="counselor", text="Sorry, this is close to home."
    ),
]


@pytest.fixture
def dispatch_returns(monkeypatch):
    from app.core.llm import dispatch

    calls = {}

    def _set(output):
        async def _fake(**kwargs):
            calls.update(kwargs)
            return output, {
                "provider": "gemini",
                "model": "gemini-2.5-flash",
                "fell_back_from": None,
            }

        monkeypatch.setattr(dispatch, "generate_structured", _fake)
        return calls

    return _set


def test_prompt_marks_speakers_and_wraps_data():
    p = build_prompt(TRANSCRIPT, "hi")
    assert "[turn 2] CLIENT: There's no point any more." in p
    assert "[turn 1] COUNSELLOR: How are you?" in p
    assert "<transcript>" in p and "SESSION LANGUAGE: hi" in p
    assert build_prompt(TRANSCRIPT, "en", system="LIVE").startswith("LIVE")


@pytest.mark.asyncio
async def test_keeps_cues_on_client_turns_and_distress_on_learner_turns(
    dispatch_returns,
):
    from app.core.debrief.safety_reader import read_safety

    calls = dispatch_returns(
        SafetyReading(
            risk_cues=[
                RiskCue(
                    turn_index=2,
                    quote="no point",
                    category="hopelessness",
                    learner_response="missed",
                ),
                # A learner turn is not a client cue, and turn 9 does not exist.
                RiskCue(
                    turn_index=3,
                    quote="x",
                    category="hopelessness",
                    learner_response="missed",
                ),
                RiskCue(
                    turn_index=9,
                    quote="x",
                    category="hopelessness",
                    learner_response="missed",
                ),
            ],
            learner_distress=[
                LearnerDistress(turn_index=3, quote="close to home"),
                LearnerDistress(turn_index=2, quote="client turn"),
            ],
        )
    )
    reading, model = await read_safety(TRANSCRIPT, "en", scenario_session_id="s1")
    assert [c.turn_index for c in reading.risk_cues] == [2]
    assert [d.turn_index for d in reading.learner_distress] == [3]
    assert model == "gemini-2.5-flash"
    assert calls["task"] == "debrief_safety_reader"
    assert calls["never_fallback"] is True
    assert calls["scenario_session_id"] == "s1"


@pytest.mark.asyncio
async def test_no_answer_is_none_not_an_empty_reading(dispatch_returns):
    from app.core.debrief.safety_reader import read_safety

    dispatch_returns(None)
    reading, _ = await read_safety(TRANSCRIPT, "en")
    assert reading is None


class TestEndpoint:
    @pytest.fixture
    def client(self):
        from app.core.config import settings
        from app.main import app

        c = TestClient(app)
        c.headers.update({"x-api-key": settings.API.X_API_KEY})
        return c

    def _body(self):
        return {
            "transcript": [t.model_dump() for t in TRANSCRIPT],
            "language": "en",
        }

    def test_no_usable_answer_is_a_502(self, client, dispatch_returns):
        dispatch_returns(None)
        r = client.post("/api/v1/debrief/safety-reader", json=self._body())
        assert r.status_code == 502

    def test_returns_the_reading(self, client, dispatch_returns):
        dispatch_returns(
            SafetyReading(
                risk_cues=[
                    RiskCue(
                        turn_index=2,
                        quote="no point",
                        category="hopelessness",
                        learner_response="missed",
                    )
                ]
            )
        )
        r = client.post("/api/v1/debrief/safety-reader", json=self._body())
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["risk_cues"][0]["turn_index"] == 2
        assert body["learner_distress"] == []
