"""
Utility functions for speech prosody generation.
"""

import json
from typing import Any, Dict, List, Optional, Tuple

from app.utils.logger import get_logger

logger = get_logger(__name__)

# Whitelist of PromptData fields relevant for prosody decisions
PERSONA_CONTEXT_FIELDS = {
    "personality": "Personality",
    "tone": "Tone",
    "emotional_needs": "Emotional Needs",
    "starting_state": "Starting State",
    "context": "Context",
}


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


def extract_persona_context_from_prompt_data(
    prompt_data: Any,
    field_whitelist: Optional[Dict[str, str]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Extract persona context from PromptData object in a defensive way.

    Uses getattr() to safely access fields, so it won't break if fields
    are removed or renamed. Only extracts fields in the whitelist.

    Args:
        prompt_data: PromptData instance (or any object with attributes)
        field_whitelist: Dict mapping field names to display names.
            If None, uses PERSONA_CONTEXT_FIELDS default.

    Returns:
        Dict with persona information, or None if no valid fields found
    """
    if not prompt_data:
        return None

    if field_whitelist is None:
        field_whitelist = PERSONA_CONTEXT_FIELDS

    persona_context = {}
    extracted_fields = []
    missing_fields = []

    # Defensively extract each field using getattr with None default
    for field_name in field_whitelist.keys():
        try:
            value = getattr(prompt_data, field_name, None)
            # Only include non-empty values
            if value and isinstance(value, str) and value.strip():
                persona_context[field_name] = value.strip()
                extracted_fields.append(field_name)
            else:
                missing_fields.append(field_name)
        except (AttributeError, TypeError):
            # Field doesn't exist or isn't accessible - skip it
            missing_fields.append(field_name)
            continue

    # Return None if no valid fields were extracted
    result = persona_context if persona_context else None
    return result


def format_persona_context(
    persona_context: Optional[Dict[str, Any]],
    field_whitelist: Optional[Dict[str, str]] = None,
) -> str:
    """
    Format persona context into a readable string.
    Only includes fields from the whitelist.

    Args:
        persona_context: Dict with persona information
        field_whitelist: Dict mapping field names to display names.
            If None, uses PERSONA_CONTEXT_FIELDS default.

    Returns:
        Formatted persona context string
    """
    if not persona_context:
        return "No persona context available."

    if field_whitelist is None:
        field_whitelist = PERSONA_CONTEXT_FIELDS

    persona_lines = []
    formatted_fields = []

    # Only format fields that are in both persona_context and whitelist
    for field_name, display_name in field_whitelist.items():
        value = persona_context.get(field_name)
        if value and isinstance(value, str) and value.strip():
            persona_lines.append(f"{display_name}: {value}")
            formatted_fields.append(field_name)

    result = (
        "\n".join(persona_lines) if persona_lines else "No persona context available."
    )

    return result


def build_prosody_prompt(
    response_text: str,
    parameter_metadata_json: str,
    persona_context_text: str,
    conversation_history_text: str,
    conversation_history_count: int,
    enhancement_instructions: Optional[str],
    prompt_with_enhancement: str,
    prompt_parameters_only: str,
    current_parameters: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Build the prosody generation prompt.

    Args:
        response_text: The response text to analyze
        parameter_metadata_json: JSON string of parameter metadata
        persona_context_text: Formatted persona context
        conversation_history_text: Formatted conversation history
        conversation_history_count: Number of messages in history (unused,
            kept for compatibility)
        enhancement_instructions: Text enhancement instructions if supported
        prompt_with_enhancement: Prompt template with text enhancement
        prompt_parameters_only: Prompt template for parameters only
        current_parameters: Current parameter values for context (optional)

    Returns:
        Formatted prompt string
    """
    # Format current parameters for prompt
    if current_parameters and len(current_parameters) > 0:
        current_parameters_json = json.dumps(current_parameters, indent=2)
    else:
        current_parameters_json = (
            "No current parameters available. Generate appropriate parameters "
            "based on the response text, persona, and context."
        )

    if enhancement_instructions:
        prompt = prompt_with_enhancement.format(
            persona_context=persona_context_text,
            conversation_history=conversation_history_text,
            conversation_history_count=conversation_history_count,
            response_text=response_text,
            parameter_metadata=parameter_metadata_json,
            text_enhancement_instructions=enhancement_instructions,
            current_parameters=current_parameters_json,
        )
        return prompt
    else:
        prompt = prompt_parameters_only.format(
            persona_context=persona_context_text,
            conversation_history=conversation_history_text,
            conversation_history_count=conversation_history_count,
            response_text=response_text,
            parameter_metadata=parameter_metadata_json,
            current_parameters=current_parameters_json,
        )
        return prompt


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
            return parsed
        else:
            # If content is valid JSON but not a dict (e.g., array), return None
            # Don't try substring extraction - the content was already valid JSON
            return None
    except json.JSONDecodeError:
        pass

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
                    return parsed
            except json.JSONDecodeError:
                pass

    logger.warning(
        f"Failed to parse JSON from LLM response. "
        f"Content type: {type(response)}, Content preview: {content[:200]}..."
    )
    return None


def extract_prosody_result(
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
