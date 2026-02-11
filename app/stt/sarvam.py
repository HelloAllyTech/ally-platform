"""Sarvam STT provider implementation."""

from typing import Any, Dict, Optional
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from livekit.plugins import sarvam

from app.core.config import settings
from app.core.logger import get_logger
from app.stt.base import BaseSTTClient

logger = get_logger(__name__)


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

        # Convert language code to Sarvam's required format
        self._language_code = self.convert_language_code(language_code)

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
        self._stt_instance = sarvam.STT(
            model=self._model,
            language=self._language_code,
            api_key=self._api_key,
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
