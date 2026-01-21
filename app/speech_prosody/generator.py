"""
LLM generation logic for speech prosody.
"""

import json
from typing import Any, Dict, List, Optional

from app.core.scenario.base import Scenario
from app.llms import BaseLLMClient
from app.speech_prosody import prompts
from app.speech_prosody.constants import DEFAULT_CONVERSATION_HISTORY_LIMIT
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
        # Import here to avoid circular dependency with app.core.graph
        from app.core.graph.prompt import generate_prompt_content

        prompt_content = generate_prompt_content(
            prompt_data=scenario.prompt_data,
            next_instruction=None,
        )

        parameter_metadata_json = json.dumps(parameter_metadata, indent=2)

        # Include opening statements in prompt if available
        opening_statements_section = ""
        if (
            scenario.prompt_data
            and scenario.prompt_data.opening_statements
            and len(scenario.prompt_data.opening_statements) > 0
        ):
            opening_statements_text = "\n".join(
                f"- {stmt}" for stmt in scenario.prompt_data.opening_statements
            )
            opening_statements_section = (
                f"\nOPENING STATEMENTS (first words the character will say):\n"
                f"{opening_statements_text}\n"
                f"\nConsider how the character's initial greeting/opening reflects "
                f"their baseline physiological state.\n"
            )

        # Create generation prompt with metadata
        generation_prompt = prompts.DEFAULT_GENERATION_PROMPT.format(
            prompt_content=prompt_content,
            opening_statements_section=opening_statements_section,
            parameter_metadata=parameter_metadata_json,
        )

        # Invoke LLM with JSON mode for better JSON parsing
        llm_instance = llm_client.llm_instance
        response = await invoke_llm_with_json_mode(llm_instance, generation_prompt)

        # Parse JSON dict from LLM response
        params_dict = parse_llm_json_response(response)

        if not params_dict:
            logger.warning(
                "[Speech Prosody] Could not parse JSON from LLM response "
                "for default parameters"
            )
            return None

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
    conversation_history_limit: int = DEFAULT_CONVERSATION_HISTORY_LIMIT,
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
        response = await invoke_llm_with_json_mode(llm_instance, generation_prompt)

        # Parse JSON response
        result_dict = parse_llm_json_response(response)
        if not result_dict:
            logger.warning(
                "[Speech Prosody] Could not parse JSON from LLM response "
                "for runtime parameters"
            )
            return None, None

        # Extract parameters and enhanced text
        params_dict, enhanced_text = extract_prosody_result(
            result_dict, enhancement_instructions, response_text
        )

        return params_dict, enhanced_text

    except Exception as e:
        logger.error(f"Failed to generate runtime parameters: {e}", exc_info=True)
        return None, None
