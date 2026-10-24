"""Recognising and pacing the fixed crisis message."""

import re
from pathlib import Path

import pytest

from app.core.guide.crisis import (
    DEFAULT_CRISIS_STAY_TEXT,
    DEFAULT_CRISIS_TEXT,
    SpeakingRate,
    is_fixed_crisis_text,
    silence,
    split_sentences,
)

FIXED_RESPONSES = (
    Path(__file__).resolve().parents[4]
    / "ally-be"
    / "src"
    / "guide"
    / "safety"
    / "fixed-responses.ts"
)
_LITERAL = re.compile(r"\"((?:[^\"\\]|\\.)*)\"|'((?:[^'\\]|\\.)*)'")


def _ts_string_constant(source: str, name: str) -> str:
    """A `export const NAME = 'a' + "b" + ...;` string, concatenated."""
    match = re.search(rf"export const {name} =(.*?);", source, re.S)
    assert match, f"{name} not found in fixed-responses.ts"
    parts = []
    for double, single in _LITERAL.findall(match.group(1)):
        raw = double if double or not single else single
        parts.append(re.sub(r"\\(.)", r"\1", raw))
    return "".join(parts)


@pytest.mark.skipif(not FIXED_RESPONSES.exists(), reason="ally-be not checked out")
@pytest.mark.parametrize(
    "name, ours",
    [
        ("DEFAULT_CRISIS_TEXT", DEFAULT_CRISIS_TEXT),
        ("DEFAULT_CRISIS_STAY_TEXT", DEFAULT_CRISIS_STAY_TEXT),
    ],
)
def test_crisis_copy_matches_ally_be(name, ours):
    # If this fails, ally-be's fixed crisis copy changed: mirror it in
    # app/core/guide/crisis.py, or the worker stops pacing it.
    source = FIXED_RESPONSES.read_text(encoding="utf-8")
    assert _ts_string_constant(source, name) == ours


@pytest.mark.parametrize("text", [DEFAULT_CRISIS_TEXT, DEFAULT_CRISIS_STAY_TEXT])
def test_fixed_crisis_text_is_recognised(text):
    assert is_fixed_crisis_text(text)
    assert is_fixed_crisis_text("  " + text.replace("'", "’") + "\n")


@pytest.mark.parametrize(
    "text",
    [
        "",
        "If you are in immediate danger, call 112.",
        DEFAULT_CRISIS_TEXT[:-10],
        "Tele-MANAS is a helpline you can mention to clients.",
    ],
)
def test_ordinary_replies_are_not_paced(text):
    assert not is_fixed_crisis_text(text)


def test_split_sentences_handles_latin_and_danda():
    assert split_sentences("One. Two? Three!  Four") == [
        "One.",
        "Two?",
        "Three!",
        "Four",
    ]
    assert split_sentences("पहला वाक्य। दूसरा वाक्य।") == [
        "पहला वाक्य।",
        "दूसरा वाक्य।",
    ]
    assert len(split_sentences(DEFAULT_CRISIS_TEXT)) == 5


def test_silence_is_cut_into_small_frames():
    frames = silence(24000, 1, 0.25)
    assert sum(f.samples_per_channel for f in frames) == 6000
    assert max(f.samples_per_channel for f in frames) == 2400
    assert all(not any(bytes(f.data)) for f in frames)
    assert silence(24000, 1, 0) == []


class _Opts:
    speaking_rate = 1.0


class _GoogleLikeTTS:
    def __init__(self):
        self._opts = _Opts()
        self.calls = []

    def update_options(self, *, speaking_rate):
        self.calls.append(speaking_rate)
        self._opts.speaking_rate = speaking_rate


def test_speaking_rate_is_slowed_then_restored():
    tts = _GoogleLikeTTS()
    with SpeakingRate(tts).slowed(0.85) as slowed:
        assert slowed is True
        assert tts._opts.speaking_rate == 0.85
    assert tts.calls == [0.85, 1.0]


def test_speaking_rate_is_restored_when_the_message_is_cut_off():
    tts = _GoogleLikeTTS()
    with pytest.raises(RuntimeError):
        with SpeakingRate(tts).slowed(0.85):
            raise RuntimeError("interrupted")
    assert tts._opts.speaking_rate == 1.0


def test_speaking_rate_is_a_no_op_for_voices_without_one():
    class Plain:
        pass

    with SpeakingRate(Plain()).slowed(0.85) as slowed:
        assert slowed is False
