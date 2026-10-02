"""Tests for the predictive interim reply (latency mask).

Two layers:
  * the pure ``app.core.livekit.interim_reply`` module — gate + fast-model
    generation (best-effort, never raises);
  * the worker's per-turn state machine — the trigger gate, partial-transcript
    accumulation, cutover, and reset — exercised on a bare ``AgentWorker``.
"""

import asyncio
import time
import types
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage

import app.worker as worker
from app.core.livekit import interim_reply


# ---------------------------------------------------------------------------
# Module: is_interim_reply_enabled
# ---------------------------------------------------------------------------
class TestIsInterimReplyEnabled:
    """Gated by the global kill-switch AND the per-simulation toggle."""

    @staticmethod
    def _scenario(interim_reply_enabled):
        return types.SimpleNamespace(
            prompt_data=types.SimpleNamespace(
                interim_reply_enabled=interim_reply_enabled
            )
        )

    @pytest.mark.unit
    def test_enabled_when_global_and_per_sim_on(self, monkeypatch):
        monkeypatch.setattr(
            interim_reply.settings, "INTERIM_REPLY_GLOBALLY_ENABLED", True
        )
        assert interim_reply.is_interim_reply_enabled(self._scenario(True)) is True

    @pytest.mark.unit
    def test_disabled_by_default_per_sim_off(self, monkeypatch):
        monkeypatch.setattr(
            interim_reply.settings, "INTERIM_REPLY_GLOBALLY_ENABLED", True
        )
        assert interim_reply.is_interim_reply_enabled(self._scenario(False)) is False

    @pytest.mark.unit
    def test_disabled_when_global_flag_off(self, monkeypatch):
        monkeypatch.setattr(
            interim_reply.settings, "INTERIM_REPLY_GLOBALLY_ENABLED", False
        )
        assert interim_reply.is_interim_reply_enabled(self._scenario(True)) is False

    @pytest.mark.unit
    def test_disabled_when_prompt_data_missing(self, monkeypatch):
        monkeypatch.setattr(
            interim_reply.settings, "INTERIM_REPLY_GLOBALLY_ENABLED", True
        )
        assert interim_reply.is_interim_reply_enabled(types.SimpleNamespace()) is False


def _make_scenario(language_code="hi-IN", language_label="Hindi"):
    prompt_data = types.SimpleNamespace(
        title="Grief support",
        name="Meera",
        profession="Caller",
        description="A recently bereaved caller",
        context="A helpline call",
        role_instructions="Speak softly",
        language_label=language_label,
    )
    language_config = types.SimpleNamespace(language_code=language_code)
    return types.SimpleNamespace(
        prompt_data=prompt_data, language_config=language_config
    )


# ---------------------------------------------------------------------------
# Module: helpers
# ---------------------------------------------------------------------------
class TestBuildScenarioContext:
    @pytest.mark.unit
    def test_includes_present_fields(self):
        ctx = interim_reply._build_scenario_context(_make_scenario())
        assert "Character: Meera" in ctx
        assert "Profession: Caller" in ctx

    @pytest.mark.unit
    def test_empty_when_no_prompt_data(self):
        assert interim_reply._build_scenario_context(types.SimpleNamespace()) == ""


class TestFormatHistory:
    @pytest.mark.unit
    def test_renders_recent_turns_with_roles(self):
        msgs = [
            HumanMessage(content="I lost my father last week."),
            AIMessage(content="I'm so sorry."),
            HumanMessage(content="I don't know what to do."),
        ]
        out = interim_reply._format_history(msgs, window=10)
        assert "COUNSELLOR: I lost my father last week." in out
        assert "CHARACTER: I'm so sorry." in out

    @pytest.mark.unit
    def test_window_zero_is_empty(self):
        msgs = [HumanMessage(content="hello")]
        assert interim_reply._format_history(msgs, window=0) == ""


# ---------------------------------------------------------------------------
# Module: generate_interim_reply
# ---------------------------------------------------------------------------
class TestGenerateInterimReply:
    """Fast-model generation — best-effort, never raises, returns None on failure."""

    @pytest.mark.unit
    async def test_returns_none_without_client(self):
        out = await interim_reply.generate_interim_reply(
            None, _make_scenario(), [], "I have been feeling very low lately"
        )
        assert out is None

    @pytest.mark.unit
    async def test_returns_none_for_empty_partial(self):
        out = await interim_reply.generate_interim_reply(
            MagicMock(), _make_scenario(), [], "   "
        )
        assert out is None

    @pytest.mark.unit
    async def test_returns_reply_text(self, monkeypatch):
        monkeypatch.setattr(interim_reply, "load_and_format", lambda *a, **k: "SYS")
        structured = MagicMock()
        structured.ainvoke = AsyncMock(
            return_value=types.SimpleNamespace(reply="  Mm, I'm taking that in.  ")
        )
        llm_instance = MagicMock()
        llm_instance.with_structured_output = MagicMock(return_value=structured)
        client = types.SimpleNamespace(llm_instance=llm_instance)

        out = await interim_reply.generate_interim_reply(
            client, _make_scenario(), [], "I have been feeling very low lately"
        )
        assert out == "Mm, I'm taking that in."

    @pytest.mark.unit
    async def test_empty_reply_returns_none(self, monkeypatch):
        monkeypatch.setattr(interim_reply, "load_and_format", lambda *a, **k: "SYS")
        structured = MagicMock()
        structured.ainvoke = AsyncMock(return_value=types.SimpleNamespace(reply="   "))
        llm_instance = MagicMock()
        llm_instance.with_structured_output = MagicMock(return_value=structured)
        client = types.SimpleNamespace(llm_instance=llm_instance)

        out = await interim_reply.generate_interim_reply(
            client, _make_scenario(), [], "some long enough partial text here"
        )
        assert out is None

    @pytest.mark.unit
    async def test_non_str_reply_returns_none(self, monkeypatch):
        monkeypatch.setattr(interim_reply, "load_and_format", lambda *a, **k: "SYS")
        structured = MagicMock()
        structured.ainvoke = AsyncMock(return_value=types.SimpleNamespace(reply=42))
        llm_instance = MagicMock()
        llm_instance.with_structured_output = MagicMock(return_value=structured)
        client = types.SimpleNamespace(llm_instance=llm_instance)

        out = await interim_reply.generate_interim_reply(
            client, _make_scenario(), [], "some long enough partial text here"
        )
        assert out is None

    @pytest.mark.unit
    async def test_empty_template_returns_none(self, monkeypatch):
        monkeypatch.setattr(interim_reply, "load_and_format", lambda *a, **k: "")
        client = types.SimpleNamespace(llm_instance=MagicMock())
        out = await interim_reply.generate_interim_reply(
            client, _make_scenario(), [], "some long enough partial text here"
        )
        assert out is None

    @pytest.mark.unit
    async def test_never_raises_on_llm_error(self, monkeypatch):
        monkeypatch.setattr(interim_reply, "load_and_format", lambda *a, **k: "SYS")

        def boom(*_a, **_k):
            raise RuntimeError("llm down")

        llm_instance = MagicMock()
        llm_instance.with_structured_output = boom
        client = types.SimpleNamespace(llm_instance=llm_instance)

        out = await interim_reply.generate_interim_reply(
            client, _make_scenario(), [], "some long enough partial text here"
        )
        assert out is None

    @pytest.mark.unit
    async def test_timeout_returns_none(self, monkeypatch):
        monkeypatch.setattr(interim_reply, "load_and_format", lambda *a, **k: "SYS")
        monkeypatch.setattr(
            interim_reply.settings, "INTERIM_REPLY_LLM_TIMEOUT_MS", 30.0
        )

        async def slow(*_a, **_k):
            await asyncio.sleep(0.5)
            return types.SimpleNamespace(reply="too late")

        structured = MagicMock()
        structured.ainvoke = slow
        llm_instance = MagicMock()
        llm_instance.with_structured_output = MagicMock(return_value=structured)
        client = types.SimpleNamespace(llm_instance=llm_instance)

        out = await interim_reply.generate_interim_reply(
            client, _make_scenario(), [], "some long enough partial text here"
        )
        assert out is None


# ---------------------------------------------------------------------------
# Worker state machine
# ---------------------------------------------------------------------------
class _MockCtx:
    def __init__(self):
        self.room = types.SimpleNamespace(name="room-1")
        self.proc = types.SimpleNamespace(userdata={})
        self.job = types.SimpleNamespace(metadata="{}", id="test-job")


def _interim_worker(monkeypatch, *, trigger_ms=6000.0, min_words=8):
    """A bare AgentWorker wired up just enough to exercise interim logic."""
    w = worker.AgentWorker(_MockCtx())
    w._interim_enabled = True
    w._bg_audio = MagicMock()
    w.session = MagicMock()
    monkeypatch.setattr(worker.settings, "INTERIM_REPLY_TRIGGER_MS", trigger_ms)
    monkeypatch.setattr(worker.settings, "INTERIM_REPLY_MIN_WORDS", min_words)
    return w


def _interim_event(text, is_final=False):
    return types.SimpleNamespace(transcript=text, is_final=is_final)


class TestTriggerGate:
    """Arm generation only when the learner has spoken long enough AND enough words."""

    @pytest.mark.unit
    async def test_arms_when_time_and_words_pass(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        calls = []
        w._interim_generate = lambda partial: (calls.append(partial), asyncio.sleep(0))[
            1
        ]
        # Learner has been speaking for 7s (> 6s trigger).
        w._user_turn_start_monotonic = time.monotonic() - 7.0

        w._on_user_input_transcribed(
            _interim_event("I have been feeling really low and lost lately about this")
        )

        assert w._interim_armed is True
        assert w._interim_state == "generating"
        assert len(calls) == 1
        await asyncio.sleep(0.01)  # let the stub task settle

    @pytest.mark.unit
    async def test_no_arm_on_short_turn(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        calls = []
        w._interim_generate = lambda partial: (calls.append(partial), asyncio.sleep(0))[
            1
        ]
        # Only 2s of speech so far.
        w._user_turn_start_monotonic = time.monotonic() - 2.0

        w._on_user_input_transcribed(
            _interim_event("plenty of words here but the turn is still far too short")
        )

        assert w._interim_armed is False
        assert w._interim_state == "idle"
        assert calls == []

    @pytest.mark.unit
    async def test_no_arm_when_too_few_words(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        calls = []
        w._interim_generate = lambda partial: (calls.append(partial), asyncio.sleep(0))[
            1
        ]
        w._user_turn_start_monotonic = time.monotonic() - 7.0

        w._on_user_input_transcribed(_interim_event("only three words"))

        assert w._interim_armed is False
        assert w._interim_state == "idle"
        assert calls == []

    @pytest.mark.unit
    async def test_arms_only_once(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        calls = []
        w._interim_generate = lambda partial: (calls.append(partial), asyncio.sleep(0))[
            1
        ]
        w._user_turn_start_monotonic = time.monotonic() - 7.0

        long_text = "I have been feeling really low and lost lately about everything"
        w._on_user_input_transcribed(_interim_event(long_text))
        w._on_user_input_transcribed(_interim_event(long_text + " and more"))

        assert len(calls) == 1
        assert w._interim_state == "generating"
        await asyncio.sleep(0.01)


class TestPartialAccumulation:
    @pytest.mark.unit
    async def test_final_segments_and_interim_concatenate(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        w._interim_generate = lambda partial: asyncio.sleep(0)
        w._user_turn_start_monotonic = time.monotonic()  # not armed (just now)

        w._on_user_input_transcribed(_interim_event("Hello there.", is_final=True))
        w._on_user_input_transcribed(_interim_event("I have a", is_final=False))
        assert w._interim_partial_text == "Hello there. I have a"

        # A final replaces the in-progress interim segment (no double count).
        w._on_user_input_transcribed(
            _interim_event("I have a big problem", is_final=True)
        )
        assert w._interim_partial_text == "Hello there. I have a big problem"


class TestUserStateReset:
    @pytest.mark.unit
    async def test_speaking_resets_and_starts_clock(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        w._interim_state = "done"
        w._interim_armed = True
        w._interim_partial_text = "stale"
        w._user_turn_start_monotonic = None

        w._on_interim_user_state(types.SimpleNamespace(new_state="speaking"))

        assert w._interim_state == "idle"
        assert w._interim_armed is False
        assert w._interim_partial_text == ""
        assert w._user_speaking is True
        assert w._user_turn_start_monotonic is not None

    @pytest.mark.unit
    async def test_leaving_speaking_clears_flag(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        w._user_speaking = True
        w._on_interim_user_state(types.SimpleNamespace(new_state="listening"))
        assert w._user_speaking is False


class TestCutover:
    @pytest.mark.unit
    async def test_agent_speaking_cuts_playing_interim(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        handle = MagicMock()
        handle.done.return_value = False
        w._interim_handle = handle
        w._interim_state = "playing"

        w._on_interim_agent_state(types.SimpleNamespace(new_state="speaking"))

        handle.stop.assert_called_once()
        # stop() alone leaves a buffered tail on the shared bg track that would
        # bleed over the real reply — the cutover must flush the source queue too.
        w._bg_audio.flush.assert_called_once()
        assert w._interim_handle is None
        assert w._interim_state == "done"

    @pytest.mark.unit
    async def test_no_flush_when_interim_already_finished(self, monkeypatch):
        """A naturally-finished interim leaves nothing to cut — don't churn the
        shared bg queue (and the comfort tone) for nothing."""
        w = _interim_worker(monkeypatch)
        handle = MagicMock()
        handle.done.return_value = True  # interim already played out
        w._interim_handle = handle
        w._interim_state = "playing"

        w._on_interim_agent_state(types.SimpleNamespace(new_state="speaking"))

        handle.stop.assert_not_called()
        w._bg_audio.flush.assert_not_called()
        assert w._interim_handle is None
        assert w._interim_state == "done"

    @pytest.mark.unit
    async def test_thinking_starts_play_task_when_ready(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        started = []
        w._interim_play_after_filler = lambda ts: (
            started.append(ts),
            asyncio.sleep(0),
        )[1]
        w._interim_state = "ready"

        w._on_interim_agent_state(
            types.SimpleNamespace(new_state="thinking", created_at=12.5)
        )

        assert started == [12.5]
        assert w._interim_play_task is not None
        await asyncio.sleep(0.01)

    @pytest.mark.unit
    async def test_thinking_noop_when_idle(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        started = []
        w._interim_play_after_filler = lambda ts: (
            started.append(ts),
            asyncio.sleep(0),
        )[1]
        w._interim_state = "idle"

        w._on_interim_agent_state(
            types.SimpleNamespace(new_state="thinking", created_at=1.0)
        )

        assert started == []


def _clip(phrase: str, duration_ms: float = 3000.0):
    """An in-memory interim clip with no real audio (playback is mocked)."""
    from app.core.livekit.filler_clips import FillerClip

    return FillerClip(phrase=phrase, frames=[], duration_ms=duration_ms)


class TestInterimGenerate:
    """The worker's generate pipeline: text -> TTS -> ready clip."""

    @pytest.mark.unit
    async def test_happy_path_sets_ready(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        w._interim_state = "generating"
        w._read_conversation_history = lambda: []

        async def fake_generate(*_a, **_k):
            return "Mm, I'm with you."

        async def fake_synth(_tts, phrases, **_kw):
            return [_clip(phrases[0])]

        monkeypatch.setattr(interim_reply, "generate_interim_reply", fake_generate)
        monkeypatch.setattr(
            "app.core.livekit.filler_clips.synthesize_clips", fake_synth
        )

        await w._interim_generate("I have been feeling low about everything lately")

        assert w._interim_state == "ready"
        assert w._interim_clip.phrase == "Mm, I'm with you."

    @pytest.mark.unit
    async def test_empty_reply_returns_to_idle(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        w._interim_state = "generating"
        w._read_conversation_history = lambda: []

        async def fake_generate(*_a, **_k):
            return None

        monkeypatch.setattr(interim_reply, "generate_interim_reply", fake_generate)

        await w._interim_generate("some partial transcript text here for testing")

        assert w._interim_state == "idle"
        assert w._interim_clip is None

    @pytest.mark.unit
    async def test_discards_clip_if_turn_reset_mid_synth(self, monkeypatch):
        """If the turn ends (state left 'generating') during synth, drop the clip."""
        w = _interim_worker(monkeypatch)
        w._interim_state = "generating"
        w._read_conversation_history = lambda: []

        async def fake_generate(*_a, **_k):
            return "held reply"

        async def fake_synth(_tts, phrases, **_kw):
            # Simulate the turn being reset while we were synthesizing.
            w._interim_state = "idle"
            return [_clip(phrases[0])]

        monkeypatch.setattr(interim_reply, "generate_interim_reply", fake_generate)
        monkeypatch.setattr(
            "app.core.livekit.filler_clips.synthesize_clips", fake_synth
        )

        await w._interim_generate("some partial transcript text here for testing")

        # The clip is in-memory, so "discarding" it is simply never committing it
        # — there is no temp file left behind to clean up any more.
        assert w._interim_clip is None


class TestResetTurn:
    @pytest.mark.unit
    async def test_reset_clears_all_state(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        handle = MagicMock()
        handle.done.return_value = False
        w._interim_handle = handle
        w._interim_state = "playing"
        w._interim_armed = True
        w._interim_final_segments = ["a"]
        w._interim_current_interim = "b"
        w._interim_partial_text = "a b"
        w._interim_clip = ("text", "/tmp/x.wav")

        w._interim_reset_turn()

        handle.stop.assert_called_once()
        # Same as cutover: a live handle must also flush the buffered tail so a
        # barge-in/new turn doesn't leave the interim playing over what follows.
        w._bg_audio.flush.assert_called_once()
        assert w._interim_handle is None
        assert w._interim_state == "idle"
        assert w._interim_armed is False
        assert w._interim_final_segments == []
        assert w._interim_current_interim == ""
        assert w._interim_partial_text == ""
        assert w._interim_clip is None


class TestFillerCutover:
    """The thinking-filler shares the bug class: stop() leaves a buffered tail."""

    @pytest.mark.unit
    async def test_leaving_thinking_flushes_filler_tail(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        handle = MagicMock()
        handle.done.return_value = False
        w._filler_handle = handle

        # Agent left "thinking" (real reply is starting) — cut the filler.
        w._on_filler_agent_state(types.SimpleNamespace(new_state="speaking"))

        handle.stop.assert_called_once()
        w._bg_audio.flush.assert_called_once()
        assert w._filler_handle is None

    @pytest.mark.unit
    async def test_no_flush_when_no_filler_playing(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        w._filler_handle = None

        w._on_filler_agent_state(types.SimpleNamespace(new_state="speaking"))

        w._bg_audio.flush.assert_not_called()


# ---------------------------------------------------------------------------
# AI-cost: the interim call's tokens reach llm_usage as interim_reply
# ---------------------------------------------------------------------------
class TestInterimReplyUsage:
    @staticmethod
    def _client(result):
        structured = MagicMock()
        structured.ainvoke = AsyncMock(return_value=result)
        llm_instance = MagicMock(model_name="gpt-4o-mini")
        llm_instance.with_structured_output = MagicMock(return_value=structured)
        return types.SimpleNamespace(llm_instance=llm_instance, provider="openai")

    @staticmethod
    def _raw():
        return AIMessage(
            content="",
            usage_metadata={
                "input_tokens": 90,
                "output_tokens": 8,
                "total_tokens": 98,
            },
        )

    @pytest.mark.unit
    async def test_emits_usage_against_the_passed_room(
        self, monkeypatch, ai_usage_calls
    ):
        monkeypatch.setattr(interim_reply, "load_and_format", lambda *a, **k: "SYS")
        client = self._client(
            {
                "raw": self._raw(),
                "parsed": interim_reply._InterimReply(reply="Mm."),
                "parsing_error": None,
            }
        )

        out = await interim_reply.generate_interim_reply(
            client, _make_scenario(), [], "a long partial transcript", room_id="rm-7"
        )

        assert out == "Mm."
        client.llm_instance.with_structured_output.assert_called_once_with(
            interim_reply._InterimReply, include_raw=True
        )
        assert len(ai_usage_calls) == 1
        call = ai_usage_calls[0]
        assert call["room_id"] == "rm-7"
        assert call["task"] == "interim_reply"
        assert call["model"] == "gpt-4o-mini"
        assert call["prompt_tokens"] == 90

    @pytest.mark.unit
    async def test_parse_failure_still_emits(self, monkeypatch, ai_usage_calls):
        monkeypatch.setattr(interim_reply, "load_and_format", lambda *a, **k: "SYS")
        client = self._client(
            {"raw": self._raw(), "parsed": None, "parsing_error": ValueError("x")}
        )

        out = await interim_reply.generate_interim_reply(
            client, _make_scenario(), [], "a long partial transcript", room_id="rm-7"
        )

        assert out is None
        assert [c["task"] for c in ai_usage_calls] == ["interim_reply"]

    @pytest.mark.unit
    async def test_worker_passes_its_room_to_generation_and_clip_tts(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        w._interim_state = "generating"
        w._read_conversation_history = lambda: []
        w._tts_provider, w._tts_model = "elevenlabs", "eleven_flash_v2_5"
        seen = {}

        async def fake_generate(*_a, **kw):
            seen["generate"] = kw
            return "Mm, go on."

        async def fake_synth(_tts, phrases, **kw):
            seen["synth"] = kw
            return [FillerClipForTest(phrases[0])]

        monkeypatch.setattr(interim_reply, "generate_interim_reply", fake_generate)
        monkeypatch.setattr(
            "app.core.livekit.filler_clips.synthesize_clips", fake_synth
        )

        await w._interim_generate("I have been feeling low about everything lately")

        assert seen["generate"]["room_id"] == "room-1"
        assert seen["synth"]["usage_room_id"] == "room-1"
        assert seen["synth"]["usage_provider"] == "elevenlabs"
        assert seen["synth"]["usage_model"] == "eleven_flash_v2_5"


def FillerClipForTest(phrase):
    from app.core.livekit.filler_clips import FillerClip

    return FillerClip(phrase=phrase, frames=[], duration_ms=500.0)


class _FakeOpener:
    def __init__(self, busy=False, opened=False, bridged=False):
        self.busy = busy
        self.opened_since_reply = opened
        self.bridged_since_reply = bridged


class TestInterimAlongsideOpeners:
    """Delivery-plan openers no longer switch the interim off: it plays after
    the opener, and never on a pause a bridge line already covered."""

    def _ready_worker(self, monkeypatch, opener):
        w = _interim_worker(monkeypatch)
        w._opener_player = opener
        w._interim_clip = _clip("Let me think about that.")
        w._interim_state = "ready"
        w._emit_interim_transcript = MagicMock()
        monkeypatch.setattr(worker.settings, "OPENER_POST_PAUSE_MS", 1.0)
        monkeypatch.setattr(
            "livekit.agents.AudioConfig", lambda *a, **k: types.SimpleNamespace()
        )
        return w

    @pytest.mark.asyncio
    async def test_waits_for_the_opener_then_plays(self, monkeypatch):
        opener = _FakeOpener(busy=True, opened=True)
        w = self._ready_worker(monkeypatch, opener)
        task = asyncio.create_task(w._interim_play_after_filler(None))
        await asyncio.sleep(0.15)
        w._bg_audio.play.assert_not_called()  # opener still holding/playing
        opener.busy = False
        await asyncio.wait_for(task, 1.0)
        w._bg_audio.play.assert_called_once()
        assert w._interim_state == "playing"

    @pytest.mark.asyncio
    async def test_skips_a_pause_the_bridge_covered(self, monkeypatch):
        w = self._ready_worker(
            monkeypatch, _FakeOpener(busy=False, opened=True, bridged=True)
        )
        await asyncio.wait_for(w._interim_play_after_filler(None), 1.0)
        w._bg_audio.play.assert_not_called()
        assert w._interim_state == "idle"

    @pytest.mark.asyncio
    async def test_plays_straight_away_when_the_policy_chose_silence(self, monkeypatch):
        w = self._ready_worker(monkeypatch, _FakeOpener())
        await asyncio.wait_for(w._interim_play_after_filler(None), 1.0)
        w._bg_audio.play.assert_called_once()


class TestFalseEndpoint:
    """A long turn has pauses. In v2v every v3 interim was armed and then
    cancelled at the learner's next pause (armed 6x, played 0x)."""

    @pytest.mark.unit
    async def test_generation_survives_a_pause_and_resume(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        gen = asyncio.create_task(asyncio.sleep(10))
        w._interim_gen_task = gen
        w._interim_state = "generating"
        w._interim_armed = True
        w._interim_partial_text = "so far"

        # Agent thinks, the learner goes on: back to listening, then speaking.
        w._on_interim_agent_state(types.SimpleNamespace(new_state="listening"))
        w._on_interim_user_state(types.SimpleNamespace(new_state="speaking"))

        assert not gen.cancelled()
        assert w._interim_state == "generating"
        assert w._interim_armed and w._interim_partial_text == "so far"
        gen.cancel()

    @pytest.mark.unit
    async def test_a_ready_clip_waits_for_the_real_end_of_turn(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        w._interim_state = "ready"
        w._interim_clip = _clip("Hmm, that's a lot.")
        w._on_interim_agent_state(types.SimpleNamespace(new_state="listening"))
        w._on_interim_user_state(types.SimpleNamespace(new_state="speaking"))
        assert w._interim_state == "ready" and w._interim_clip is not None

    @pytest.mark.unit
    async def test_a_heard_interim_is_stopped_and_never_replayed(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        handle = MagicMock()
        handle.done.return_value = False
        w._interim_handle = handle
        w._interim_state = "playing"
        w._on_interim_agent_state(types.SimpleNamespace(new_state="listening"))
        handle.stop.assert_called_once()
        w._bg_audio.flush.assert_called_once()
        assert w._interim_state == "done"
        # The next learner speech starts a fresh turn.
        w._on_interim_user_state(types.SimpleNamespace(new_state="speaking"))
        assert w._interim_state == "idle"

    @pytest.mark.unit
    async def test_the_real_reply_still_cuts_everything(self, monkeypatch):
        w = _interim_worker(monkeypatch)
        gen = asyncio.create_task(asyncio.sleep(10))
        w._interim_gen_task = gen
        w._interim_state = "generating"
        w._on_interim_agent_state(types.SimpleNamespace(new_state="speaking"))
        await asyncio.sleep(0)
        assert gen.cancelled() and w._interim_state == "done"


class TestInterimAfterAnOpener:
    """Prod: a sigh opener, then an interim opening "Hhh, you know…" — two
    breaths in a row. In opener sessions the interim's own hesitation goes."""

    async def _generate(self, monkeypatch, with_opener):
        w = _interim_worker(monkeypatch)
        w._interim_state = "generating"
        w._read_conversation_history = lambda: []
        w._opener_player = object() if with_opener else None

        async def fake_generate(*_a, **_k):
            return "Hhh, you know, it's just that..."

        async def fake_synth(_tts, phrases, **_kw):
            return [_clip(phrases[0])]

        monkeypatch.setattr(interim_reply, "generate_interim_reply", fake_generate)
        monkeypatch.setattr(
            "app.core.livekit.filler_clips.synthesize_clips", fake_synth
        )
        await w._interim_generate("I have been feeling low about everything lately")
        return w._interim_clip.phrase

    @pytest.mark.asyncio
    async def test_opener_sessions_drop_the_leading_breath(self, monkeypatch):
        assert await self._generate(monkeypatch, True) == "You know, it's just that..."

    @pytest.mark.asyncio
    async def test_legacy_sessions_keep_it(self, monkeypatch):
        assert (
            await self._generate(monkeypatch, False)
            == "Hhh, you know, it's just that..."
        )
