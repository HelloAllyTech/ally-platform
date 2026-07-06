"""Telemetry for roleplay v2 sessions.

Two responsibilities:

1. ``record_turn_fields`` / ``reset_turn_fields`` — merge v2-specific per-turn
   fields (prompt_compile_ms, direction_staleness_turns, director_latency_ms,
   director_miss, ...) into the schemaless ``metadata`` slot of the existing
   turn-metrics accumulator (app/core/metrics/turn_metrics.py). The
   accumulator whitelists top-level keys, so v2 fields ride in ``metadata`` —
   this module keeps a per-room merge buffer so multiple call sites
   (actor graph, director service) don't clobber each other's writes.

2. ``create_metrics_hook`` — the LiveKit ``metrics_collected`` closure for
   worker_v2, lifted from app/worker.py (the on_metrics_collected handler):
   EOU delay / LLM TTFT / TTS TTFB into turn metrics plus best-effort STT/TTS
   AI-cost usage emits.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from app.core.logger import get_logger
from app.core.metrics import turn_metrics

logger = get_logger(__name__)

# room_id -> merged v2 metadata for the in-flight turn.
_v2_turn_fields: Dict[str, Dict[str, Any]] = {}


def record_turn_fields(room_id: str, **fields: Any) -> None:
    """Merge v2 fields into the in-flight turn's metadata (best-effort)."""
    if not room_id:
        return
    try:
        merged = _v2_turn_fields.setdefault(room_id, {})
        merged.update({k: v for k, v in fields.items() if v is not None})
        turn_metrics.record(room_id, metadata=dict(merged))
    except Exception:  # noqa: BLE001 - metrics must never break a turn
        logger.debug("[roleplay_v2] record_turn_fields failed", exc_info=True)


def reset_turn_fields(room_id: str) -> None:
    """Clear the merge buffer at the start of a new turn."""
    _v2_turn_fields.pop(room_id, None)


def discard(room_id: str) -> None:
    """Drop all telemetry state for a room (session shutdown)."""
    _v2_turn_fields.pop(room_id, None)
    turn_metrics.discard(room_id)


# ---------------------------------------------------------------------------
# LiveKit metrics hook (mirrors app/worker.py's on_metrics_collected)
# ---------------------------------------------------------------------------


def _emit_service_usage(
    room: str,
    *,
    service: str,
    provider: str,
    model: str,
    task: str,
    audio_ms: Optional[int] = None,
    characters: Optional[int] = None,
) -> None:
    """Best-effort AI-cost emit (guarded import; never breaks the session)."""
    try:
        from app.core.llm_usage.emitter import emit_ai_usage

        emit_ai_usage(
            room,
            service=service,
            provider=provider,
            model=model,
            task=task,
            audio_ms=audio_ms,
            characters=characters,
        )
    except Exception:  # noqa: BLE001
        logger.debug("[ai-cost] v2 emit skipped (best-effort)", exc_info=True)


def create_metrics_hook(
    room_name: str,
    *,
    stt_provider: str = "unknown",
    stt_model: str = "unknown",
    tts_provider: str = "unknown",
    tts_model: str = "unknown",
):
    """Build the ``metrics_collected`` handler for an AgentSession.

    Same shape-defensive reads as v1: metric classes vary by LiveKit version,
    so attributes are read by name and any failure is swallowed.
    """

    def on_metrics_collected(ev) -> None:
        try:
            metric = getattr(ev, "metrics", None)
            if metric is None:
                return
            metric_cls = type(metric).__name__
            if metric_cls == "EOUMetrics":
                delay = getattr(metric, "end_of_utterance_delay", None)
                if delay is not None and delay >= 0:
                    turn_metrics.record(room_name, eou_delay_ms=int(delay * 1000))
            elif metric_cls == "LLMMetrics":
                ttft = getattr(metric, "ttft", None)
                if ttft is not None and ttft >= 0:
                    turn_metrics.record(room_name, llm_ttft_ms=int(ttft * 1000))
            elif metric_cls == "TTSMetrics":
                ttfb = getattr(metric, "ttfb", None)
                if ttfb is not None and ttfb >= 0:
                    turn_metrics.record(room_name, tts_ttfb_ms=int(ttfb * 1000))
                chars = getattr(metric, "characters_count", None)
                if chars:
                    _emit_service_usage(
                        room_name,
                        service="tts",
                        provider=tts_provider,
                        model=tts_model,
                        task="agent_tts",
                        characters=int(chars),
                    )
            elif metric_cls == "STTMetrics":
                audio_s = getattr(metric, "audio_duration", None)
                if audio_s and audio_s > 0:
                    _emit_service_usage(
                        room_name,
                        service="stt",
                        provider=stt_provider,
                        model=stt_model,
                        task="agent_stt",
                        audio_ms=int(audio_s * 1000),
                    )
        except Exception:  # noqa: BLE001 - metrics must never break a session
            logger.exception("[roleplay_v2] metrics_collected hook failed")

    return on_metrics_collected
