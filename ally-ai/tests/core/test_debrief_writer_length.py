"""The Writer is told the total length, in a code-owned rule that no Skills Store
prompt text can drop (ally-be's total-length check is advisory and live debriefs
broke it because only each card's own limit was ever stated)."""

import pytest

from app.core.debrief.safety_reader import TranscriptTurn
from app.core.debrief.schemas import DebriefCards
from app.core.debrief.steps import (
    DEBRIEF_MAX_WORDS,
    SHORT_DEBRIEF_MAX_WORDS,
    _length_line,
    write,
)

TRANSCRIPT = [
    TranscriptTurn(turn_index=1, role="counselor", text="What brings you in today?"),
    TranscriptTurn(turn_index=2, role="client", text="I don't see the point anymore."),
]
SAFETY = {"risk_cues": [], "learner_distress": []}


@pytest.fixture
def prompt_sent(monkeypatch):
    from app.core.llm import dispatch

    calls = {}

    async def _fake(**kwargs):
        calls.update(kwargs)
        return DebriefCards(opening="Hi"), {
            "provider": "gemini",
            "model": "gemini-2.5-pro",
            "fell_back_from": None,
        }

    monkeypatch.setattr(dispatch, "generate_structured", _fake)
    return calls


def test_the_limits_match_ally_bes_checks():
    # ally-be: DEBRIEF_MAX_WORDS / SHORT_DEBRIEF_MAX_WORDS in debrief-cards.util.ts
    assert DEBRIEF_MAX_WORDS == 220
    assert SHORT_DEBRIEF_MAX_WORDS == 120


def test_the_line_names_the_total_and_what_is_not_counted():
    standard = _length_line(False)
    assert "at most 220 words" in standard
    assert "practise_next" in standard and "not counted" in standard
    assert "at most 120 words" in _length_line(True)


@pytest.mark.asyncio
async def test_a_standard_writer_prompt_carries_the_220_word_total(prompt_sent):
    await write({}, SAFETY, "en", "gemini-3-flash-preview", TRANSCRIPT)
    assert "LENGTH:" in prompt_sent["prompt"]
    assert "at most 220 words" in prompt_sent["prompt"]


@pytest.mark.asyncio
async def test_a_short_session_gets_the_120_word_total(prompt_sent):
    await write({}, SAFETY, "en", "gemini-3-flash-preview", TRANSCRIPT, short=True)
    assert "at most 120 words" in prompt_sent["prompt"]
    assert "at most 220 words" not in prompt_sent["prompt"]


@pytest.mark.asyncio
async def test_the_rule_survives_a_custom_prompt_text(prompt_sent):
    """A Skills Store prompt that never mentions length still carries the rule,
    because it rides in the code-owned checked rules."""
    custom = (
        "Write the debrief.\n{{checked_rules}}\nTRANSCRIPT: {{transcript}}\n"
        "RISK CUE DEFINITION: {{risk_cue_definition}}\n"
        "RISK CUES TO COVER: {{risk_cue_turns}}\nSAFETY: {{safety_reading}}"
    )
    await write({}, SAFETY, "en", "gemini-3-flash-preview", TRANSCRIPT, system=custom)
    assert "at most 220 words" in prompt_sent["prompt"]
