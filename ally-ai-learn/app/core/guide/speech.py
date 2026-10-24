"""Ally's ears and voice for a session's language.

The roleplay agent takes STT and TTS from the scenario (its language row and
its persona's voice). Ally has no scenario, so this module resolves both from
the session's language, then builds them with the same provider factories
(``app/stt``, ``app/tts``) — every provider the roleplay agent supports works
here unchanged.

* **STT:** ``GUIDE_STT_CONFIG[lang]`` if set, else ``DEFAULT_STT_CONFIG`` (Google
  chirp_2) in the language's Indian locale.
* **TTS:** ``GUIDE_TTS_CONFIG[lang]`` if set, else a fixed Google Chirp 3 HD
  speaker (``GUIDE_TTS_GOOGLE_VOICE``) — one voice for Ally per language, which
  a generative voice could not promise.
* **Turn detection:** semantic end-of-utterance for English and Hindi, the two
  languages the multilingual model covers; plain VAD with the longer
  ``GUIDE_VAD_ENDPOINTING_DELAY`` for the rest, and whenever the model is
  unavailable. Push-to-talk turns are ended by the learner (``"manual"``).
"""

from __future__ import annotations

import copy
import json
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

from app.core.config import settings
from app.core.constants import DEFAULT_STT_CONFIG
from app.core.guide.session import base_language, provider_language_code
from app.core.logger import get_logger

logger = get_logger(__name__)

#: Languages the LiveKit multilingual EOU model serves, of Ally's five.
SEMANTIC_TURN_LANGUAGES = frozenset({"en", "hi"})


@dataclass(frozen=True)
class GuideSpeechConfig:
    language_code: str
    stt_config: Dict[str, Any]
    tts_config: Dict[str, Any]

    @property
    def stt_meta(self) -> Tuple[str, str]:
        """(provider, model), for usage rows."""
        inner = self.stt_config.get("config") or {}
        return (
            str(self.stt_config.get("provider") or "unknown"),
            str(inner.get("model") or "unknown"),
        )

    @property
    def tts_meta(self) -> Tuple[str, str]:
        inner = self.tts_config.get("config") or {}
        model = (
            inner.get("voice_name")
            or inner.get("model")
            or inner.get("model_name")
            or inner.get("voice_id")
            or "unknown"
        )
        return str(self.tts_config.get("provider") or "unknown"), str(model)


def _configured(raw: Optional[str], language: str, setting: str) -> Optional[dict]:
    """``raw`` is a JSON object keyed by base language (or ``default``)."""
    if not raw:
        return None
    try:
        table = json.loads(raw)
    except ValueError:
        logger.error("[GUIDE] %s is not valid JSON; using the default", setting)
        return None
    if not isinstance(table, dict):
        logger.error("[GUIDE] %s must be a JSON object; using the default", setting)
        return None
    entry = table.get(language) or table.get("default")
    if entry is not None and not (isinstance(entry, dict) and entry.get("provider")):
        logger.error(
            "[GUIDE] %s[%s] has no provider; using the default", setting, language
        )
        return None
    return entry


def default_stt_config() -> Dict[str, Any]:
    return {
        "provider": DEFAULT_STT_CONFIG["provider"],
        "config": {k: v for k, v in DEFAULT_STT_CONFIG.items() if k != "provider"},
    }


def default_tts_config(language_code: str) -> Dict[str, Any]:
    speaker = (settings.GUIDE_TTS_GOOGLE_VOICE or "Kore").strip()
    return {
        "provider": "google",
        "config": {
            "voice_name": f"{language_code}-Chirp3-HD-{speaker}",
            "model_name": "chirp_3",
        },
    }


def resolve_speech_config(language: Optional[str]) -> GuideSpeechConfig:
    base = base_language(language)
    code = provider_language_code(language)
    stt = _configured(settings.GUIDE_STT_CONFIG, base, "GUIDE_STT_CONFIG")
    tts = _configured(settings.GUIDE_TTS_CONFIG, base, "GUIDE_TTS_CONFIG")
    return GuideSpeechConfig(
        language_code=code,
        stt_config=stt or default_stt_config(),
        tts_config=tts or default_tts_config(code),
    )


def build_stt_client(config: GuideSpeechConfig):
    """The STT client; the platform default if the configured one fails —
    the same fallback the roleplay agent applies (configure_stt_client)."""
    from app.stt import create_stt_client

    try:
        return create_stt_client(
            stt_config=copy.deepcopy(config.stt_config),
            language_code=config.language_code,
        )
    except Exception as exc:  # noqa: BLE001 - fall back rather than fail the join
        logger.warning("[GUIDE] STT config failed (%s); using the default", exc)
        return create_stt_client(language_code=config.language_code)


def build_tts_client(config: GuideSpeechConfig):
    """Ally's TTS client. A configured voice that cannot be built falls back
    to the platform default Google voice for the language."""
    from app.tts import Gender, create_tts_client

    return create_tts_client(
        tts_config=copy.deepcopy(config.tts_config),
        language_code=config.language_code,
        gender=Gender.FEMALE,
    )


def resolve_turn_detection(
    language: Optional[str], turn_mode: str, vad: Any
) -> Tuple[Any, Dict[str, float]]:
    """``(turn_detection, endpointing kwargs)`` for AgentSession."""
    if turn_mode == "push_to_talk":
        return "manual", {}
    if vad is None:
        return None, {}
    fallback = (
        "vad",
        {"min_endpointing_delay": float(settings.GUIDE_VAD_ENDPOINTING_DELAY)},
    )
    if base_language(language) not in SEMANTIC_TURN_LANGUAGES:
        return fallback
    if not getattr(settings, "SEMANTIC_TURN_DETECTION_ENABLED", True):
        return fallback
    try:
        from livekit.plugins.turn_detector.multilingual import MultilingualModel

        started = time.monotonic()
        detector = MultilingualModel()
        logger.info(
            "[GUIDE] semantic turn detection on (%s, built in %.0fms)",
            base_language(language),
            (time.monotonic() - started) * 1000,
        )
        return detector, {
            "min_endpointing_delay": float(settings.TURN_MIN_ENDPOINTING_DELAY),
            "max_endpointing_delay": float(settings.TURN_MAX_ENDPOINTING_DELAY),
        }
    except Exception as exc:  # noqa: BLE001 - never fail a session over this
        logger.warning("[GUIDE] semantic turn detection unavailable (%s); VAD", exc)
        return fallback
