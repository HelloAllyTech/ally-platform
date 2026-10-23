"""Usage and latency for a guide voice session.

**Usage.** STT and TTS are recorded exactly as the roleplay worker records its
own (``_emit_service_usage`` in app/worker.py → ``emit_ai_usage`` on the
``llm_usage`` SQS message): STT per pushed audio millisecond, TTS per
synthesised character, both from LiveKit's metrics. Only the task labels
differ — ``guide_voice_stt`` / ``guide_voice_tts``, which have rows in ally-be's
AI task registry — and each row carries ``metadata.guideThreadId``, because a
``guide-`` room has no scenario session for ally-be to attribute it to.

**Latency.** Voice response time is end of the learner's speech to Ally's
first audio (plan §7.9; target p50 ≤ 3.5 s at M1). The roleplay worker ships
its per-turn record to ally-be's turn-metrics table, which only accepts
scenario-session rooms, so the guide logs one ``[GUIDE_LATENCY]`` line per
turn instead, with the same components (EOU delay, STT finalisation, TTS first
byte). ally-be's own time to first frame is in the ``[GUIDE_TURN]`` line.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional, Tuple

from app.core.llm_usage.tasks import LLMTask
from app.core.logger import get_logger

logger = get_logger(__name__)


def _default_emit(room: str, **kwargs: Any) -> None:
    try:
        from app.core.llm_usage.emitter import emit_ai_usage

        emit_ai_usage(room, **kwargs)
    except Exception:  # noqa: BLE001 - usage is best-effort
        logger.debug("[GUIDE] usage emit skipped", exc_info=True)


class GuideVoiceMetrics:
    def __init__(
        self,
        room: str,
        *,
        thread_id: Optional[str],
        stt_meta: Tuple[str, str],
        tts_meta: Tuple[str, str],
        emit: Callable[..., None] = _default_emit,
    ) -> None:
        self._room = room
        self._thread_id = thread_id
        self._stt_provider, self._stt_model = stt_meta
        self._tts_provider, self._tts_model = tts_meta
        self._emit = emit
        self._user_stopped_at: Optional[float] = None
        self._turn: Dict[str, int] = {}

    def _metadata(self) -> Optional[Dict[str, str]]:
        return {"guideThreadId": self._thread_id} if self._thread_id else None

    def on_metrics_collected(self, event: Any) -> None:
        try:
            metric = getattr(event, "metrics", None)
            kind = type(metric).__name__
            if kind == "STTMetrics":
                audio_s = getattr(metric, "audio_duration", None)
                if audio_s and audio_s > 0:
                    self._emit(
                        self._room,
                        service="stt",
                        provider=self._stt_provider,
                        model=self._stt_model,
                        task=LLMTask.GUIDE_VOICE_STT.value,
                        audio_ms=int(audio_s * 1000),
                        metadata=self._metadata(),
                    )
            elif kind == "TTSMetrics":
                chars = getattr(metric, "characters_count", None)
                if chars:
                    self._emit(
                        self._room,
                        service="tts",
                        provider=self._tts_provider,
                        model=self._tts_model,
                        task=LLMTask.GUIDE_VOICE_TTS.value,
                        characters=int(chars),
                        metadata=self._metadata(),
                    )
                ttfb = getattr(metric, "ttfb", None)
                if ttfb is not None and ttfb >= 0 and "tts_ttfb_ms" not in self._turn:
                    self._turn["tts_ttfb_ms"] = int(ttfb * 1000)
            elif kind == "EOUMetrics":
                delay = getattr(metric, "end_of_utterance_delay", None)
                if delay is not None and delay >= 0:
                    self._turn["eou_delay_ms"] = int(delay * 1000)
                stt_delay = getattr(metric, "transcription_delay", None)
                if stt_delay is not None and stt_delay >= 0:
                    self._turn["stt_finalize_ms"] = int(stt_delay * 1000)
        except Exception:  # noqa: BLE001 - metrics must never break a session
            logger.exception("[GUIDE] metrics hook failed")

    def on_user_state_changed(self, event: Any) -> None:
        if getattr(event, "old_state", None) == "speaking":
            self._user_stopped_at = getattr(event, "created_at", None)
            self._turn = {}

    def on_agent_state_changed(self, event: Any) -> None:
        if getattr(event, "new_state", None) != "speaking":
            return
        stopped = self._user_stopped_at
        if stopped is None:
            return
        self._user_stopped_at = None
        latency_ms = (getattr(event, "created_at", stopped) - stopped) * 1000
        parts = " ".join(f"{key}={value}" for key, value in sorted(self._turn.items()))
        logger.info(
            "[GUIDE_LATENCY] response_latency_ms=%.0f %s room=%s",
            latency_ms,
            parts,
            self._room,
        )
