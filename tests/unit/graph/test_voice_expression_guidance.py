"""Inline voice-expression guidance selection for non-v3 TTS providers.

Covers the three-way gate in `_resolve_voice_expression_guidance` (v3 audio
tags always-on; non-v3 opt-in performative-text / <break>) and the prompt
injection helper. The key safety property under test: break-tag guidance is
never selected for a provider that does not parse <break> (it would be spoken
aloud, since the reply reaches TTS unmodified).
"""

import types
from unittest.mock import Mock, patch

import pytest
from langchain_core.messages import SystemMessage

from app.core.graph.nodes import _resolve_voice_expression_guidance
from app.core.graph.prompt import (
    _TEXT_EXPRESSIVITY_GUIDANCE_HEADER,
    _append_text_expressivity_guidance,
)

_LT = "app.core.graph.nodes.load_template"


def _tts(text_enhancement=False, break_tags=False):
    tts = Mock()
    tts.supports_text_enhancement.return_value = text_enhancement
    tts.supports_break_tags.return_value = break_tags
    return tts


def _pd(performative=False, break_=False):
    return types.SimpleNamespace(
        enable_performative_text=performative,
        enable_break_tags=break_,
    )


@pytest.mark.unit
class TestResolveVoiceExpressionGuidance:
    def test_v3_returns_audio_tags_only_flags_ignored(self):
        # v3: audio tags always on; the non-v3 opt-in flags are irrelevant.
        with patch(_LT, side_effect=lambda path, pd: f"G::{path}"):
            audio, text = _resolve_voice_expression_guidance(
                _tts(text_enhancement=True), _pd(performative=True, break_=True)
            )
        assert audio == "G::system/audio_tag_guidance"
        assert text is None

    def test_non_v3_both_off_returns_nothing(self):
        with patch(_LT, side_effect=lambda path, pd: f"G::{path}") as lt:
            audio, text = _resolve_voice_expression_guidance(_tts(), _pd())
        assert (audio, text) == (None, None)
        lt.assert_not_called()

    def test_non_v3_performative_only(self):
        with patch(_LT, side_effect=lambda path, pd: f"G::{path}"):
            audio, text = _resolve_voice_expression_guidance(
                _tts(), _pd(performative=True)
            )
        assert audio is None
        assert text == "G::system/text_expressivity_guidance"

    def test_el_v2_break_only(self):
        with patch(_LT, side_effect=lambda path, pd: f"G::{path}"):
            audio, text = _resolve_voice_expression_guidance(
                _tts(break_tags=True), _pd(break_=True)
            )
        assert audio is None
        assert text == "G::system/break_tag_guidance"

    def test_non_el_break_flag_is_guarded(self):
        # Break flag ON but provider does NOT parse <break> → guidance NOT
        # loaded, so the literal token can never be spoken aloud.
        with patch(_LT, side_effect=lambda path, pd: f"G::{path}") as lt:
            audio, text = _resolve_voice_expression_guidance(
                _tts(break_tags=False), _pd(break_=True)
            )
        assert (audio, text) == (None, None)
        assert all("break_tag_guidance" not in c.args[0] for c in lt.call_args_list)

    def test_el_v2_both_flags_joined(self):
        with patch(_LT, side_effect=lambda path, pd: f"G::{path}"):
            audio, text = _resolve_voice_expression_guidance(
                _tts(break_tags=True), _pd(performative=True, break_=True)
            )
        assert audio is None
        assert text == (
            "G::system/text_expressivity_guidance\n\nG::system/break_tag_guidance"
        )

    def test_no_tts_client_returns_nothing(self):
        audio, text = _resolve_voice_expression_guidance(None, _pd(performative=True))
        assert (audio, text) == (None, None)


@pytest.mark.unit
class TestAppendTextExpressivityGuidance:
    def test_appends_header_and_instructions(self):
        out = _append_text_expressivity_guidance(
            SystemMessage(content="PERSONA"), "USE ELLIPSES"
        )
        assert out.content.startswith("PERSONA")
        assert "USE ELLIPSES" in out.content
        header_title = _TEXT_EXPRESSIVITY_GUIDANCE_HEADER.strip().splitlines()[0]
        assert header_title in out.content

    def test_none_returns_message_unchanged(self):
        msg = SystemMessage(content="PERSONA")
        assert _append_text_expressivity_guidance(msg, None) is msg

    def test_blank_returns_message_unchanged(self):
        msg = SystemMessage(content="PERSONA")
        assert _append_text_expressivity_guidance(msg, "   ") is msg
