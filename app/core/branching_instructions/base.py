"""
Data models for branching instructions.
"""

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple

from langchain_core.messages import BaseMessage

from app.core.branching_instructions.constants import ReservedBranchingVariable
from app.core.branching_instructions.functions.chat_summary import resolve_chat_summary
from app.core.branching_instructions.functions.last_helper_utterance import (
    resolve_last_helper_utterance,
)
from app.core.branching_instructions.functions.llm_response import generate_llm_response
from app.core.branching_instructions.parser import (
    extract_llm_response_tags,
    parse_instruction,
)
from app.core.constants import DEFAULT_LANGUAGE_CODE
from app.core.logger import get_logger

if TYPE_CHECKING:
    from app.llms.base import BaseLLMClient

logger = get_logger(__name__)


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
    _llm_resolved: bool = field(default=False, init=False, repr=False)

    @classmethod
    def create(
        cls, instruction: str, prompt_data: Optional[Dict[str, Any]] = None
    ) -> "BranchingInstruction":
        """
        Create a BranchingInstruction by parsing a raw instruction string.

        Args:
            instruction: Raw branching instruction string with variable tags
                (e.g., "Hello <name>, respond to <last_helper_utterance>")
            prompt_data: Optional dictionary containing substitution data for
                static variables. If provided, static variables will be resolved
                during creation.

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
        Keys are normalized for case-insensitive lookup.
        """
        mapping: Dict[str, str] = {}

        if "context" in prompt_data:
            mapping["your context".casefold()] = str(prompt_data["context"])

        # Handle custom fields (supports both "field" and "name" keys)
        custom_fields = prompt_data.get("customFields", [])
        if isinstance(custom_fields, list):
            for item in custom_fields:
                key = item.get("field") or item.get("name")
                val = item.get("value")

                if key and val:
                    mapping[key.casefold().strip()] = str(val)

        return mapping

    @staticmethod
    def _resolve_static_variables(
        content: str,
        tags: List[str],
        substitution_map: Dict[str, str],
    ) -> Tuple[str, List[str]]:
        """
        Performs case-insensitive string substitution for static variables.
        Returns updated content and unresolved tags.
        """
        unresolved_tags: List[str] = []
        updated_content = content

        for tag in tags:
            normalized_tag = tag.casefold().strip()

            if normalized_tag in substitution_map:
                value = substitution_map[normalized_tag]
                updated_content = updated_content.replace(f"<{tag}>", value)
            else:
                unresolved_tags.append(tag)

        return updated_content, unresolved_tags

    def needs_llm_resolution(self) -> bool:
        """
        Check if llm_response tags need to be resolved.

        Returns:
            True if resolution is needed, False if already resolved
        """
        return not self._llm_resolved

    async def resolve_llm_responses(
        self,
        llm_config: Optional[Dict[str, Any]] = None,
        language_code: str = "en-US",
        llm_client: Optional["BaseLLMClient"] = None,
    ) -> None:
        """
        Lazily substitute llm_response tags in the branching instruction.

        This method is called once when the branching instruction is first used.
        It extracts llm_response tags, calls the LLM for each, and substitutes
        the results into the content.

        Args:
            llm_config: Optional LLM configuration dict
            language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")

        Example:
            >>> instruction = BranchingInstruction.create(
            ...     "Use <llm_response(facts about exercise)>"
            ... )
            >>> await instruction.resolve_llm_responses()
            >>> # instruction.content now has the LLM response substituted
        """
        # Check if already resolved
        if self._llm_resolved:
            return

        # Extract llm_response tags
        llm_tags = extract_llm_response_tags(self.content)

        if not llm_tags:
            # No llm_response tags found, mark as resolved and return
            self._llm_resolved = True
            return

        # Substitute each llm_response tag
        for full_tag, parameter in llm_tags.items():
            try:
                # Generate LLM response for the parameter
                call_kwargs = {
                    "content": parameter,
                    "language_code": language_code,
                    "llm_config": llm_config,
                }
                if llm_client is not None:
                    call_kwargs["llm_client"] = llm_client
                llm_response = await generate_llm_response(**call_kwargs)

                # Replace the tag with the LLM response
                self.content = self.content.replace(f"<{full_tag}>", llm_response)

            except Exception as e:
                # Log error but don't fail - keep the tag as-is
                logger.error(f"Failed to resolve llm_response tag '<{full_tag}>': {e}")

        self._llm_resolved = True

    async def resolve_dynamic_branching_instruction(
        self,
        messages: List[BaseMessage],
        language_code: str = DEFAULT_LANGUAGE_CODE,
        llm_config: Optional[dict] = None,
        llm_client: Optional["BaseLLMClient"] = None,
    ) -> str:
        """
        Returns the content with dynamic placeholders resolved against the chat history.
        """
        # Optimization: Skip if no dynamic tags exist
        if not self.dynamic_tags:
            return self.content

        resolved_content = self.content

        if ReservedBranchingVariable.LAST_HELPER_UTTERANCE in resolved_content:
            resolved_content = resolve_last_helper_utterance(resolved_content, messages)

        if ReservedBranchingVariable.CHAT_SUMMARY in resolved_content:
            call_kwargs = {
                "content": resolved_content,
                "messages": messages,
                "language_code": language_code,
                "llm_config": llm_config,
            }
            if llm_client is not None:
                call_kwargs["llm_client"] = llm_client
            resolved_content = await resolve_chat_summary(**call_kwargs)

        return resolved_content
