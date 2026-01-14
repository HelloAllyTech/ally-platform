"""
Branching Instructions Module

This module handles parsing and substitution of dynamic variables in
branching instructions.
Variables are categorized as:
- Static: Values that don't change once conversation starts (e.g., <context>, <name>)
- Dynamic: Values that change during conversation
    (e.g., <last_helper_utterance>, <chat_summary>)
"""

from app.core.branching_instructions.base import BranchingInstruction
from app.core.branching_instructions.constants import (
    BRANCHING_DYNAMIC_VARIABLES,
    ReservedBranchingVariable,
)
from app.core.branching_instructions.parser import (
    extract_variable_tags,
    parse_instruction,
)

__all__ = [
    "BRANCHING_DYNAMIC_VARIABLES",
    "BranchingInstruction",
    "ReservedBranchingVariable",
    "extract_variable_tags",
    "parse_instruction",
]
