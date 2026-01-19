"""
Base TTS client interface.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

from langchain_core.tools import BaseTool

from app.core.graph.prompt import generate_prompt_content
from app.core.scenario.base import Scenario
from app.llms import BaseLLMClient
from app.utils.logger import get_logger
from app.utils.voice_expression_utils import (
    build_voice_expression_prompt,
    extract_voice_expression_result,
    format_conversation_history,
    format_persona_context,
    invoke_llm_with_json_mode,
    parse_llm_json_response,
)

logger = get_logger(__name__)

DEFAULT_GENERATION_PROMPT = """
Based on the following scenario prompt, analyze the character and determine
appropriate default values for voice parameters.

SCENARIO PROMPT:
{prompt_content}

AVAILABLE PARAMETERS:
{parameter_metadata}

Analyze the character's personality, emotional state, tone, context, and needs.
Then return appropriate default values for all available voice parameters.

Consider:
- The character's personality and emotional state
- The context and situation
- The tone and style guidelines
- The emotional needs and goals
- The parameter ranges specified above

Return a JSON object with parameter names as keys and appropriate default values.
"""

VOICE_EXPRESSION_GENERATION_PROMPT = """
Analyze the following response text and determine appropriate voice expression
parameters.

RESPONSE TEXT:
{response_text}

AVAILABLE PARAMETERS:
{parameter_metadata}

Analyze the emotional tone, urgency, context, and intent of the response.
Then return appropriate voice expression parameters.

Consider:
- The emotional tone (excited, calm, empathetic, urgent, etc.)
- The urgency level
- The context and situation
- The intent and purpose of the response
- The parameter ranges specified above

Return ONLY a JSON object with parameter names as keys and appropriate values.
No other text.
"""

UNIFIED_VOICE_EXPRESSION_PROMPT_WITH_ENHANCEMENT = """
Analyze the following response text and generate both voice expression
parameters and enhanced text.

PERSONA CONTEXT (for voice expression decisions):
{persona_context}

CONVERSATION HISTORY (last {conversation_history_count} messages):
{conversation_history}

CURRENT RESPONSE TEXT:
{response_text}

AVAILABLE PARAMETERS:
{parameter_metadata}

TEXT ENHANCEMENT RULES:
{text_enhancement_instructions}

Analyze the emotional tone, urgency, context, and intent of the response.
Consider the conversation history and persona context to understand the
emotional arc and character consistency. Then generate:

1. Voice expression parameters (JSON object with parameter names as keys)
2. Enhanced text with appropriate tags/formatting based on the rules above

Consider:
- The conversation history and emotional progression
- The character's personality, tone, and emotional state from the persona context
- The emotional tone (excited, calm, empathetic, urgent, etc.)
- The urgency level
- The context and situation
- The intent and purpose of the response
- The parameter ranges specified above
- Add expression tags at the beginning of sentences/phrases where emotion
  changes
- Add break tags for natural pauses (e.g., after periods, commas, or for
  dramatic effect)
- Keep the original text intact, only add tags/formatting

Return a JSON object with this exact structure:
{{
  "parameters": {{
    "parameter_name": value,
    ...
  }},
  "enhanced_text": "text with tags added based on the rules above"
}}

CRITICAL RULES:
1. Return ONLY the JSON object. No explanatory text, no comments.
2. The "enhanced_text" field must contain ONLY the text with tags - it must
   NOT contain the parameters dict.
3. Parameters go in the "parameters" field ONLY - never in "enhanced_text".
4. Start your response with {{ and end with }}. Nothing else.
"""

VOICE_EXPRESSION_PARAMETERS_ONLY_PROMPT = """
Analyze the following response text and determine appropriate voice
expression parameters.

PERSONA CONTEXT (for voice expression decisions):
{persona_context}

CONVERSATION HISTORY (last {conversation_history_count} messages):
{conversation_history}

CURRENT RESPONSE TEXT:
{response_text}

AVAILABLE PARAMETERS:
{parameter_metadata}

Analyze the emotional tone, urgency, context, and intent of the response.
Consider the conversation history and persona context to understand the
emotional arc and character consistency. Then return appropriate voice
expression parameters.

Consider:
- The conversation history and emotional progression
- The character's personality, tone, and emotional state from the persona context
- The emotional tone (excited, calm, empathetic, urgent, etc.)
- The urgency level
- The context and situation
- The intent and purpose of the response
- The parameter ranges specified above

CRITICAL: Return ONLY a valid JSON object with parameter names as keys and
appropriate values.
Do NOT include any explanatory text, do NOT repeat the response text,
do NOT add any comments.
Start your response with {{ and end with }}. Nothing else.
"""


class BaseTTSClient(ABC):
    """
    Abstract base class for TTS clients.

    Provides interface for text-to-speech providers.
    """

    def __init__(self):
        """Initialize parameter storage."""
        # Store current parameters as dict
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

    async def set_defaults(
        self,
        scenario: Scenario,
        llm_client: BaseLLMClient,
    ) -> None:
        """
        Generate and set default parameter values from scenario.

        Gets metadata from provider, passes to LLM, gets dict back,
        validates and applies.

        Args:
            scenario: Complete scenario with all prompt data
            llm_client: LLM client for generation
        """
        # Get parameter metadata from provider
        parameter_metadata = self.get_parameter_metadata()

        # If provider doesn't support voice expression parameters,
        # skip setting defaults
        if not parameter_metadata:
            logger.debug(
                "Provider does not support voice expression parameters, "
                "skipping set_defaults"
            )
            self._default_params = {}
            self._current_params = {}
            return

        try:
            # Get prompt content (same as agent LLM uses)
            prompt_content = generate_prompt_content(
                prompt_data=scenario.prompt_data,
                next_instruction=None,
            )

            import json

            parameter_metadata_json = json.dumps(parameter_metadata, indent=2)

            # Create generation prompt with metadata
            generation_prompt = DEFAULT_GENERATION_PROMPT.format(
                prompt_content=prompt_content,
                parameter_metadata=parameter_metadata_json,
            )

            # Invoke LLM with JSON mode for better JSON parsing
            llm_instance = llm_client.llm_instance
            response = await invoke_llm_with_json_mode(llm_instance, generation_prompt)

            # Log response for debugging
            logger.debug(
                f"[Voice Expressions] LLM response type: {type(response)}, "
                f"has content: {hasattr(response, 'content')}"
            )
            if hasattr(response, "content"):
                logger.debug(
                    f"[Voice Expressions] LLM response content preview: "
                    f"{str(response.content)[:200]}..."
                )

            # Parse JSON dict from LLM response using utility function
            params_dict = parse_llm_json_response(response)

            if not params_dict:
                logger.warning(
                    "Could not parse JSON from LLM response, using safe defaults"
                )
                raise ValueError("Failed to parse parameter dict from LLM")

            # Validate dict against metadata
            validated_dict = self._validate_parameters_dict(params_dict)

            # Store as defaults
            self._default_params = validated_dict.copy()
            self._current_params = validated_dict.copy()

            # Apply parameters directly
            self._apply_parameters_dict(validated_dict)

            logger.info(f"Set defaults from LLM: {validated_dict}")

        except Exception as e:
            logger.error(f"Failed to generate defaults: {e}", exc_info=True)
            # Set safe defaults from metadata
            metadata = self.get_parameter_metadata()
            safe_defaults = {}
            for param_name, param_meta in metadata.items():
                if "default" in param_meta:
                    default_value = param_meta["default"]
                    # Only add if default is not None
                    if default_value is not None:
                        safe_defaults[param_name] = default_value
            self._default_params = safe_defaults.copy()
            self._current_params = safe_defaults.copy()
            if safe_defaults:
                logger.info(
                    f"Set defaults from safe defaults (metadata): {safe_defaults}"
                )
                try:
                    self._apply_parameters_dict(safe_defaults)
                except Exception as apply_error:
                    # Log but don't fail - safe defaults are set even if
                    # application fails
                    logger.warning(
                        f"Failed to apply safe defaults to TTS instance: "
                        f"{apply_error}. Defaults are still stored and "
                        f"will be used."
                    )
            else:
                logger.info("No safe defaults available from metadata")

    async def generate_and_apply_voice_expressions(
        self,
        response_text: str,
        llm_client: BaseLLMClient,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        persona_context: Optional[Dict[str, Any]] = None,
        conversation_history_limit: int = 10,
    ) -> Optional[str]:
        """
        Generate and apply voice expression parameters and enhanced text in
        a single LLM call.

        This unified method:
        1. Generates voice expression parameters based on response text,
           conversation history, and persona
        2. Generates enhanced text with provider-specific tags (if supported)
        3. Applies parameters to TTS instance via update_options()
        4. Returns enhanced text if text enhancement is supported, None otherwise

        Args:
            response_text: The generated response text to analyze
            llm_client: LLM client for generation
            conversation_history: List of conversation messages (last N
                messages) as dicts with 'role' and 'content'
            persona_context: Dict with essential persona information for
                voice decisions:
                - personality: Character's personality traits
                - tone: Desired tone/style
                - emotional_needs: What emotional response is needed
                - starting_state: Current emotional state
                - context: Brief situation context
            conversation_history_limit: Maximum number of conversation
                messages to include (default: 10)

        Returns:
            Enhanced text with provider-specific tags (SSML/speech tags) if
            text enhancement is supported, None otherwise.
            Parameters are always applied via update_options() regardless of
            return value.
        """
        try:
            import json

            # Get parameter metadata from provider
            parameter_metadata = self.get_parameter_metadata()
            if not parameter_metadata:
                logger.debug(
                    "Provider does not support voice expression parameters, "
                    "skipping generation"
                )
                return None

            parameter_metadata_json = json.dumps(parameter_metadata, indent=2)

            # Format conversation history and persona context using utilities
            conversation_history_text, conversation_history_count = (
                format_conversation_history(
                    conversation_history, conversation_history_limit
                )
            )
            persona_context_text = format_persona_context(persona_context)

            # Get text enhancement instructions if supported
            enhancement_instructions = self.get_text_enhancement_instructions()

            # Build prompt using utility
            generation_prompt = build_voice_expression_prompt(
                response_text=response_text,
                parameter_metadata_json=parameter_metadata_json,
                persona_context_text=persona_context_text,
                conversation_history_text=conversation_history_text,
                conversation_history_count=conversation_history_count,
                enhancement_instructions=enhancement_instructions,
                prompt_with_enhancement=(
                    UNIFIED_VOICE_EXPRESSION_PROMPT_WITH_ENHANCEMENT
                ),
                prompt_parameters_only=VOICE_EXPRESSION_PARAMETERS_ONLY_PROMPT,
            )

            # Invoke LLM using utility
            llm_instance = llm_client.llm_instance
            response = await invoke_llm_with_json_mode(llm_instance, generation_prompt)

            # Parse JSON response using utility
            result_dict = parse_llm_json_response(response)
            if not result_dict:
                logger.warning(
                    "Could not parse JSON from LLM response for unified "
                    "voice expressions"
                )
                return None

            # Extract parameters and enhanced text using utility
            params_dict, enhanced_text = extract_voice_expression_result(
                result_dict, enhancement_instructions, response_text
            )

            # Log the parameters created by the LLM
            logger.info(f"[Voice Expressions] LLM generated parameters: {params_dict}")

            # Validate parameters against metadata
            validated_dict = self._validate_parameters_dict(params_dict)

            if validated_dict:
                # Log validation results
                if len(validated_dict) != len(params_dict):
                    rejected = set(params_dict.keys()) - set(validated_dict.keys())
                    logger.warning(
                        f"[Voice Expressions] Some parameters were rejected "
                        f"during validation: {rejected}"
                    )

                # Store and apply parameters via update_options()
                # - this is the ONLY place parameters go
                self._current_params.update(validated_dict)
                self._apply_parameters_dict(validated_dict)
            else:
                logger.warning(
                    "[Voice Expressions] No valid voice expression parameters "
                    "generated, using defaults"
                )

            # Return enhanced text if text enhancement is supported,
            # None otherwise
            # Parameters have already been applied via update_options() above
            # The returned text goes to TTS messages - parameters should
            # NEVER be in this text
            return enhanced_text

        except Exception as e:
            logger.error(
                f"Failed to generate unified voice expressions: {e}", exc_info=True
            )
            return None

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
        """Get default parameter values for learn service."""
        return self._default_params.copy()

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
