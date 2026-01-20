"""
LLM generation logic for speech prosody.
"""

import json
from typing import Any, Dict, List, Optional

from app.core.graph.prompt import generate_prompt_content
from app.core.scenario.base import Scenario
from app.llms import BaseLLMClient
from app.speech_prosody import prompts
from app.speech_prosody.utils import (
    build_prosody_prompt,
    extract_prosody_result,
    invoke_llm_with_json_mode,
    parse_llm_json_response,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)


async def generate_default_parameters(
    scenario: Scenario,
    llm_client: BaseLLMClient,
    parameter_metadata: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """
    Generate default prosody parameters from scenario.

    Args:
        scenario: Complete scenario with all prompt data
        llm_client: LLM client for generation
        parameter_metadata: Parameter metadata from TTS provider

    Returns:
        Dict with parameter names as keys and default values, or None if failed
    """
    try:
        # Get prompt content (same as agent LLM uses)
        prompt_content = generate_prompt_content(
            prompt_data=scenario.prompt_data,
            next_instruction=None,
        )

        parameter_metadata_json = json.dumps(parameter_metadata, indent=2)

        logger.info(
            f"[Speech Prosody] Generating default parameters "
            f"(scenario: {scenario.name if scenario.name else 'unnamed'}, "
            f"metadata params: {list(parameter_metadata.keys())})"
        )

        # Create generation prompt with metadata
        generation_prompt = prompts.DEFAULT_GENERATION_PROMPT.format(
            prompt_content=prompt_content,
            parameter_metadata=parameter_metadata_json,
        )

        logger.debug(
            f"[Speech Prosody] Default generation prompt length: "
            f"{len(generation_prompt)} chars, "
            f"prompt_content length: {len(prompt_content)} chars"
        )

        # Invoke LLM with JSON mode for better JSON parsing
        llm_instance = llm_client.llm_instance
        response = await invoke_llm_with_json_mode(llm_instance, generation_prompt)

        # Log response for debugging
        logger.debug(
            f"[Speech Prosody] LLM response type: {type(response)}, "
            f"has content: {hasattr(response, 'content')}"
        )
        if hasattr(response, "content"):
            logger.debug(
                f"[Speech Prosody] LLM response content preview: "
                f"{str(response.content)[:200]}..."
            )

        # Parse JSON dict from LLM response
        params_dict = parse_llm_json_response(response)

        if not params_dict:
            logger.warning(
                "[Speech Prosody] Could not parse JSON from LLM response "
                "for default parameters"
            )
            return None

        logger.info(
            f"[Speech Prosody] Successfully generated default parameters: "
            f"{list(params_dict.keys())}"
        )
        logger.debug(f"[Speech Prosody] Default parameter values: {params_dict}")

        return params_dict

    except Exception as e:
        logger.error(f"Failed to generate default parameters: {e}", exc_info=True)
        return None


async def generate_runtime_parameters(
    response_text: str,
    llm_client: BaseLLMClient,
    parameter_metadata: Dict[str, Any],
    conversation_history: Optional[List[Dict[str, str]]] = None,
    persona_context: Optional[Dict[str, Any]] = None,
    conversation_history_limit: int = 10,
    enhancement_instructions: Optional[str] = None,
    current_parameters: Optional[Dict[str, Any]] = None,
) -> tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Generate runtime prosody parameters and enhanced text.

    Args:
        response_text: The generated response text to analyze
        llm_client: LLM client for generation
        parameter_metadata: Parameter metadata from TTS provider
        conversation_history: List of conversation messages (last N messages)
        persona_context: Dict with essential persona information
        conversation_history_limit: Maximum number of conversation messages
        enhancement_instructions: Text enhancement instructions if supported
        current_parameters: Current parameter values for context

    Returns:
        Tuple of (params_dict, enhanced_text) or (None, None) if failed
    """
    try:
        from app.speech_prosody.utils import (
            format_conversation_history,
            format_persona_context,
        )

        parameter_metadata_json = json.dumps(parameter_metadata, indent=2)

        # Format conversation history and persona context
        conversation_history_text, conversation_history_count = (
            format_conversation_history(
                conversation_history, conversation_history_limit
            )
        )
        persona_context_text = format_persona_context(persona_context)

        logger.info(
            f"[Speech Prosody] Generating runtime parameters "
            f"(response length: {len(response_text)} chars, "
            f"history: {conversation_history_count} messages, "
            f"persona fields: "
            f"{list(persona_context.keys()) if persona_context else 'none'}, "
            f"metadata params: {list(parameter_metadata.keys())})"
        )

        # Build prompt
        generation_prompt = build_prosody_prompt(
            response_text=response_text,
            parameter_metadata_json=parameter_metadata_json,
            persona_context_text=persona_context_text,
            conversation_history_text=conversation_history_text,
            conversation_history_count=conversation_history_count,
            enhancement_instructions=enhancement_instructions,
            prompt_with_enhancement=prompts.UNIFIED_PROMPT_WITH_ENHANCEMENT,
            prompt_parameters_only=prompts.PARAMETERS_ONLY_PROMPT,
            current_parameters=current_parameters,
        )

        # Invoke LLM
        llm_instance = llm_client.llm_instance
        logger.debug("[Speech Prosody] Invoking LLM for runtime parameter generation")
        response = await invoke_llm_with_json_mode(llm_instance, generation_prompt)

        # Parse JSON response
        result_dict = parse_llm_json_response(response)
        if not result_dict:
            logger.warning(
                "[Speech Prosody] Could not parse JSON from LLM response "
                "for runtime parameters"
            )
            return None, None

        logger.debug(
            f"[Speech Prosody] Successfully parsed LLM response "
            f"(keys: {list(result_dict.keys())})"
        )

        # Extract parameters and enhanced text
        params_dict, enhanced_text = extract_prosody_result(
            result_dict, enhancement_instructions, response_text
        )

        if params_dict:
            logger.debug(
                f"[Speech Prosody] Extracted {len(params_dict)} parameters: "
                f"{list(params_dict.keys())}"
            )
        if enhanced_text and enhanced_text != response_text:
            logger.debug(
                f"[Speech Prosody] Text enhancement applied "
                f"(original: {len(response_text)} chars, "
                f"enhanced: {len(enhanced_text)} chars)"
            )

        return params_dict, enhanced_text

    except Exception as e:
        logger.error(f"Failed to generate runtime parameters: {e}", exc_info=True)
        return None, None
