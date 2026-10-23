"""STT/TTS usage rows and the latency line for guide voice sessions."""

import re
import types
from pathlib import Path

import pytest

from app.core.guide.usage import GuideVoiceMetrics
from app.core.llm_usage.tasks import LLMTask

LLM_TASK_ENUM = (
    Path(__file__).resolve().parents[4]
    / "ally-be"
    / "src"
    / "learn"
    / "enum"
    / "llm-task.enum.ts"
)


def _metric(name, **fields):
    cls = type(name, (), {})
    metric = cls()
    for key, value in fields.items():
        setattr(metric, key, value)
    return types.SimpleNamespace(metrics=metric)


def _metrics(thread_id="th-1"):
    emitted = []

    def emit(room, **kwargs):
        emitted.append((room, kwargs))

    tracker = GuideVoiceMetrics(
        "guide-abc",
        thread_id=thread_id,
        stt_meta=("google", "chirp_2"),
        tts_meta=("google", "en-IN-Chirp3-HD-Kore"),
        emit=emit,
    )
    return tracker, emitted


def test_stt_usage_is_recorded_under_the_guide_task():
    tracker, emitted = _metrics()
    tracker.on_metrics_collected(_metric("STTMetrics", audio_duration=2.5))

    assert emitted == [
        (
            "guide-abc",
            {
                "service": "stt",
                "provider": "google",
                "model": "chirp_2",
                "task": "guide_voice_stt",
                "audio_ms": 2500,
                "metadata": {"guideThreadId": "th-1"},
            },
        )
    ]


def test_tts_usage_is_recorded_per_character():
    tracker, emitted = _metrics()
    tracker.on_metrics_collected(_metric("TTSMetrics", characters_count=42, ttfb=0.3))

    room, row = emitted[0]
    assert row["service"] == "tts"
    assert row["task"] == "guide_voice_tts"
    assert row["characters"] == 42
    assert row["model"] == "en-IN-Chirp3-HD-Kore"


def test_nothing_billable_records_nothing():
    tracker, emitted = _metrics()
    tracker.on_metrics_collected(_metric("STTMetrics", audio_duration=0))
    tracker.on_metrics_collected(_metric("TTSMetrics", characters_count=0))
    tracker.on_metrics_collected(_metric("LLMMetrics", ttft=0.1))
    assert emitted == []


def test_without_a_thread_there_is_no_metadata():
    tracker, emitted = _metrics(thread_id=None)
    tracker.on_metrics_collected(_metric("STTMetrics", audio_duration=1.0))
    assert emitted[0][1]["metadata"] is None


def test_latency_line_from_end_of_speech_to_first_audio(caplog):
    tracker, _ = _metrics()
    tracker.on_user_state_changed(
        types.SimpleNamespace(
            old_state="speaking", new_state="listening", created_at=10.0
        )
    )
    tracker.on_metrics_collected(
        _metric("EOUMetrics", end_of_utterance_delay=0.6, transcription_delay=0.2)
    )
    with caplog.at_level("INFO"):
        tracker.on_agent_state_changed(
            types.SimpleNamespace(new_state="speaking", created_at=12.5)
        )

    line = next(
        r.getMessage() for r in caplog.records if "GUIDE_LATENCY" in r.getMessage()
    )
    assert "response_latency_ms=2500" in line
    assert "eou_delay_ms=600" in line
    assert "stt_finalize_ms=200" in line


def test_a_metrics_bug_never_escapes():
    def broken_emit(room, **kwargs):
        raise RuntimeError("boom")

    tracker = GuideVoiceMetrics(
        "r", thread_id=None, stt_meta=("a", "b"), tts_meta=("c", "d"), emit=broken_emit
    )
    tracker.on_metrics_collected(_metric("STTMetrics", audio_duration=1.0))


@pytest.mark.skipif(not LLM_TASK_ENUM.exists(), reason="ally-be not checked out")
@pytest.mark.parametrize("task", [LLMTask.GUIDE_VOICE_STT, LLMTask.GUIDE_VOICE_TTS])
def test_guide_task_labels_exist_in_ally_be(task):
    # ally-be maps an unknown label to `unknown`; these must match its enum.
    source = LLM_TASK_ENUM.read_text(encoding="utf-8")
    assert re.search(rf"=\s*'{task.value}'", source)
