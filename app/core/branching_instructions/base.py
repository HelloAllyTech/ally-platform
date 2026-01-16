"""
Data models for branching instructions.
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

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
    def create(
        cls, instruction: str, prompt_data: Optional[Dict[str, Any]] = None
    ) -> "BranchingInstruction":
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

        if not prompt_data:
            return cls(instruction, variable_tags, static_tags, dynamic_tags)

        substitution_map = cls._build_substitution_map(prompt_data)

        final_content, unresolved_tags = cls._resolve_static_variables(
            content=instruction, tags=static_tags, substitution_map=substitution_map
        )

        print("\n\n Using Final Branching Instruction ", final_content)

        return cls(
            content=final_content,
            variable_tags=variable_tags,
            static_tags=unresolved_tags,
            dynamic_tags=dynamic_tags,
        )

    @staticmethod
    def _build_substitution_map(prompt_data: Dict[str, Any]) -> Dict[str, str]:
        """
        Extracts and flattens data from prompt_data into a single key-value map.
        Handles 'context' and 'customFields' list.
        """
        mapping = {}

        if "context" in prompt_data:
            mapping["your context"] = str(prompt_data["context"])

        custom_fields = prompt_data.get("customFields", [])
        if isinstance(custom_fields, list):
            for item in custom_fields:
                key = item.get("field")
                val = item.get("value")

                if key and val:
                    clean_key = key.strip()
                    mapping[clean_key] = str(val)

        return mapping

    @staticmethod
    def _resolve_static_variables(
        content: str, tags: List[str], substitution_map: Dict[str, str]
    ) -> Tuple[str, List[str]]:
        """
        Performs string substitution for found variables.
        Returns the updated content and a list of tags that could not be resolved.
        """
        unresolved_tags = []
        updated_content = content

        for tag in tags:
            # We look for the exact tag string in our map
            # Because regex allows spaces, 'favourite colour' is a valid key
            if tag in substitution_map:
                value = substitution_map[tag]
                updated_content = updated_content.replace(f"<{tag}>", value)
            else:
                unresolved_tags.append(tag)

        return updated_content, unresolved_tags
