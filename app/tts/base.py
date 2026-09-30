"""
Base TTS client interface.
"""

import asyncio
import weakref
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Set

from langchain_core.tools import BaseTool

from app.core.logger import get_logger

logger = get_logger(__name__)

# Clients whose clip-policy refusal has already been logged (see
# BaseTTSClient._clip_policy_allows). Weak, so a finished session's client
# is not kept alive by a log-once flag.
_CLIP_POLICY_LOGGED: "weakref.WeakSet[BaseTTSClient]" = weakref.WeakSet()

# Strong references to pending aclose() tasks for discarded clip instances;
# asyncio keeps only a weak one.
_PENDING_CLIP_CLOSES: Set["asyncio.Task"] = set()


def _discard_clip_instance(instance) -> None:
    """Close a clip TTS instance that was built but will not be returned.

    Without this a failure after the build orphans an open plugin instance
    (its HTTP session / websocket pool) for every clip batch. Best-effort.
    """
    aclose = getattr(instance, "aclose", None)
    if aclose is None:
        return
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        try:
            asyncio.run(aclose())
        except Exception:  # noqa: BLE001 - closing is best-effort
            logger.debug("[CLIP_TTS] closing discarded clip instance failed")
        return

    from app.core.tasks import spawn_background_task

    spawn_background_task(
        aclose(), name="clip-tts-discard", background_tasks=_PENDING_CLIP_CLOSES
    )


@dataclass
class AudioResult:
    audio_bytes: bytes
    format: str  # "mp3", "wav", "pcm"
    sample_rate: int
    duration_ms: Optional[int] = None


class BaseTTSClient(ABC):
    """
    Abstract base class for TTS clients.

    Provides interface for text-to-speech providers.
    """

    def __init__(self):
        """Initialize parameter storage."""
        # Store current parameters as dict (for get_defaults_for_learn_service)
        self._current_params: Dict[str, Any] = {}
        self._default_params: Dict[str, Any] = {}

    def allows_clip_synthesis(self) -> bool:
        """Whether this voice may be rendered as offline clips at all.

        Each clip (thinking filler, back-channel, interim reply) is an
        independent generation on a separate TTS instance, played on the
        background track just before the real reply. For a fixed-speaker model
        that is the same voice. For a generative one — ElevenLabs v3,
        Gemini-TTS, Hume — every request is a fresh draw of the speaker, so
        the clip is heard as a second voice immediately before the character's
        own, which is the "voice changes" report in another form.

        Fails closed: a client opts in by overriding this for the configs known
        to hold one speaker across generations. Anything not classified here,
        including a new provider or model, gets no clips until someone checks.
        """
        return False

    def _clip_policy_allows(self) -> bool:
        """``allows_clip_synthesis()``, logging a refusal once per session.

        Every session builds its own client, so once per client is once per
        session. The logged flag is kept off the instance: ``voice_fingerprint``
        hashes scalar attributes, and the clip cache key must not change
        because a log line was written.
        """
        try:
            if self.allows_clip_synthesis() is True:
                return True
        except Exception:  # noqa: BLE001 - a broken policy check fails closed
            logger.warning(
                "[CLIP_TTS] clip policy check failed for %s; treating as off",
                type(self).__name__,
                exc_info=True,
            )
        if self not in _CLIP_POLICY_LOGGED:
            _CLIP_POLICY_LOGGED.add(self)
            logger.info(
                "[CLIP_TTS] clips off for this session: reason=generative_voice "
                "client=%s model=%s voice=%s",
                type(self).__name__,
                getattr(self, "_model", None) or getattr(self, "_model_name", None),
                getattr(self, "_voice_name", None)
                or getattr(self, "_voice_id", None)
                or getattr(self, "_speaker", None)
                or getattr(self, "_voice", None),
            )
        return False

    def can_create_clip_tts(self) -> bool:
        """Whether ``create_clip_tts()`` will try to build an instance.

        True when the clip policy allows this voice and the client builds its
        instance lazily (so a clone can build a fresh one). Callers check it
        BEFORE the LLM calls that write filler, back-channel and interim
        phrases: those phrases can only be heard through a clip, so generating
        them for a voice that will never render one is paid for and discarded.
        """
        return self._clip_policy_allows() and hasattr(self, "_tts_instance")

    def create_clip_tts(self):
        """A SEPARATE underlying TTS instance for offline clip rendering
        (thinking fillers, backchannels, interim replies).

        Clip synthesis must never run on the AgentSession's own TTS instance:
        the session subscribes to that instance's "error" events and CLOSES
        THE WHOLE SESSION after a few unrecoverable ones
        (agent_session._on_error). Observed in prod 2026-08-20: Sarvam
        one-shot clip failures emitted TTSErrors on the shared instance and
        killed live Marathi sessions mid-reply, leaving zombie rooms.

        Every provider client here builds ``tts_instance`` lazily from stored
        params, so a shallow clone with the cached instance cleared rebuilds a
        fresh, isolated instance. Returns ``None`` when the clip policy refuses
        this voice (``allows_clip_synthesis``) or isolation isn't possible —
        callers must then SKIP clip synthesis, never fall back to the shared
        instance.
        """
        if not self._clip_policy_allows():
            return None

        import copy

        clone = None
        new_instance = None
        try:
            clone = copy.copy(self)
            # Deep-copy the parameter dicts so the isolated instance gets the
            # current voice settings but does not share any future changes. A
            # shallow copy (the copy.copy default) shares the underlying dict,
            # so a voice-expression change on the main instance mid-synthesis
            # would change the clip's voice mid-utterance.
            for attr in ("_current_params", "_default_params"):
                if hasattr(clone, attr):
                    setattr(clone, attr, copy.deepcopy(getattr(clone, attr)))

            if not hasattr(clone, "_tts_instance"):
                return None
            clone._tts_instance = None
            new_instance = clone.tts_instance
            # Re-apply stored parameters, because not all provider clients do
            # so on instance creation. Read defensively: a client that skipped
            # super().__init__() has no _current_params, and reading it
            # unguarded here disabled every clip for four providers (d35bb31).
            params = getattr(clone, "_current_params", None) or {}
            if params:
                clone._apply_parameters_dict(params)
            return new_instance
        except Exception:  # noqa: BLE001 - isolation is best-effort
            logger.warning(
                "[CLIP_TTS] could not build an isolated clip TTS for %s — "
                "skipping clips rather than using the session's instance",
                type(self).__name__,
                exc_info=True,
            )
            built = new_instance
            if built is None and clone is not None:
                built = getattr(clone, "_tts_instance", None)
            if built is not None and built is not getattr(self, "_tts_instance", None):
                _discard_clip_instance(built)
            return None

    @property
    @abstractmethod
    def tts_instance(self):
        """
        Get the underlying TTS instance from the provider library.

        Returns:
            TTS instance (e.g., deepgram.TTS, elevenlabs.TTS, sarvam.TTS)
        """
        pass

    def get_parameter_metadata(self) -> Dict[str, Any]:
        """
        Get metadata about available voice parameters.

        Looks for PARAMETER_METADATA class constant. Subclasses should define
        PARAMETER_METADATA with provider-specific parameter names and metadata.

        Returns:
            Dict with parameter names as keys, metadata as values
        """
        # Look for PARAMETER_METADATA class constant
        if hasattr(self.__class__, "PARAMETER_METADATA"):
            return getattr(self.__class__, "PARAMETER_METADATA")
        return {}

    def get_tools(self) -> List[BaseTool]:
        """
        Get single tool for setting voice parameters.

        Returns:
            List with set_voice_parameters tool
        """
        return [self._create_set_voice_parameters_tool()]

    def _create_set_voice_parameters_tool(self) -> BaseTool:
        """Create tool that accepts dict from LLM."""
        import json

        from langchain_core.tools import tool

        @tool
        def set_voice_parameters(parameters: str) -> str:
            """
            Set voice expression parameters.

            Accepts a JSON string with parameter names as keys.
            Use the parameter metadata from the prompt to see available
            parameters and ranges.

            Args:
                parameters: JSON string with parameter dict

            Returns:
                Confirmation message
            """
            # Parse dict from LLM
            try:
                if isinstance(parameters, str):
                    params_dict = json.loads(parameters)
                else:
                    params_dict = parameters
            except json.JSONDecodeError as e:
                return f"Invalid JSON: {e}"

            # Validate dict against metadata
            validated_dict = self._validate_parameters_dict(params_dict)

            # Store and apply
            self._current_params.update(validated_dict)
            self._apply_parameters_dict(validated_dict)

            # Build confirmation
            updates = [f"{k}={v}" for k, v in validated_dict.items()]
            return f"Voice parameters updated: {', '.join(updates)}"

        return set_voice_parameters

    def _validate_parameters_dict(self, params_dict: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validate parameters dict against metadata.

        Args:
            params_dict: Dict from LLM with parameter names as keys

        Returns:
            Validated dict (values may be clamped/adjusted)
        """
        metadata = self.get_parameter_metadata()
        validated = {}

        for param_name, param_value in params_dict.items():
            if param_value is None:
                continue

            # Check if parameter exists in metadata
            param_meta = metadata.get(param_name)
            if not param_meta:
                logger.warning(
                    f"[Voice Expressions] Unknown parameter: {param_name}, "
                    f"skipping. Available parameters: {list(metadata.keys())}"
                )
                continue

            # Validate based on type
            param_type = param_meta.get("type")
            validated_value = param_value

            # Type validation
            if param_type == "float" and not isinstance(param_value, (int, float)):
                try:
                    validated_value = float(param_value)
                    logger.debug(
                        f"[Voice Expressions] Converted {param_name} to float: "
                        f"{param_value} -> {validated_value}"
                    )
                except (ValueError, TypeError):
                    default_value = param_meta.get("default")
                    if default_value is None:
                        logger.warning(
                            f"[Voice Expressions] Invalid {param_name} value: "
                            f"{param_value} and no default available, skipping"
                        )
                        continue
                    logger.warning(
                        f"[Voice Expressions] Invalid {param_name} value: "
                        f"{param_value}, using default: {default_value}"
                    )
                    validated_value = default_value

            # Range validation for numeric types
            if param_type == "float" and "range" in param_meta:
                range_val = param_meta["range"]
                if not isinstance(range_val, (list, tuple)) or len(range_val) != 2:
                    logger.warning(
                        f"[Voice Expressions] Invalid range format for "
                        f"{param_name}: {range_val}, skipping range validation"
                    )
                else:
                    min_val, max_val = range_val
                    original_value = validated_value
                    if validated_value < min_val or validated_value > max_val:
                        logger.warning(
                            f"[Voice Expressions] {param_name} {validated_value} "
                            f"outside range [{min_val}, {max_val}], "
                            f"clamping to valid range"
                        )
                        validated_value = max(min_val, min(max_val, validated_value))
                        logger.info(
                            f"[Voice Expressions] {param_name} clamped: "
                            f"{original_value} -> {validated_value}"
                        )

            # Only add to validated dict if value is not None
            if validated_value is not None:
                validated[param_name] = validated_value
                logger.debug(
                    f"[Voice Expressions] ✓ Validated parameter {param_name} = "
                    f"{validated_value}"
                )
            else:
                logger.warning(
                    f"[Voice Expressions] Skipping {param_name} with None value"
                )

        return validated

    def supports_text_enhancement(self) -> bool:
        """
        Whether this provider supports inline text enhancement (audio tags / SSML).

        This is a capability flag only — the actual instruction text now lives in
        prompt management (prompt code ``ally_ai_learn_system_audio_tag_guidance``,
        local fallback ``app/prompts/system/audio_tag_guidance.txt``) so it can be
        edited by superadmins. Callers gate on this flag, then resolve the text via
        ``app.prompts.resolver.load_template("system/audio_tag_guidance", ...)``.

        Returns:
            True if the provider can interpret inline audio tags, else False.
        """
        return False

    def get_defaults_for_learn_service(self) -> dict:
        """
        Get default parameter values for learn service.

        Returns the cached default parameters set on this client, or an empty
        dict if none have been set.
        """
        if hasattr(self, "_default_params"):
            return self._default_params.copy()
        return {}

    def _apply_parameters(self) -> None:
        """
        Apply current parameter values to TTS instance.

        Uses stored _current_params dict.
        """
        if self._current_params:
            self._apply_parameters_dict(self._current_params)

    def _apply_parameters_dict(self, params_dict: Dict[str, Any]) -> None:
        """
        Apply validated parameters dict to TTS instance via update_options().

        Parameter names in dict should match provider API option names directly.

        Args:
            params_dict: Validated dict with parameter names as keys
                (parameter names should match provider API option names)
        """
        try:
            if self.tts_instance is None:
                logger.warning(
                    "[Voice Expressions] Cannot apply parameters: TTS instance is None"
                )
                return

            if not params_dict:
                logger.debug("[Voice Expressions] No parameters to apply (empty dict)")
                return

            # Apply directly - parameter names should already match provider API
            if hasattr(self.tts_instance, "update_options"):
                self.tts_instance.update_options(**params_dict)
            else:
                logger.warning(
                    f"[Voice Expressions] TTS instance does not have "
                    f"update_options() method. Type: {type(self.tts_instance)}"
                )

        except Exception as e:
            logger.error(f"Failed to update TTS options: {e}", exc_info=True)

    def _wrap_stream_with_timeout(self, tts_instance: Any) -> None:
        """
        Wrap the stream method of a TTS instance with a timeout.

        Args:
            tts_instance: The TTS instance to wrap.
        """
        if not hasattr(tts_instance, "stream") or hasattr(
            tts_instance, "_timeout_wrapped"
        ):
            return

        from livekit.agents import APIConnectOptions

        from app.core.config import settings

        original_stream = getattr(tts_instance, "stream")

        def custom_stream(
            conn_options: Optional[APIConnectOptions] = None,
        ) -> Any:
            if conn_options is None:
                conn_options = APIConnectOptions(timeout=settings.TTS_TIMEOUT)
            else:
                from dataclasses import replace

                conn_options = replace(conn_options, timeout=settings.TTS_TIMEOUT)
            return original_stream(conn_options=conn_options)

        object.__setattr__(tts_instance, "stream", custom_stream)
        object.__setattr__(tts_instance, "_timeout_wrapped", True)
