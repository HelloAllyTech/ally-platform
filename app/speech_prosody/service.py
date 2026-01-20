"""
Speech prosody service for orchestrating parameter generation and application.
"""

from typing import Any, Dict, List, Optional

from app.core.scenario.base import Scenario
from app.llms import BaseLLMClient
from app.speech_prosody.generator import (
    generate_default_parameters,
    generate_runtime_parameters,
)
from app.tts.base import BaseTTSClient
from app.utils.logger import get_logger

logger = get_logger(__name__)


class SpeechProsodyService:
    """
    Service for generating and applying speech prosody parameters.

    This service orchestrates the prosody generation process,
    separating orchestration logic from TTS provider-specific implementations.
    """

    def __init__(self, tts_client: BaseTTSClient):
        """
        Initialize speech prosody service.

        Args:
            tts_client: TTS client instance with parameter metadata and
                application methods. The TTS client's _current_params and
                _default_params are used as the persistent store for state.
        """
        self.tts_client = tts_client
        # Use TTS client's state as persistent store (it persists across calls)
        # Initialize from TTS client if it already has state
        if hasattr(tts_client, "_current_params") and tts_client._current_params:
            self._current_params = tts_client._current_params.copy()
        else:
            self._current_params: Dict[str, Any] = {}

        if hasattr(tts_client, "_default_params") and tts_client._default_params:
            self._default_params = tts_client._default_params.copy()
        else:
            self._default_params: Dict[str, Any] = {}

    async def generate_and_set_defaults(
        self,
        scenario: Scenario,
        llm_client: BaseLLMClient,
    ) -> None:
        """
        Generate and set default parameter values from scenario.

        Args:
            scenario: Complete scenario with all prompt data
            llm_client: LLM client for generation
        """
        # Get parameter metadata from provider
        parameter_metadata = self.tts_client.get_parameter_metadata()

        # If provider doesn't support prosody parameters, skip
        if not parameter_metadata:
            logger.debug(
                "Provider does not support prosody parameters, " "skipping set_defaults"
            )
            self._default_params = {}
            self._current_params = {}
            return

        try:
            logger.info(
                f"[Speech Prosody] Starting default parameter generation "
                f"for scenario '{scenario.name if scenario.name else 'unnamed'}'"
            )
            # Generate defaults using LLM
            params_dict = await generate_default_parameters(
                scenario=scenario,
                llm_client=llm_client,
                parameter_metadata=parameter_metadata,
            )

            if not params_dict:
                logger.warning(
                    "[Speech Prosody] Could not generate defaults from LLM, "
                    "using safe defaults"
                )
                raise ValueError("Failed to generate parameter dict from LLM")

            # Validate dict against metadata
            validated_dict = self.tts_client._validate_parameters_dict(params_dict)

            # Store as defaults (single source of truth)
            self._default_params = validated_dict.copy()
            self._current_params = validated_dict.copy()

            # Sync to TTS client for persistence across service instances
            self.tts_client._default_params = validated_dict.copy()
            self.tts_client._current_params = validated_dict.copy()

            # Apply parameters directly
            self.tts_client._apply_parameters_dict(validated_dict)

            logger.info(f"[Speech Prosody] Set defaults from LLM: {validated_dict}")

        except Exception as e:
            logger.error(
                f"[Speech Prosody] Failed to generate defaults: {e}", exc_info=True
            )
            # Set safe defaults from metadata
            safe_defaults = self._get_safe_defaults(parameter_metadata)
            self._default_params = safe_defaults.copy()
            self._current_params = safe_defaults.copy()

            # Sync to TTS client for persistence
            self.tts_client._default_params = safe_defaults.copy()
            self.tts_client._current_params = safe_defaults.copy()

            if safe_defaults:
                logger.info(
                    f"[Speech Prosody] Set defaults from safe defaults "
                    f"(metadata): {safe_defaults}"
                )
                try:
                    self.tts_client._apply_parameters_dict(safe_defaults)
                except Exception as apply_error:
                    # Log but don't fail - safe defaults are set even if
                    # application fails
                    logger.warning(
                        f"[Speech Prosody] Failed to apply safe defaults "
                        f"to TTS instance: {apply_error}. "
                        f"Defaults are still stored and will be used."
                    )
            else:
                logger.info("[Speech Prosody] No safe defaults available from metadata")

    async def generate_and_apply_runtime(
        self,
        response_text: str,
        llm_client: BaseLLMClient,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        persona_context: Optional[Dict[str, Any]] = None,
        conversation_history_limit: int = 10,
    ) -> Optional[str]:
        """
        Generate and apply runtime prosody parameters and enhanced text.

        Args:
            response_text: The generated response text to analyze
            llm_client: LLM client for generation
            conversation_history: List of conversation messages (last N messages)
            persona_context: Dict with essential persona information
            conversation_history_limit: Maximum number of conversation messages

        Returns:
            Enhanced text with provider-specific tags if text enhancement is
            supported, None otherwise. Parameters are always applied regardless
            of return value.
        """
        # Get parameter metadata from provider
        parameter_metadata = self.tts_client.get_parameter_metadata()
        if not parameter_metadata:
            logger.debug(
                "Provider does not support prosody parameters, " "skipping generation"
            )
            return None

        # Get text enhancement instructions if supported
        enhancement_instructions = self.tts_client.get_text_enhancement_instructions()

        logger.debug(
            f"[Speech Prosody] Starting runtime parameter generation "
            f"(text enhancement: "
            f"{'supported' if enhancement_instructions else 'not supported'})"
        )

        # Generate parameters and enhanced text
        params_dict, enhanced_text = await generate_runtime_parameters(
            response_text=response_text,
            llm_client=llm_client,
            parameter_metadata=parameter_metadata,
            conversation_history=conversation_history,
            persona_context=persona_context,
            conversation_history_limit=conversation_history_limit,
            enhancement_instructions=enhancement_instructions,
            current_parameters=self._current_params,
        )

        if not params_dict:
            logger.warning(
                "[Speech Prosody] No valid prosody parameters "
                "generated, using defaults"
            )
            return enhanced_text

        # Log the parameters created by the LLM
        logger.info(f"[Speech Prosody] LLM generated parameters: {params_dict}")

        # Validate parameters against metadata
        validated_dict = self.tts_client._validate_parameters_dict(params_dict)

        if validated_dict:
            # Log validation results
            if len(validated_dict) != len(params_dict):
                rejected = set(params_dict.keys()) - set(validated_dict.keys())
                logger.warning(
                    f"[Speech Prosody] Some parameters were rejected "
                    f"during validation: {rejected}"
                )

            # Trust LLM to generate smoothed parameters based on current parameters
            # The LLM receives current_parameters in the prompt and is instructed
            # to make smooth transitions, so we apply the LLM's values directly

            # Get current params from TTS client (persistent store) if available
            if (
                hasattr(self.tts_client, "_current_params")
                and self.tts_client._current_params
            ):
                self._current_params = self.tts_client._current_params.copy()

            previous_params = self._current_params.copy()

            # Store and apply LLM-generated parameters directly
            self._current_params.update(validated_dict)

            # Sync to TTS client for persistence across service instances
            self.tts_client._current_params = self._current_params.copy()

            # Apply parameters to TTS
            self.tts_client._apply_parameters_dict(validated_dict)

            # Log parameter transition for visibility
            if previous_params:
                changes = {
                    k: f"{previous_params.get(k, 'N/A')} → {v}"
                    for k, v in validated_dict.items()
                    if k not in previous_params or previous_params[k] != v
                }
                if changes:
                    logger.info(
                        f"[Speech Prosody] Applied parameters: {validated_dict} "
                        f"(changes: {changes})"
                    )
                else:
                    logger.debug(
                        f"[Speech Prosody] Applied parameters: {validated_dict} "
                        f"(no changes from previous: {previous_params})"
                    )
            else:
                logger.info(
                    f"[Speech Prosody] Applied parameters: {validated_dict} "
                    f"(first utterance, no previous parameters)"
                )
        else:
            logger.warning(
                "[Speech Prosody] No valid prosody parameters "
                "generated, using defaults"
            )

        # Return enhanced text if text enhancement is supported, None otherwise
        return enhanced_text

    def _get_safe_defaults(self, parameter_metadata: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get safe default values from parameter metadata.

        Args:
            parameter_metadata: Parameter metadata from TTS provider

        Returns:
            Dict with safe default values
        """
        safe_defaults = {}
        for param_name, param_meta in parameter_metadata.items():
            if "default" in param_meta:
                default_value = param_meta["default"]
                # Only add if default is not None
                if default_value is not None:
                    safe_defaults[param_name] = default_value
        return safe_defaults

    def get_current_parameters(self) -> Dict[str, Any]:
        """Get current parameter values."""
        return self._current_params.copy()

    def get_default_parameters(self) -> Dict[str, Any]:
        """Get default parameter values."""
        return self._default_params.copy()
