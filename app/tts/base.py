"""
Base TTS client interface.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from langchain_core.tools import BaseTool

from app.utils.logger import get_logger

logger = get_logger(__name__)


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

    def get_text_enhancement_instructions(self) -> Optional[str]:
        """
        Get text enhancement instructions from metadata if provider supports it.

        Looks for TEXT_ENHANCEMENT_METADATA class constant. Providers can
        define this constant with provider-specific instructions
        (e.g., SSML tags, audio tags, etc.).

        Expected structure:
        TEXT_ENHANCEMENT_METADATA = {
            "instructions": "Provider-specific tag rules and examples..."
        }

        Returns:
            String with text enhancement rules/instructions, or None if
            not supported
        """
        # Look for TEXT_ENHANCEMENT_METADATA class constant
        if hasattr(self.__class__, "TEXT_ENHANCEMENT_METADATA"):
            metadata = getattr(self.__class__, "TEXT_ENHANCEMENT_METADATA")
            if isinstance(metadata, dict):
                return metadata.get("instructions")
        return None

    def get_defaults_for_learn_service(self) -> dict:
        """
        Get default parameter values for learn service.

        Note: This method is kept for backward compatibility. When voice expressions
        are enabled, defaults are managed by SpeechProsodyService. This method returns
        the cached value that was synced from the service, or an empty dict if not set.
        """
        # Return cached value if available (synced from SpeechProsodyService)
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
