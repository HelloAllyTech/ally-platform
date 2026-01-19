"""
Utility functions for voice expression generation.
"""

import json
from typing import Any, Dict, List, Optional, Tuple

from app.utils.logger import get_logger

logger = get_logger(__name__)


def format_conversation_history(
    conversation_history: Optional[List[Dict[str, str]]],
    limit: int = 10,
) -> Tuple[str, int]:
    """
    Format conversation history into a readable string.

    Args:
        conversation_history: List of conversation messages with 'role' and 'content'
        limit: Maximum number of messages to include

    Returns:
        Tuple of (formatted_history_text, message_count)
    """
    if not conversation_history:
        return "No conversation history available.", 0

    # Ensure limit is positive
    if limit <= 0:
        limit = 10
        logger.warning(
            f"Invalid conversation_history_limit ({limit}), using default: 10"
        )

    limited_history = conversation_history[-limit:]
    history_count = len(limited_history)
    history_lines = []

    for msg in limited_history:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        history_lines.append(f"{role}: {content}")

    history_text = (
        "\n".join(history_lines)
        if history_lines
        else "No conversation history available."
    )
    return history_text, history_count


def format_persona_context(persona_context: Optional[Dict[str, Any]]) -> str:
    """
    Format persona context into a readable string.
    Only includes essential fields for voice expression decisions.

    Args:
        persona_context: Dict with persona information

    Returns:
        Formatted persona context string
    """
    if not persona_context:
        return "No persona context available."

    persona_lines = []
    # Only include fields directly relevant to voice expression decisions
    if persona_context.get("personality"):
        persona_lines.append(f"Personality: {persona_context['personality']}")
    if persona_context.get("tone"):
        persona_lines.append(f"Tone: {persona_context['tone']}")
    if persona_context.get("emotional_needs"):
        persona_lines.append(f"Emotional Needs: {persona_context['emotional_needs']}")
    if persona_context.get("starting_state"):
        persona_lines.append(f"Starting State: {persona_context['starting_state']}")
    if persona_context.get("context"):
        persona_lines.append(f"Context: {persona_context['context']}")

    return (
        "\n".join(persona_lines) if persona_lines else "No persona context available."
    )


def build_voice_expression_prompt(
    response_text: str,
    parameter_metadata_json: str,
    persona_context_text: str,
    conversation_history_text: str,
    conversation_history_count: int,
    enhancement_instructions: Optional[str],
    prompt_with_enhancement: str,
    prompt_parameters_only: str,
) -> str:
    """
    Build the voice expression generation prompt.

    Args:
        response_text: The response text to analyze
        parameter_metadata_json: JSON string of parameter metadata
        persona_context_text: Formatted persona context
        conversation_history_text: Formatted conversation history
        conversation_history_count: Number of messages in history
        enhancement_instructions: Text enhancement instructions if supported
        prompt_with_enhancement: Prompt template with text enhancement
        prompt_parameters_only: Prompt template for parameters only

    Returns:
        Formatted prompt string
    """
    if enhancement_instructions:
        return prompt_with_enhancement.format(
            persona_context=persona_context_text,
            conversation_history=conversation_history_text,
            conversation_history_count=conversation_history_count,
            response_text=response_text,
            parameter_metadata=parameter_metadata_json,
            text_enhancement_instructions=enhancement_instructions,
        )
    else:
        return prompt_parameters_only.format(
            persona_context=persona_context_text,
            conversation_history=conversation_history_text,
            conversation_history_count=conversation_history_count,
            response_text=response_text,
            parameter_metadata=parameter_metadata_json,
        )


async def invoke_llm_with_json_mode(llm_instance, prompt: str) -> Any:
    """
    Invoke LLM with JSON mode if available, otherwise regular invocation.

    Args:
        llm_instance: LLM instance to invoke
        prompt: Prompt string to send

    Returns:
        LLM response
    """
    if hasattr(llm_instance, "bind") and "response_format" in dir(llm_instance):
        json_llm = llm_instance.bind(response_format={"type": "json_object"})
        return await json_llm.ainvoke(prompt)
    else:
        return await llm_instance.ainvoke(prompt)


def parse_llm_json_response(response: Any) -> Optional[Dict[str, Any]]:
    """
    Parse JSON from LLM response.

    Handles both JSON mode responses and regular responses that may contain JSON.

    Args:
        response: LLM response object

    Returns:
        Parsed JSON dict, or None if parsing failed
    """
    if hasattr(response, "content"):
        content = response.content.strip()
    else:
        content = str(response).strip()

    # Try to parse the entire content as JSON first (for JSON mode responses)
    try:
        parsed = json.loads(content)
        # Only return dictionaries, not arrays or other types
        if isinstance(parsed, dict):
            logger.debug(
                f"Successfully parsed JSON from LLM response (JSON mode): {parsed}"
            )
            return parsed
        else:
            # If content is valid JSON but not a dict (e.g., array), return None
            # Don't try substring extraction - the content was already valid JSON
            logger.debug(
                f"Parsed JSON is not a dict (type: {type(parsed)}), "
                f"ignoring. Content: {content[:200]}..."
            )
            return None
    except json.JSONDecodeError as e:
        logger.debug(
            f"Failed to parse entire content as JSON: {e}. Content: {content[:200]}..."
        )

    # If that fails, try to extract JSON from content (for regular responses)
    # Look for JSON object that starts with { and ends with }
    if "{" in content and "}" in content:
        start_idx = content.find("{")
        end_idx = content.rfind("}")
        if start_idx < end_idx:
            json_str = content[start_idx : end_idx + 1]
            try:
                parsed = json.loads(json_str)
                # Only return dictionaries, not arrays or other types
                if isinstance(parsed, dict):
                    logger.debug(
                        f"Successfully extracted and parsed JSON from LLM "
                        f"response: {parsed}"
                    )
                    return parsed
                else:
                    logger.debug(
                        f"Extracted JSON is not a dict (type: {type(parsed)}), "
                        f"ignoring. Extracted: {json_str[:200]}..."
                    )
            except json.JSONDecodeError as e:
                logger.debug(
                    f"Failed to parse extracted JSON: {e}. "
                    f"Extracted: {json_str[:200]}..."
                )

    logger.warning(
        f"Failed to parse JSON from LLM response. "
        f"Content type: {type(response)}, Content preview: {content[:200]}..."
    )
    return None


def extract_voice_expression_result(
    result_dict: Dict[str, Any],
    enhancement_instructions: Optional[str],
    response_text: str,
) -> Tuple[Dict[str, Any], Optional[str]]:
    """
    Extract parameters and enhanced text from parsed JSON response.

    Args:
        result_dict: Parsed JSON dict from LLM
        enhancement_instructions: Text enhancement instructions if supported
        response_text: Original response text (fallback for enhanced_text)

    Returns:
        Tuple of (params_dict, enhanced_text)
    """
    # Validate result_dict is actually a dict
    if not isinstance(result_dict, dict):
        logger.error(
            f"result_dict is not a dict (type: {type(result_dict)}). "
            f"Returning empty params."
        )
        return {}, None

    if enhancement_instructions:
        # Text enhancement supported - expect:
        # {"parameters": {...}, "enhanced_text": "..."}
        params_dict = result_dict.get("parameters", {})
        if not isinstance(params_dict, dict):
            logger.warning(
                f"parameters is not a dict (type: {type(params_dict)}). "
                f"Using empty dict."
            )
            params_dict = {}

        enhanced_text = result_dict.get("enhanced_text", response_text)

        # Validate enhanced_text is a string (not a dict)
        if not isinstance(enhanced_text, str):
            logger.error(
                f"enhanced_text is not a string (type: {type(enhanced_text)}). "
                f"Using original response_text."
            )
            enhanced_text = response_text
    else:
        # Text enhancement not supported - result_dict IS the parameters dict
        params_dict = result_dict if isinstance(result_dict, dict) else {}
        enhanced_text = None

    return params_dict, enhanced_text
