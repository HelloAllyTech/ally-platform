"""
Parser for branching instruction dynamic variables.

This module extracts variable tags (e.g., <variable_name>) from branching instructions
and categorizes them as static or dynamic.
"""

import re
from typing import Dict, List, Set, Tuple

from app.core.branching_instructions.constants import BRANCHING_DYNAMIC_VARIABLES

# Regex pattern to match <variable_name> tags
VARIABLE_TAG_PATTERN = re.compile(r"<([a-zA-Z_][a-zA-Z0-9_ ]*)>")

# Regex pattern to match <llm_response(parameter)> tags
LLM_RESPONSE_PATTERN = re.compile(r"<llm_response\(([^)]+)\)>")


def extract_variable_tags(instruction: str) -> List[str]:
    """
    Extract all variable tags from a branching instruction.

    Extracts content between < and > angle brackets that follow variable naming rules:
    - Must start with letter or underscore
    - Can contain letters, numbers, underscores

    Args:
        instruction: Branching instruction string
            (e.g., "agree to <last_helper_utterance>")

    Returns:
        List of variable names found (e.g., ["last_helper_utterance"])

    Examples:
        >>> extract_variable_tags("agree to <last_helper_utterance>")
        ["last_helper_utterance"]

        >>> extract_variable_tags("Your name is <name> and context is <context>")
        ["name", "context"]

        >>> extract_variable_tags("No variables here")
        []
    """
    matches = VARIABLE_TAG_PATTERN.findall(instruction)
    return matches


def is_dynamic_variable(tag: str) -> bool:
    """
    Check if a variable tag is dynamic (changes during conversation).

    Uses BRANCHING_DYNAMIC_VARIABLES list to determine if a variable
    needs to be re-evaluated each time the branching instruction is used.

    Args:
        tag: Variable tag name (e.g., "last_helper_utterance")

    Returns:
        True if the variable is dynamic, False if static
    """
    return tag in BRANCHING_DYNAMIC_VARIABLES


def parse_instruction(instruction: str) -> Tuple[List[str], List[str], List[str]]:
    """
    Parse a branching instruction and categorize its variables.

    Extracts all variable tags and separates them into:
    - Static variables: Can be pre-computed at conversation start
    - Dynamic variables: Must be evaluated at runtime

    Args:
        instruction: Branching instruction string

    Returns:
        Tuple of (variable_tags, static_tags, dynamic_tags)

    Examples:
        >>> variable_tags, static_tags, dynamic_tags = parse_instruction(
        ...     "Your context is <context>, agree to <last_helper_utterance>"
        ... )
        >>> static_tags
        ["context"]
        >>> dynamic_tags
        ["last_helper_utterance"]
    """
    variable_tags = extract_variable_tags(instruction)

    # Remove duplicates while preserving order
    seen: Set[str] = set()
    unique_tags = []
    for tag in variable_tags:
        if tag not in seen:
            seen.add(tag)
            unique_tags.append(tag)

    # Categorize as static or dynamic
    static_tags = [tag for tag in unique_tags if not is_dynamic_variable(tag)]
    dynamic_tags = [tag for tag in unique_tags if is_dynamic_variable(tag)]

    return unique_tags, static_tags, dynamic_tags


def extract_llm_response_tags(instruction: str) -> Dict[str, str]:
    """
    Extract llm_response tags with their parameters from a branching instruction.

    Extracts tags in the format <llm_response(parameter)> and returns a mapping
    of the full tag to its parameter.

    Args:
        instruction: Branching instruction string
            (e.g., "respond with <llm_response(facts about exercise)>")

    Returns:
        Dict mapping full tag to parameter
        (e.g., {"llm_response(facts about exercise)": "facts about exercise"})

    Examples:
        >>> extract_llm_response_tags("use <llm_response(facts about exercise)>")
        {"llm_response(facts about exercise)": "facts about exercise"}

        >>> extract_llm_response_tags("No llm_response here")
        {}
    """
    matches = LLM_RESPONSE_PATTERN.findall(instruction)
    result = {}
    for param in matches:
        full_tag = f"llm_response({param})"
        result[full_tag] = param
    return result
