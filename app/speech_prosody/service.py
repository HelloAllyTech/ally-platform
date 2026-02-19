"""
Speech prosody service for orchestrating parameter generation and application.
"""

import hashlib
import json
import os
from typing import Any, Dict, List, Optional

from app.core.logger import get_logger
from app.core.scenario.base import Scenario
from app.llms import BaseLLMClient
from app.speech_prosody.constants import (
    DEFAULT_CONVERSATION_HISTORY_LIMIT,
    MAX_TURN_DELTA_PERCENT,
)
from app.speech_prosody.generator import (
    generate_default_parameters,
    generate_runtime_parameters,
)
from app.speech_prosody.safety import clamp_value, sanitize_ssml
from app.speech_prosody.utils import extract_persona_context_from_prompt_data
from app.tts.base import BaseTTSClient

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

    # Persistent cache configuration
    _CACHE_FILE_PATH = "/tmp/speech_prosody_cache.json"
    _DEFAULTS_CACHE: Dict[str, Dict[str, Any]] = {}
    _CACHE_MAX_SIZE = 100

    def _load_cache(self) -> None:
        """Load cache from file system."""
        if not os.path.exists(self._CACHE_FILE_PATH):
            return

        try:
            with open(self._CACHE_FILE_PATH, "r") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict):
                    # Update class-level cache
                    SpeechProsodyService._DEFAULTS_CACHE.update(loaded)
                    logger.info(
                        f"[Speech Prosody] Loaded {len(loaded)} items from "
                        "persistent cache"
                    )
        except Exception as e:
            logger.warning(f"[Speech Prosody] Failed to load persistent cache: {e}")

    def _save_cache(self) -> None:
        """Save cache to file system."""
        try:
            # Basic atomic-ish write
            temp_path = f"{self._CACHE_FILE_PATH}.tmp"
            with open(temp_path, "w") as f:
                json.dump(SpeechProsodyService._DEFAULTS_CACHE, f)
            os.rename(temp_path, self._CACHE_FILE_PATH)
            logger.debug("[Speech Prosody] Saved persistent cache to disk")
        except Exception as e:
            logger.warning(f"[Speech Prosody] Failed to save persistent cache: {e}")

    def _generate_cache_key(self, scenario: Scenario) -> str:
        """
        Generate a stable cache key based on scenario content that affects prosody.

        Args:
            scenario: The scenario to generate key for

        Returns:
            String hash of the relevant scenario data
        """
        # Extract fields that influence default prosody generation
        pd = scenario.prompt_data

        # Create a dict of relevant fields
        relevant_data = {
            "scenario_name": scenario.name,
            "age": pd.age,
            "gender": pd.gender,
            "tone": pd.tone,
            "emotional_needs": pd.emotional_needs,
            "personality": pd.personality,
            "opening_statements": pd.opening_statements,
            "agent_goal": pd.agent_goal,
            # Include minimal voice config identifying info
            "voice_provider": scenario.voice.provider if scenario.voice else None,
            "voice_name": scenario.voice.name if scenario.voice else None,
        }

        # Serialize to JSON with sorted keys for stability
        json_str = json.dumps(relevant_data, sort_keys=True)

        # Generate SHA-256 hash
        return hashlib.sha256(json_str.encode()).hexdigest()

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
        logger.info("[Speech Prosody] generate_and_set_defaults entered")
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
            # Ensure class-level cache is populated from disk if empty
            if not self._DEFAULTS_CACHE:
                self._load_cache()

            # Check cache first
            cache_key = self._generate_cache_key(scenario)
            if cache_key in self._DEFAULTS_CACHE:
                logger.info("[Speech Prosody] Cache HIT for default parameters")
                params_dict = self._DEFAULTS_CACHE[cache_key].copy()
            else:
                logger.info(
                    "[Speech Prosody] Cache MISS for default parameters, generating..."
                )
                # Generate defaults using LLM
                params_dict = await generate_default_parameters(
                    scenario=scenario,
                    llm_client=llm_client,
                    parameter_metadata=parameter_metadata,
                )

                # Cache the result if valid
                if params_dict:
                    # Simple LRU-like eviction if cache full
                    if len(self._DEFAULTS_CACHE) >= self._CACHE_MAX_SIZE:
                        self._DEFAULTS_CACHE.pop(next(iter(self._DEFAULTS_CACHE)))

                    self._DEFAULTS_CACHE[cache_key] = params_dict.copy()
                    # Persist to disk
                    self._save_cache()

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

            # Log default parameters
            logger.info(f"[Speech Prosody] Set default parameters: {validated_dict}")

            # Apply parameters directly
            self.tts_client._apply_parameters_dict(validated_dict)

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

    async def generate_and_apply_runtime(
        self,
        response_text: str,
        llm_client: BaseLLMClient,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        persona_context: Optional[Dict[str, Any]] = None,
        conversation_history_limit: int = DEFAULT_CONVERSATION_HISTORY_LIMIT,
        current_parameters: Optional[Dict[str, Any]] = None,
        backend_prompts: Optional[Dict[str, str]] = None,
    ) -> Optional[str]:
        """
        Generate and apply runtime prosody parameters and enhanced text.

        Args:
            response_text: The generated response text to analyze
            llm_client: LLM client for generation
            conversation_history: List of conversation messages (last N messages)
            persona_context: Dict with essential persona information
            conversation_history_limit: Maximum number of conversation messages
            current_parameters: Optional current parameters for context.
                If None, uses self._current_params. If empty dict {}, generates
                fresh parameters without context (useful for termination).

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

        # Determine which current parameters to use
        # If explicitly passed, use that (None = use self._current_params, {} = fresh)
        # Otherwise use self._current_params
        params_for_context = (
            current_parameters
            if current_parameters is not None
            else self._current_params
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
            current_parameters=params_for_context,
            backend_prompts=backend_prompts,
        )

        if not params_dict:
            logger.warning(
                "[Speech Prosody] No valid prosody parameters "
                "generated, using defaults"
            )
            return enhanced_text

        # Validate parameters against metadata
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

            # Get current params from TTS client (persistent store) if available
            # This is our baseline for smoothing
            if (
                hasattr(self.tts_client, "_current_params")
                and self.tts_client._current_params
            ):
                self._current_params = self.tts_client._current_params.copy()

            # Smooth parameters to prevent dramatic changes
            # This is the SAFETY LAYER that overrides LLM if it goes too far
            smoothed_dict = self._smooth_parameters(
                validated_dict, self._current_params, parameter_metadata
            )

            # Store and apply smoothed parameters
            self._current_params.update(smoothed_dict)

            # Sync to TTS client for persistence across service instances
            self.tts_client._current_params = self._current_params.copy()

            # Apply parameters to TTS
            self.tts_client._apply_parameters_dict(smoothed_dict)

            # Log successfully applied parameters
            logger.info(f"[Speech Prosody] Applied parameters: {smoothed_dict}")
        else:
            logger.warning(
                "[Speech Prosody] No valid prosody parameters "
                "generated, using defaults"
            )

        # Sanitize enhanced text
        if enhanced_text:
            enhanced_text = sanitize_ssml(enhanced_text)

        # Return enhanced text if text enhancement is supported, None otherwise
        return enhanced_text

    def _smooth_parameters(
        self,
        new_params: Dict[str, Any],
        current_params: Dict[str, Any],
        parameter_metadata: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Smooth parameters to prevent dramatic changes.

        Args:
            new_params: New parameters from LLM
            current_params: Current parameters
            parameter_metadata: Parameter metadata from provider

        Returns:
            Smoothed parameters
        """
        smoothed = {}

        for param_name, new_value in new_params.items():
            # Get current value (default to 0.0 or provider default if not found)
            current_value = current_params.get(param_name)

            # If no current value, look for default in metadata
            if current_value is None and param_name in parameter_metadata:
                current_value = parameter_metadata[param_name].get("default")

            # If still None, we can't smooth, just take new value
            if current_value is None:
                smoothed[param_name] = new_value
                continue

            # Check if parameter has range metadata
            param_meta = parameter_metadata.get(param_name, {})
            min_val = -100.0  # Default wide range
            max_val = 100.0

            if "range" in param_meta:
                range_vals = param_meta["range"]
                if len(range_vals) >= 2:
                    min_val = float(range_vals[0])
                    max_val = float(range_vals[1])

            # Apply clamping
            # Use MAX_TURN_DELTA_PERCENT (10%) as limit
            try:
                smoothed_val = clamp_value(
                    float(new_value),
                    float(current_value),
                    min_val,
                    max_val,
                    MAX_TURN_DELTA_PERCENT,
                )
                smoothed[param_name] = smoothed_val

                # Log if significant smoothing happened
                if abs(smoothed_val - float(new_value)) > 0.01:
                    logger.info(
                        f"[Speech Prosody] Smoothed {param_name}: "
                        f"{new_value} -> {smoothed_val} "
                        f"(current: {current_value})"
                    )
            except (ValueError, TypeError) as e:
                # If values aren't floats, can't smooth safely
                logger.warning(
                    f"Could not smooth parameter {param_name}: {e}. "
                    f"Using new value {new_value}"
                )
                smoothed[param_name] = new_value

        return smoothed

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


async def generate_and_apply_prosody_for_message(
    tts_client: BaseTTSClient,
    message_text: str,
    llm_client: BaseLLMClient,
    scenario: Optional[Scenario] = None,
    conversation_history: Optional[List[Dict[str, str]]] = None,
    conversation_history_limit: int = DEFAULT_CONVERSATION_HISTORY_LIMIT,
    current_parameters: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Generate and apply prosody parameters for a message (e.g., termination message).

    This is a convenience function that handles the common pattern of:
    1. Creating a SpeechProsodyService instance
    2. Extracting persona context from scenario (if provided)
    3. Generating and applying prosody parameters
    4. Returning the enhanced text (or original if enhancement failed)

    Args:
        tts_client: TTS client instance
        message_text: The message text to generate prosody for
        llm_client: LLM client for generation
        scenario: Optional scenario to extract persona context from
        conversation_history: Optional conversation history
        conversation_history_limit: Maximum number of conversation messages
        current_parameters: Optional current parameters for context.
            If None, uses service's current params. If empty dict {},
            generates fresh parameters without context.

    Returns:
        Enhanced text with provider-specific tags if text enhancement is
        supported, otherwise the original message_text. Parameters are always
        applied regardless of return value.
    """
    try:
        prosody_service = SpeechProsodyService(tts_client)

        # Extract persona context from scenario if available
        persona_context = None
        if scenario and scenario.prompt_data:
            persona_context = extract_persona_context_from_prompt_data(
                scenario.prompt_data
            )

        # Extract backend prompts from scenario for template resolution
        backend_prompts = (
            getattr(scenario.prompt_data, "prompts", None) if scenario else None
        )

        # Generate and apply prosody parameters
        enhanced_text = await prosody_service.generate_and_apply_runtime(
            response_text=message_text,
            llm_client=llm_client,
            conversation_history=conversation_history,
            persona_context=persona_context,
            conversation_history_limit=conversation_history_limit,
            current_parameters=current_parameters,
            backend_prompts=backend_prompts,
        )

        # Return enhanced text if available, otherwise original
        return enhanced_text if enhanced_text else message_text

    except Exception as e:
        logger.warning(
            f"Failed to generate prosody parameters for message: {e}. "
            "Using original message without enhancement."
        )
        return message_text
