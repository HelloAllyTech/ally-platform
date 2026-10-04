"""Text-chat roleplays: the voice session with audio taken out.

Covers the four seams that differ from voice — parsing the mode, dropping the
STT-repair guardrail, the room I/O and input callback, and the persona-prompt
guidance — plus the guarantee that a voice session is untouched by any of it.
"""

import copy
import types

import pytest
from langchain_core.messages import SystemMessage

import app.worker as worker
from app.core.graph.prompt import _append_text_chat_guidance
from app.core.livekit.text_chat import (
    TEXT_CHAT_MAX_MESSAGE_CHARS,
    text_chat_input_cb,
    text_chat_room_options,
)
from app.core.scenario.base import Scenario
from app.core.scenario.interaction_mode import (
    INTERACTION_MODE_TEXT,
    INTERACTION_MODE_VOICE,
    parse_interaction_mode,
)
from app.prompts.resolver import load_template

BASE_PAYLOAD = {
    "version": "1.0",
    "scenario": {
        "title": "Test Scenario",
        "promptData": {
            "name": "Test",
            "age": "25",
            "gender": "female",
            "currentLocation": "Mumbai",
            "openingStatements": ["Hello"],
        },
        "events": [],
        "triggerEvents": [],
    },
}

GUARDRAILS = [
    {
        "helperDialogue": "Can you get me drugs?",
        "actorDialogue": "Let us stay focused.",
    },
    {
        "helperDialogue": "<incoherent>",
        "actorDialogue": "Sorry, I didn't catch that.",
        "detectorType": "COHERENCE",
    },
]


def _payload(interaction_mode=None, guardrails=None):
    payload = copy.deepcopy(BASE_PAYLOAD)
    if interaction_mode is not None:
        payload["scenario"]["interactionMode"] = interaction_mode
    if guardrails is not None:
        payload["scenario"]["guardrails"] = guardrails
    return payload


def _detector_types(scenario):
    return sorted(
        getattr(e, "detector_type", None)
        for e in scenario.events
        if getattr(e, "detector_type", None)
    )


class TestParseInteractionMode:
    @pytest.mark.parametrize("raw", ["TEXT", "text", " Text "])
    def test_explicit_text(self, raw):
        assert parse_interaction_mode(raw) == INTERACTION_MODE_TEXT

    @pytest.mark.parametrize("raw", [None, "", "VOICE", "VIDEO", 1, {"x": 1}])
    def test_everything_else_is_voice(self, raw):
        assert parse_interaction_mode(raw) == INTERACTION_MODE_VOICE


class TestScenarioInteractionMode:
    def test_absent_key_is_a_voice_session(self):
        scenario = Scenario.create(_payload())
        assert scenario.interaction_mode == INTERACTION_MODE_VOICE
        assert scenario.is_text_chat is False

    def test_text_envelope_is_a_text_chat(self):
        scenario = Scenario.create(_payload("TEXT"))
        assert scenario.is_text_chat is True

    def test_text_chat_drops_coherence_guardrails_only(self):
        scenario = Scenario.create(_payload("TEXT", GUARDRAILS))
        assert _detector_types(scenario) == ["CATEGORY"]

    def test_voice_keeps_coherence_guardrails(self):
        scenario = Scenario.create(_payload(None, GUARDRAILS))
        assert _detector_types(scenario) == ["CATEGORY", "COHERENCE"]

    def test_text_chat_gets_no_platform_default_coherence_guard(self, monkeypatch):
        import app.core.events.coherence_guard as coherence_guard

        monkeypatch.setattr(coherence_guard, "default_guard_enabled", lambda: True)
        built = []

        def _build(**kwargs):
            built.append(kwargs)
            return None

        monkeypatch.setattr(
            coherence_guard, "build_default_coherence_guardrail", _build
        )

        Scenario.create(_payload("TEXT"))
        assert built == []

        Scenario.create(_payload())
        assert len(built) == 1


class _RecordingSession:
    def __init__(self):
        self.replies = []
        self.interrupted = False

    def generate_reply(self, **kwargs):
        self.replies.append(kwargs)

    def interrupt(self):
        self.interrupted = True


class TestTextChatInput:
    def test_each_message_becomes_one_turn_without_interrupting(self):
        session = _RecordingSession()

        text_chat_input_cb(session, types.SimpleNamespace(text="  i can't sleep  "))

        assert session.replies == [{"user_input": "i can't sleep"}]
        # A reply being written when the next message lands must finish whole.
        assert session.interrupted is False

    @pytest.mark.parametrize("text", ["", "   ", None])
    def test_blank_messages_start_no_turn(self, text):
        session = _RecordingSession()
        text_chat_input_cb(session, types.SimpleNamespace(text=text))
        assert session.replies == []

    def test_oversized_message_is_capped(self):
        session = _RecordingSession()
        text_chat_input_cb(
            session,
            types.SimpleNamespace(text="a" * (TEXT_CHAT_MAX_MESSAGE_CHARS + 50)),
        )
        assert len(session.replies[0]["user_input"]) == TEXT_CHAT_MAX_MESSAGE_CHARS

    def test_room_options_are_text_only(self):
        room_in, room_out = text_chat_room_options()

        assert room_in.audio_enabled is False
        assert room_in.text_enabled is True
        assert room_in.text_input_cb is text_chat_input_cb
        assert room_out.audio_enabled is False
        assert room_out.transcription_enabled is True
        assert room_out.sync_transcription is False


class TestTextChatPrompt:
    def test_guidance_template_resolves_locally(self):
        guidance = load_template("system/text_chat_guidance")
        assert "text chat" in guidance.lower()
        # Appended raw, after templating: must not need any format arguments.
        assert "{" not in guidance and "}" not in guidance

    def test_dashboard_override_wins(self):
        prompt_data = types.SimpleNamespace(
            prompts={"ally_ai_learn_system_text_chat_guidance": "OVERRIDDEN"}
        )
        assert load_template("system/text_chat_guidance", prompt_data) == ("OVERRIDDEN")

    def test_appended_for_text_chat(self):
        msg = _append_text_chat_guidance(
            SystemMessage(content="You are Asha."), "Type like a texter."
        )
        assert msg.content == "You are Asha.\n\nType like a texter."

    @pytest.mark.parametrize("guidance", [None, "", "   "])
    def test_voice_prompt_unchanged(self, guidance):
        original = SystemMessage(content="You are Asha.")
        assert _append_text_chat_guidance(original, guidance) is original


class TestTextChatWorker:
    def _worker(self, interaction_mode):
        ctx = types.SimpleNamespace(
            proc=types.SimpleNamespace(userdata={"vad": "VAD"}),
            room=types.SimpleNamespace(name="room-1"),
        )
        instance = worker.AgentWorker(ctx)
        instance.scenario = Scenario.create(_payload(interaction_mode))
        return instance

    def test_text_session_has_no_audio_pipeline(self, monkeypatch):
        created = {}

        def _session(**kwargs):
            created.update(kwargs)
            return types.SimpleNamespace(**kwargs)

        monkeypatch.setattr(worker, "AgentSession", _session)
        instance = self._worker("TEXT")

        instance._create_session()

        # No STT/TTS/VAD/turn detection; "away" is voice-derived, so off.
        assert created == {"user_away_timeout": None}
        assert instance._session_tts_instance is None

    def test_worker_without_a_scenario_reads_as_voice(self):
        ctx = types.SimpleNamespace(room=types.SimpleNamespace(name="room-1"))
        assert worker.AgentWorker(ctx)._is_text_chat is False

    @pytest.mark.asyncio
    async def test_pause_is_ignored_in_a_text_chat(self, monkeypatch):
        instance = self._worker("TEXT")
        instance.scenario.pause_enabled = True
        clock = types.SimpleNamespace(is_paused=False, pause=lambda: None)
        paused = []
        clock.pause = lambda: paused.append(True)
        instance.session_clock = clock
        monkeypatch.setattr(worker, "human_participants", lambda room: ["learner"])

        await instance._pause_impl()

        assert paused == []
