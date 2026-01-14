"""
Data models for branching instructions.
"""

from dataclasses import dataclass
from typing import List

from app.core.branching_instructions.parser import parse_instruction


@dataclass
class BranchingInstruction:
    """
    Result of parsing a branching instruction.

    This class tracks the instruction content as substitutions are applied.

    Attributes:
        content: Instruction text with substitutions applied
        variable_tags: All variable tags found
            (e.g., ["context", "last_helper_utterance"])
        static_tags: Tags that can be pre-computed
            (e.g., ["context", "name"])
        dynamic_tags: Tags that require runtime evaluation
            (e.g., ["last_helper_utterance"])

    Example:
        >>> parsed = BranchingInstruction.create(
        ...     "Hello <name>, respond to <last_helper_utterance>"
        ... )
        >>> parsed.variable_tags
        ["name", "last_helper_utterance"]
        >>> parsed.static_tags
        ["name"]
        >>> parsed.dynamic_tags
        ["last_helper_utterance"]
        >>> # After static substitution:
        >>> parsed.content = "Hello John, respond to <last_helper_utterance>"
        >>> # After dynamic substitution:
        >>> parsed.content = "Hello John, respond to How are you?"
    """

    content: str
    variable_tags: List[str]
    static_tags: List[str]
    dynamic_tags: List[str]

    @classmethod
    def create(cls, instruction: str) -> "BranchingInstruction":
        """
        Create a BranchingInstruction by parsing a raw instruction string.

        Args:
            instruction: Raw branching instruction string with variable tags
                (e.g., "Hello <name>, respond to <last_helper_utterance>")

        Returns:
            BranchingInstruction with parsed and categorized variables

        Examples:
            >>> instruction = BranchingInstruction.create("Hello <name>")
            >>> instruction.variable_tags
            ["name"]
            >>> instruction.static_tags
            ["name"]
            >>> instruction.dynamic_tags
            []
        """

        variable_tags, static_tags, dynamic_tags = parse_instruction(instruction)
        return cls(
            content=instruction,
            variable_tags=variable_tags,
            static_tags=static_tags,
            dynamic_tags=dynamic_tags,
        )
