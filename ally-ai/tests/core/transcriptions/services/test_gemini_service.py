"""Tests for GeminiTranscriptionService: parsing, stitching, provider contract."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

import app.core.transcriptions.services.gemini_service as gemini_module
from app.core.transcriptions.services.gemini_service import (
    GeminiTranscriptionService,
    Transcript,
    TranscriptSegment,
    format_segments,
    parse_timestamp,
)
from app.core.transcriptions.utils.exceptions import TranscriptionFailedException
from app.prompts.resolver import load_template


class TestParseTimestamp:
    @pytest.mark.parametrize(
        "value, expected",
        [
            (12.4, 12.4),
            (0, 0.0),
            ("12.40", 12.4),
            ("7", 7.0),
            ("12.4s", 12.4),
            ("0:12.4", 12.4),
            ("01:02", 62.0),
            ("1:02:03.5", 3723.5),
        ],
    )
    def test_accepts_seconds_and_clock_forms(self, value, expected):
        assert parse_timestamp(value) == pytest.approx(expected)

    @pytest.mark.parametrize("value", [None, "", "   ", "abc", "-3", -1, "1:2:3:4"])
    def test_rejects_garbage(self, value):
        assert parse_timestamp(value) is None


class TestFormatSegments:
    def test_matches_other_providers_line_format(self):
        text = format_segments([(3.0, 4.5, "  second  "), (0.0, 1.25, "first")])
        assert text == "0.00-1.25: first\n3.00-4.50: second"

    def test_drops_blank_text(self):
        assert format_segments([(0.0, 1.0, "   "), (1.0, 2.0, "hi")]) == "1.00-2.00: hi"


def _service(monkeypatch, generate_results):
    """Service with the SDK call replaced; `generate_results` is one
    (Transcript, usage) per segment, consumed in call order."""
    fake_types = SimpleNamespace(
        Part=SimpleNamespace(from_bytes=lambda data, mime_type: (mime_type, len(data))),
        GenerateContentConfig=lambda **kw: kw,
        ThinkingConfig=lambda **kw: kw,
    )
    fake_genai = SimpleNamespace(
        Client=lambda api_key: SimpleNamespace(api_key=api_key)
    )
    with patch.dict(
        "sys.modules",
        {"google": SimpleNamespace(genai=fake_genai), "google.genai": fake_genai},
    ):
        monkeypatch.setattr(fake_genai, "types", fake_types, raising=False)
        svc = GeminiTranscriptionService(api_key="AIza-test", model="gemini-test")
    results = list(generate_results)
    calls = []
    settings_seen = []

    async def _generate(path, call):
        calls.append(path)
        settings_seen.append(call)
        return results.pop(0)

    svc._generate = _generate
    svc._calls = calls
    svc._settings_seen = settings_seen
    return svc


def _transcript(*rows):
    return Transcript(
        segments=[TranscriptSegment(start=s, end=e, text=t) for s, e, t in rows]
    )


@pytest.fixture
def no_audio_io(monkeypatch):
    """Skip ffmpeg: fake the segmenter, durations and cleanup."""
    monkeypatch.setattr(
        gemini_module,
        "convert_and_segment_audio_async",
        AsyncMock(return_value=["/tmp/a.wav"]),
    )
    monkeypatch.setattr(
        gemini_module, "get_audio_duration", AsyncMock(return_value=30.0)
    )
    monkeypatch.setattr(
        GeminiTranscriptionService,
        "_cleanup_segment_files",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(gemini_module, "_emit_stt_usage", lambda *a, **k: None)


class TestGeminiTranscriptionService:
    def test_requires_a_key(self, monkeypatch):
        monkeypatch.setattr(gemini_module.settings.GEMINI, "API_KEY", None)
        with pytest.raises(ValueError, match="GEMINI__API_KEY"):
            GeminiTranscriptionService()

    @pytest.mark.asyncio
    async def test_single_segment_returns_formatted_lines(
        self, monkeypatch, no_audio_io
    ):
        svc = _service(
            monkeypatch,
            [(_transcript(("0.5", "2.0", "hello"), ("2.5", "4.0", "world")), None)],
        )
        cid, text = await svc.transcribe_audio_from_url("http://x", chat_id=7)
        assert cid == 7
        assert text == "0.50-2.00: hello\n2.50-4.00: world"
        assert svc._calls == ["/tmp/a.wav"]

    @pytest.mark.asyncio
    async def test_multiple_segments_are_offset_by_measured_durations(
        self, monkeypatch, no_audio_io
    ):
        monkeypatch.setattr(
            gemini_module,
            "convert_and_segment_audio_async",
            AsyncMock(return_value=["/tmp/a.wav", "/tmp/b.wav"]),
        )
        durations = {"/tmp/a.wav": 100.0, "/tmp/b.wav": 40.0}
        monkeypatch.setattr(
            gemini_module,
            "get_audio_duration",
            AsyncMock(side_effect=lambda p, *a, **k: durations[p]),
        )
        svc = _service(
            monkeypatch,
            [
                (_transcript(("1.0", "2.0", "first")), None),
                (_transcript(("0:03", "0:05", "second")), None),
            ],
        )
        _, text = await svc.transcribe_audio_from_url("http://x", chat_id=1)
        # Second segment starts at 100s, not at 2 * its own 40s length.
        assert text == "1.00-2.00: first\n103.00-105.00: second"

    @pytest.mark.asyncio
    async def test_end_before_start_and_overshoot_are_clamped(
        self, monkeypatch, no_audio_io
    ):
        svc = _service(
            monkeypatch,
            [
                (
                    _transcript(("5.0", "4.0", "backwards"), ("29.0", "45.0", "late")),
                    None,
                )
            ],
        )
        _, text = await svc.transcribe_audio_from_url("http://x", chat_id=1)
        assert text == "5.00-5.00: backwards\n29.00-30.00: late"

    @pytest.mark.asyncio
    async def test_unparseable_rows_are_dropped_not_fatal(
        self, monkeypatch, no_audio_io
    ):
        svc = _service(
            monkeypatch,
            [
                (
                    _transcript(
                        ("x", "y", "junk"), ("1.0", "2.0", "ok"), ("3.0", "4.0", "")
                    ),
                    None,
                )
            ],
        )
        _, text = await svc.transcribe_audio_from_url("http://x", chat_id=1)
        assert text == "1.00-2.00: ok"

    @pytest.mark.asyncio
    async def test_no_speech_returns_empty_string(self, monkeypatch, no_audio_io):
        # Empty is a signal to the fallback wrapper, not an exception here.
        svc = _service(monkeypatch, [(Transcript(), None)])
        _, text = await svc.transcribe_audio_from_url("http://x", chat_id=1)
        assert text == ""

    @pytest.mark.asyncio
    async def test_segment_failure_surfaces_status_code(self, monkeypatch, no_audio_io):
        svc = _service(monkeypatch, [])

        async def _boom(path, call):
            raise TranscriptionFailedException("quota", status_code=429)

        svc._generate = _boom
        with pytest.raises(TranscriptionFailedException) as info:
            await svc.transcribe_audio_from_url("http://x", chat_id=1)
        assert info.value.status_code == 429

    @pytest.mark.asyncio
    async def test_segments_are_cleaned_up_even_on_failure(self, monkeypatch):
        monkeypatch.setattr(
            gemini_module,
            "convert_and_segment_audio_async",
            AsyncMock(return_value=["/tmp/a.wav"]),
        )
        monkeypatch.setattr(
            gemini_module, "get_audio_duration", AsyncMock(return_value=1.0)
        )
        cleanup = AsyncMock(return_value=None)
        monkeypatch.setattr(
            GeminiTranscriptionService, "_cleanup_segment_files", cleanup
        )
        svc = _service(monkeypatch, [])

        async def _boom(path, call):
            raise RuntimeError("network")

        svc._generate = _boom
        with pytest.raises(TranscriptionFailedException):
            await svc.transcribe_audio_from_url("http://x", chat_id=1)
        cleanup.assert_awaited_once()
        assert cleanup.await_args.args[0] == ["/tmp/a.wav"]


class TestGeminiTranscriptionPrompt:
    """The instruction is the Skills Store's `ally_ai_audio_gemini_transcription`."""

    CODE = "ally_ai_audio_gemini_transcription"

    # The inline constant this prompt replaced, kept verbatim so the default
    # file is proven to be the text production ran.
    LEGACY_PROMPT = (
        "You are a verbatim transcription engine for a recorded counselling call.\n"
        "Transcribe everything that is spoken in this audio exactly as it is said, "
        "in the language or languages actually spoken. Do not translate. Keep "
        "code-mixed speech as spoken, and write Indian languages in their native "
        "script.\n"
        "Split the speech into short utterances at natural pauses or speaker "
        "changes. For every utterance give its start and end time in seconds from "
        'the beginning of this audio as decimal numbers (for example "12.40").\n'
        "Do not add speaker labels, commentary, summaries or anything that was not "
        "spoken. If there is no intelligible speech, return an empty list of "
        "segments."
    )

    def test_default_is_byte_identical_to_the_inline_prompt(self):
        assert (
            load_template(gemini_module.TRANSCRIPTION_PROMPT_PATH, prompts={})
            == self.LEGACY_PROMPT
        )

    @pytest.mark.asyncio
    async def test_without_store_text_runs_the_default_on_the_configured_model(
        self, monkeypatch, no_audio_io
    ):
        svc = _service(monkeypatch, [(Transcript(), None)])
        await svc.transcribe_audio_from_url("http://x", chat_id=1, prompts={})
        call = svc._settings_seen[0]
        assert call.prompt == self.LEGACY_PROMPT
        assert call.model == "gemini-test"
        assert call.config["temperature"] == 0

    @pytest.mark.asyncio
    async def test_store_text_model_and_temperature_are_used(
        self, monkeypatch, no_audio_io
    ):
        svc = _service(monkeypatch, [(Transcript(), None)])
        prompts = {
            self.CODE: {
                "prompt": "Live transcription text.",
                "provider": "google",
                "model": "gemini-2.5-pro",
                "temperature": 0.2,
            }
        }
        await svc.transcribe_audio_from_url("http://x", chat_id=1, prompts=prompts)
        call = svc._settings_seen[0]
        assert call.prompt == "Live transcription text."
        assert call.model == "gemini-2.5-pro"
        assert call.config["temperature"] == 0.2

    @pytest.mark.asyncio
    async def test_a_non_gemini_store_model_is_ignored(self, monkeypatch, no_audio_io):
        svc = _service(monkeypatch, [(Transcript(), None)])
        prompts = {
            self.CODE: {"prompt": "Live.", "provider": "openai", "model": "gpt-4o"}
        }
        await svc.transcribe_audio_from_url("http://x", chat_id=1, prompts=prompts)
        assert svc._settings_seen[0].model == "gemini-test"
