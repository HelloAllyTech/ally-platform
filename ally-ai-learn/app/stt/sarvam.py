"""Sarvam STT provider implementation."""

import asyncio
import time
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from livekit.plugins import sarvam

from app.core.config import settings
from app.core.constants import convert_language_code_for_sarvam
from app.core.logger import get_logger
from app.stt.base import BaseSTTClient

logger = get_logger(__name__)

# --- Sarvam STT zombie-stream watchdog tuning -----------------------------
#
# After a long utterance + END_SPEECH + flush, the Sarvam server has been
# observed (notably for Malayalam ml-IN) to enter a state where it accepts
# audio chunks indefinitely but stops emitting START_SPEECH / END_SPEECH /
# FINAL_TRANSCRIPT events. The WebSocket ping/pong heartbeat keeps the
# connection technically alive, so the plugin's `_run_connection` just
# waits forever for events that never arrive — the agent goes silent.
#
# Recovery is two parts: (1) fire the plugin's `_reconnect_event` when we
# detect staleness, and (2) make the stream actually reopen afterwards.
# NOTE: in livekit-plugins-sarvam 1.3.12, setting `_reconnect_event` does
# NOT reconnect — `_run_connection` clears the event and `return`s
# normally, and the outer `_run` retry loop treats that return as success
# and `break`s, so the stream silently dies. We therefore also patch
# `_run` (see `_patched_run`) to reopen the WS when the reconnect was
# watchdog-driven (tracked via `self._force_reconnect`).
#
# Tuning:
#  - STALE_THRESHOLD_S: how long the gap between (last audio chunk sent)
#    and (last Sarvam-side event) is allowed to grow before we declare
#    the stream zombie. 15s is roomy enough for a real human pause
#    mid-sentence without false-triggering, but trips well within the
#    minute+ observed in the failure mode.
#  - WATCHDOG_INTERVAL_S: how often the watchdog polls. 3s keeps
#    detection latency low without burning CPU.
#  - On false trigger the cost is one short blip while a fresh WS opens
#    — the next utterance still transcribes — so we bias toward sooner.
SARVAM_STALE_THRESHOLD_S = 15.0
SARVAM_WATCHDOG_INTERVAL_S = 3.0


def _patch_sarvam_stt_url_builder() -> None:
    """
    Monkey-patch _build_websocket_url to include sample_rate=16000 in the URL.

    This fixes a bug in the LiveKit Sarvam plugin where:
    - SpeechStream has sample_rate=16000 (hardcoded)
    - But _build_websocket_url doesn't receive or include it in the URL
    - The Sarvam API requires sample_rate in the URL for proper initialization

    The patch is idempotent - it only applies once, even if called multiple times.
    """
    try:
        import livekit.plugins.sarvam.stt as sarvam_stt_module

        # Only patch if not already patched
        if hasattr(sarvam_stt_module, "_original_build_websocket_url"):
            return  # Already patched

        # Store original function
        original_func = sarvam_stt_module._build_websocket_url
        sarvam_stt_module._original_build_websocket_url = original_func

        def _patched_build_websocket_url(base_url: str, opts: Any) -> str:
            """
            Patched version that preserves existing query params and adds
            sample_rate=16000.

            The original function doesn't include sample_rate, which causes
            "Invalid Audio" errors.
            SpeechStream uses sample_rate=16000 (hardcoded), so we add it to
            the URL here.
            """
            # Extract values from opts (SarvamSTTOptions)
            language = getattr(opts, "language", "en-IN")
            model = getattr(opts, "model", "saarika:v2.5")

            # Parse base_url to preserve existing query parameters
            parsed = urlparse(base_url)
            existing_params = parse_qs(parsed.query, keep_blank_values=True)

            # Add the standard parameters (these will override any existing
            # values with same keys)
            standard_params = {
                "language-code": language,
                "model": model,
                "vad_signals": "true",
            }
            existing_params.update(standard_params)

            # Add sample_rate=16000 (must match audio data sample rate
            # used by SpeechStream)
            existing_params["sample_rate"] = ["16000"]

            # Rebuild URL with all parameters
            new_query = urlencode(existing_params, doseq=True)
            result = urlunparse(
                (
                    parsed.scheme,
                    parsed.netloc,
                    parsed.path,
                    parsed.params,
                    new_query,
                    parsed.fragment,
                )
            )
            return result

        # Apply the patch for URL builder
        sarvam_stt_module._build_websocket_url = _patched_build_websocket_url
        logger.info("Patched _build_websocket_url to include sample_rate=16000")

        # --- Patch 2: SpeechStream.aclose (prevent session closure) ---
        # The plugin's SpeechStream.aclose() closes the shared aiohttp session
        # created by the STT instance. This causes "Session is closed" errors
        # on subsequent turns. We patch it to skip closing the session.

        # original_aclose = sarvam_stt_module.SpeechStream.aclose

        async def _patched_aclose(self) -> None:
            """
            Patched aclose that DOES NOT close the shared aiohttp session.
            """
            # Logic copied from original source but removing session.close()
            self._closing = True

            if self._ws and not self._ws.closed:
                await self._ws.close()

            # Unlock if locked (implementation detail validation might be needed here,
            # but usually lock is released in finally blocks. This matches original
            # source check)
            if self._connection_lock.locked():
                # This is risky if implementation differs, but assuming standard
                # behavior
                pass
                # Original source had:
                # if self._connection_lock.locked():
                #    self._connection_lock.release()
                # But we can't easily access the lock state safely from outside if it's
                # not public?
                # Actually self._connection_lock IS available.

            # Since we are replacing the method, we should call the original BUT
            # the original CLOSES the session. We can't call original.
            # We must reimplement relevant parts.

            # 1. Close WebSocket (already done above)

            # 2. Call parent aclose
            try:
                # Call SpeechStream's parent (SpeechStream) aclose?
                # No, SpeechStream inherits from stt.SpeechStream.
                # We need to call super(SpeechStream, self).aclose()
                await super(sarvam_stt_module.SpeechStream, self).aclose()
            except Exception as e:
                logger.warning(
                    f"[Patched] Error in parent cleanup: {e}",
                    extra={"session_id": getattr(self, "_session_id", "unknown")},
                )

            # 3. DO NOT CLOSE SESSION
            logger.debug(
                "[Patched] Skipping session.close() to preserve shared STT session",
                extra={"session_id": getattr(self, "_session_id", "unknown")},
            )

        # Apply the patch
        sarvam_stt_module.SpeechStream.aclose = _patched_aclose
        logger.info("Patched SpeechStream.aclose to prevent shared session closure")

        # --- Patch 3: zombie-stream watchdog ----------------------------
        # See SARVAM_STALE_THRESHOLD_S constant above for the failure
        # mode this guards against. We instrument three plugin methods:
        #
        #   _handle_transcript_data → updates last_event_time on FINAL_TRANSCRIPT
        #   _handle_events          → updates last_event_time on VAD signals
        #   _process_audio          → updates last_audio_time on every chunk send
        #
        # and add a watchdog task spawned alongside the plugin's existing
        # _audio_task / _message_task in _run_connection. When the gap
        # (now - last_event_time) exceeds the threshold AND audio has
        # flowed within the same window, we fire the plugin's own
        # _reconnect_event — which the plugin handles cleanly by tearing
        # down the WS and opening a fresh one without dropping the
        # SpeechStream object.

        original_handle_transcript_data = (
            sarvam_stt_module.SpeechStream._handle_transcript_data
        )
        original_handle_events = sarvam_stt_module.SpeechStream._handle_events
        original_process_audio = sarvam_stt_module.SpeechStream._process_audio
        original_run_connection = sarvam_stt_module.SpeechStream._run_connection
        original_run = sarvam_stt_module.SpeechStream._run

        def _mark_event(self: Any) -> None:
            self._last_sarvam_event_time = time.monotonic()

        def _mark_audio(self: Any) -> None:
            self._last_audio_send_time = time.monotonic()

        async def _patched_handle_transcript_data(self: Any, data: dict) -> None:
            _mark_event(self)
            await original_handle_transcript_data(self, data)

        async def _patched_handle_events(self: Any, data: dict) -> None:
            _mark_event(self)
            await original_handle_events(self, data)

        async def _patched_process_audio(self: Any, ws: Any) -> None:
            # Wrap ws.send_str so each Sarvam-bound write updates the
            # audio-flowing timestamp. Restore on exit so subsequent
            # connections get a clean WS object.
            original_send_str = ws.send_str

            async def _tracking_send_str(payload: Any) -> Any:
                _mark_audio(self)
                return await original_send_str(payload)

            ws.send_str = _tracking_send_str
            try:
                await original_process_audio(self, ws)
            finally:
                try:
                    ws.send_str = original_send_str
                except Exception:
                    pass

        async def _stale_stream_watchdog(self: Any) -> None:
            """Force reconnect when Sarvam goes zombie (audio flowing, no events)."""
            while not getattr(self, "_closing", False):
                try:
                    await asyncio.sleep(SARVAM_WATCHDOG_INTERVAL_S)
                except asyncio.CancelledError:
                    return
                try:
                    now = time.monotonic()
                    last_event = getattr(self, "_last_sarvam_event_time", now)
                    last_audio = getattr(self, "_last_audio_send_time", 0.0)
                    event_gap = now - last_event
                    # "Audio flowing" = a chunk was sent within the same
                    # window we're measuring staleness against. Avoids
                    # false-triggering when the room is genuinely idle
                    # (e.g. participant muted) — in that case _process_audio
                    # isn't running and we shouldn't be churning the WS.
                    audio_flowing = (now - last_audio) < SARVAM_STALE_THRESHOLD_S
                    if event_gap > SARVAM_STALE_THRESHOLD_S and audio_flowing:
                        logger.warning(
                            "[SARVAM_STT_WATCHDOG] stale stream — no Sarvam event "
                            "for %.1fs while audio flowing (last chunk %.1fs ago); "
                            "forcing reconnect",
                            event_gap,
                            now - last_audio,
                        )
                        # Re-baseline so we don't re-fire before the new
                        # connection has a chance to produce events.
                        self._last_sarvam_event_time = now
                        # Mark this as a watchdog-driven reconnect so the
                        # patched `_run` loop reopens the WS instead of
                        # treating `_run_connection`'s normal return as a
                        # clean stream end. (Plugin 1.3.12's `_run_connection`
                        # returns — not raises — on `_reconnect_event`, and
                        # `_run` `break`s on that return, so without this flag
                        # the stream just dies. See header note.)
                        self._force_reconnect = True
                        try:
                            self._reconnect_event.set()
                        except Exception:
                            logger.exception(
                                "[SARVAM_STT_WATCHDOG] failed to set _reconnect_event"
                            )
                except asyncio.CancelledError:
                    return
                except Exception:
                    logger.exception("[SARVAM_STT_WATCHDOG] error in watchdog loop")

        async def _patched_run_connection(self: Any) -> None:
            # Initialize state on each (re)connection so a freshly opened
            # WS gets a fresh baseline — otherwise an old `last_event_time`
            # from a dead WS could trip the watchdog immediately.
            now = time.monotonic()
            self._last_sarvam_event_time = now
            self._last_audio_send_time = now
            watchdog_task = asyncio.create_task(_stale_stream_watchdog(self))
            try:
                await original_run_connection(self)
            finally:
                watchdog_task.cancel()
                try:
                    await watchdog_task
                except asyncio.CancelledError:
                    pass
                except Exception:
                    logger.exception(
                        "[SARVAM_STT_WATCHDOG] watchdog raised on shutdown"
                    )

        async def _patched_run(self: Any) -> None:
            # The plugin's `_run` retry loop `break`s when `_run_connection`
            # returns normally — which is exactly what happens when the
            # watchdog fires `_reconnect_event` (plugin 1.3.12 clears the
            # event and `return`s, no exception). That terminates STT for
            # good. Wrap `_run` so a watchdog-driven reconnect reopens a
            # fresh connection instead, while genuine stream ends and
            # connection errors still propagate unchanged.
            while True:
                self._force_reconnect = False
                await original_run(self)
                if getattr(self, "_closing", False) or not getattr(
                    self, "_force_reconnect", False
                ):
                    break
                logger.info(
                    "[SARVAM_STT_WATCHDOG] reopening STT connection after "
                    "watchdog-forced reconnect"
                )

        sarvam_stt_module.SpeechStream._handle_transcript_data = (
            _patched_handle_transcript_data
        )
        sarvam_stt_module.SpeechStream._handle_events = _patched_handle_events
        sarvam_stt_module.SpeechStream._process_audio = _patched_process_audio
        sarvam_stt_module.SpeechStream._run_connection = _patched_run_connection
        sarvam_stt_module.SpeechStream._run = _patched_run
        logger.info(
            "Patched SpeechStream with zombie-stream watchdog "
            "(stale_threshold=%.1fs, poll=%.1fs)",
            SARVAM_STALE_THRESHOLD_S,
            SARVAM_WATCHDOG_INTERVAL_S,
        )

    except Exception as e:
        # Log but don't fail - the plugin might work without the patch in some cases
        logger.warning(f"Failed to patch Sarvam STT: {e}")


# Apply patch once at module import time
_patch_sarvam_stt_url_builder()


class SarvamSTTClient(BaseSTTClient):
    """
    Sarvam STT client implementation.

    Uses Sarvam AI's speech-to-text service via LiveKit plugins.
    Sarvam STT accepts BCP 47 format (e.g., "en-IN", "ml-IN", "hi-IN").
    Supports Malayalam and other Indian languages.

    Args:
        model: Sarvam model name (e.g., "saarika:v2.5")
        language_code: BCP 47 language code (e.g., "en-IN", "ml-IN", "hi-IN")
        api_key: Optional API key. If not provided, uses settings.SARVAM_API_KEY
    """

    # Declare language format requirement
    LANGUAGE_FORMAT = "bcp47"

    def __init__(
        self,
        model: str,
        language_code: str,  # BCP 47 format
        api_key: Optional[str] = None,
    ) -> None:
        if not model:
            raise ValueError("Sarvam STT requires 'model' parameter")

        if not language_code:
            raise ValueError("Sarvam STT requires 'language_code' parameter")

        self._model = model

        # Convert language code to Sarvam format (en-GB/en-US -> en-IN, or-IN -> od-IN)
        self._language_code = convert_language_code_for_sarvam(language_code)

        # Use provided API key or fall back to settings
        self._api_key = api_key or settings.SARVAM_API_KEY

        if not self._api_key:
            raise ValueError(
                "Sarvam STT requires 'api_key' parameter or SARVAM_API_KEY in settings"
            )

        logger.debug(
            f"Creating Sarvam STT with model: {model}, language: "
            f"{self._language_code} (from {language_code})"
        )

        # Create the underlying STT instance
        # Note: LiveKit Sarvam STT uses 'language' parameter, not 'language_code'
        # The monkey-patch for _build_websocket_url is applied at module import time
        # high_vad_sensitivity=True enables Sarvam's faster (~0.5s) server-side
        # silence boundary instead of the slower default, to cut EOU/finalization
        # latency for regional-language turns.
        self._stt_instance = sarvam.STT(
            model=self._model,
            language=self._language_code,
            api_key=self._api_key,
            high_vad_sensitivity=True,
        )

    @classmethod
    def from_config(
        cls,
        config: Dict[str, Any],
        language_code: str,
    ) -> "SarvamSTTClient":
        """
        Create Sarvam STT client from config dictionary.

        Args:
            config: Config dict from metadata. Expected structure:
                {"model": "saarika:v2.5"}
            language_code: BCP 47 language code (e.g., "en-IN", "ml-IN", "hi-IN")

        Returns:
            SarvamSTTClient instance
        """
        # Extract model from config
        # Support both nested config structure and flat structure
        # (backward compatibility)
        if "config" in config and isinstance(config["config"], dict):
            config_dict = config["config"]
        else:
            # Backward compatibility: treat entire config as flat structure
            config_dict = config

        model = config_dict.get("model", "saarika:v2.5")  # Default to saarika model

        return cls(
            model=model,
            language_code=language_code,
            api_key=settings.SARVAM_API_KEY,
        )

    @property
    def stt_instance(self) -> sarvam.STT:
        """
        Get the underlying Sarvam STT instance.

        Returns:
            Sarvam STT instance
        """
        return self._stt_instance
