"""Contract tests for the Ally guide wire format.

The schema lives in ally-be (src/guide/contract/guide-contract.schema.json) and
app/core/guide/contract.py is generated from it. ally-be's own contract test
fails when this generated file is stale; these tests make sure the generated
pydantic models actually accept what ally-be sends.
"""

import json
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from app.core.guide.contract import (
    GUIDE_CONTRACT_VERSION,
    GuideEvent,
    GuideVoiceFrame,
    GuideVoiceFrameDone,
    GuideVoiceTurnRequest,
)

FIXTURES = (
    Path(__file__).resolve().parents[4]
    / "ally-be"
    / "src"
    / "guide"
    / "contract"
    / "fixtures"
)


def _valid(name: str) -> list[dict]:
    return json.loads((FIXTURES / name).read_text())["valid"]


def test_contract_version():
    assert GUIDE_CONTRACT_VERSION == 1


@pytest.mark.parametrize("frame", _valid("voice-frames.json"))
def test_voice_frames_parse(frame):
    parsed = TypeAdapter(GuideVoiceFrame).validate_python(frame)
    assert parsed.type == frame["type"]


@pytest.mark.parametrize("request_body", _valid("voice-turn-request.json"))
def test_voice_turn_request_round_trips_with_wire_names(request_body):
    parsed = GuideVoiceTurnRequest.model_validate(request_body)
    dumped = parsed.model_dump(by_alias=True, exclude_none=True)
    assert dumped == request_body


@pytest.mark.parametrize("event", _valid("events.json"))
def test_events_parse_to_their_own_class(event):
    parsed = TypeAdapter(GuideEvent).validate_python(event)
    assert parsed.type == event["type"]


def test_done_frame_exposes_snake_case_fields():
    frame = TypeAdapter(GuideVoiceFrame).validate_python(
        {"type": "done", "turnId": "u1", "messageId": "m1"}
    )
    assert isinstance(frame, GuideVoiceFrameDone)
    assert frame.turn_id == "u1"
    assert frame.message_id == "m1"


def test_unknown_frame_type_is_rejected():
    with pytest.raises(ValidationError):
        TypeAdapter(GuideVoiceFrame).validate_python({"type": "teapot"})
