"""
Tests for branching instruction parser.
"""

from app.core.branching_instructions.base import BranchingInstruction
from app.core.branching_instructions.constants import (
    BRANCHING_DYNAMIC_VARIABLES,
    ReservedBranchingVariable,
)
from app.core.branching_instructions.parser import (
    extract_variable_tags,
    is_dynamic_variable,
    parse_instruction,
)


class TestExtractVariableTags:
    """Tests for extract_variable_tags function."""

    def test_extract_single_variable(self):
        instruction = "agree to <last_helper_utterance>"
        result = extract_variable_tags(instruction)
        assert result == ["last_helper_utterance"]

    def test_extract_multiple_variables(self):
        instruction = "Your name is <name> and context is <context>"
        result = extract_variable_tags(instruction)
        assert result == ["name", "context"]

    def test_extract_no_variables(self):
        instruction = "No variables here"
        result = extract_variable_tags(instruction)
        assert result == []

    def test_extract_duplicate_variables(self):
        instruction = "Hello <name>, your name is <name>"
        result = extract_variable_tags(instruction)
        assert result == ["name", "name"]

    def test_extract_with_underscores(self):
        instruction = "Value is <custom_field_name>"
        result = extract_variable_tags(instruction)
        assert result == ["custom_field_name"]

    def test_extract_with_numbers(self):
        instruction = "Field <field123> and <field456>"
        result = extract_variable_tags(instruction)
        assert result == ["field123", "field456"]

    def test_ignore_invalid_tags(self):
        instruction = "Invalid <123invalid> and <-invalid>"
        result = extract_variable_tags(instruction)
        assert result == []

    def test_empty_string(self):
        result = extract_variable_tags("")
        assert result == []

    def test_mixed_valid_invalid(self):
        instruction = "Valid <name> and invalid <123> and valid <context>"
        result = extract_variable_tags(instruction)
        assert result == ["name", "context"]


class TestIsDynamicVariable:
    """Tests for is_dynamic_variable function."""

    def test_dynamic_variables(self):
        """Test variables in BRANCHING_DYNAMIC_VARIABLES list."""
        assert is_dynamic_variable("chat_summary") is True
        assert is_dynamic_variable("last_helper_utterance") is True

    def test_static_variables(self):
        """Test variables not in BRANCHING_DYNAMIC_VARIABLES list."""
        assert is_dynamic_variable("name") is False
        assert is_dynamic_variable("context") is False
        assert is_dynamic_variable("age") is False
        assert is_dynamic_variable("custom_field") is False
        # llm_response is reserved but not in BRANCHING_DYNAMIC_VARIABLES
        assert is_dynamic_variable("llm_response") is False


class TestParseInstruction:
    """Tests for parse_instruction function."""

    def test_parse_only_static_variables(self):
        instruction = "Your name is <name> and age is <age>"
        variable_tags, static_tags, dynamic_tags = parse_instruction(instruction)

        assert variable_tags == ["name", "age"]
        assert static_tags == ["name", "age"]
        assert dynamic_tags == []

    def test_parse_only_dynamic_variables(self):
        instruction = "Respond to <last_helper_utterance> with summary <chat_summary>"
        variable_tags, static_tags, dynamic_tags = parse_instruction(instruction)

        assert variable_tags == ["last_helper_utterance", "chat_summary"]
        assert static_tags == []
        assert dynamic_tags == ["last_helper_utterance", "chat_summary"]

    def test_parse_mixed_variables(self):
        instruction = "Hello <name>, respond to <last_helper_utterance>"
        variable_tags, static_tags, dynamic_tags = parse_instruction(instruction)

        assert variable_tags == ["name", "last_helper_utterance"]
        assert static_tags == ["name"]
        assert dynamic_tags == ["last_helper_utterance"]

    def test_parse_no_variables(self):
        instruction = "No variables here"
        variable_tags, static_tags, dynamic_tags = parse_instruction(instruction)

        assert variable_tags == []
        assert static_tags == []
        assert dynamic_tags == []

    def test_parse_removes_duplicates(self):
        instruction = (
            "Hello <name>, your name is <name>, respond to <last_helper_utterance>"
        )
        variable_tags, static_tags, dynamic_tags = parse_instruction(instruction)

        assert variable_tags == ["name", "last_helper_utterance"]
        assert static_tags == ["name"]
        assert dynamic_tags == ["last_helper_utterance"]

    def test_parse_preserves_order(self):
        instruction = "<context> <name> <last_helper_utterance> <age>"
        variable_tags, static_tags, dynamic_tags = parse_instruction(instruction)

        assert variable_tags == ["context", "name", "last_helper_utterance", "age"]
        assert static_tags == ["context", "name", "age"]
        assert dynamic_tags == ["last_helper_utterance"]

    def test_parse_empty_string(self):
        variable_tags, static_tags, dynamic_tags = parse_instruction("")

        assert variable_tags == []
        assert static_tags == []
        assert dynamic_tags == []

    def test_parse_custom_fields(self):
        instruction = "Custom <custom_field_1> and <custom_field_2>"
        variable_tags, static_tags, dynamic_tags = parse_instruction(instruction)

        assert variable_tags == ["custom_field_1", "custom_field_2"]
        assert static_tags == ["custom_field_1", "custom_field_2"]
        assert dynamic_tags == []


class TestReservedBranchingVariableEnum:
    """Tests for ReservedBranchingVariable enum."""

    def test_enum_values(self):
        assert ReservedBranchingVariable.CHAT_SUMMARY.value == "chat_summary"
        assert (
            ReservedBranchingVariable.LAST_HELPER_UTTERANCE.value
            == "last_helper_utterance"
        )
        assert ReservedBranchingVariable.LLM_RESPONSE.value == "llm_response"

    def test_enum_membership(self):
        assert "chat_summary" in {v.value for v in ReservedBranchingVariable}
        assert "last_helper_utterance" in {v.value for v in ReservedBranchingVariable}
        assert "llm_response" in {v.value for v in ReservedBranchingVariable}
        assert "name" not in {v.value for v in ReservedBranchingVariable}


class TestBranchingDynamicVariablesList:
    """Tests for BRANCHING_DYNAMIC_VARIABLES list."""

    def test_list_contents(self):
        """Test that only truly dynamic variables are in the list."""
        assert "chat_summary" in BRANCHING_DYNAMIC_VARIABLES
        assert "last_helper_utterance" in BRANCHING_DYNAMIC_VARIABLES
        # llm_response is NOT in the list (computed once, not truly dynamic)
        assert "llm_response" not in BRANCHING_DYNAMIC_VARIABLES

    def test_list_length(self):
        """Test that we have exactly 2 truly dynamic variables."""
        assert len(BRANCHING_DYNAMIC_VARIABLES) == 2


class TestBranchingInstructionCreate:
    """Tests for BranchingInstruction.create class method."""

    def test_create_with_static_variables(self):
        instruction = "Your name is <name> and age is <age>"
        result = BranchingInstruction.create(instruction)

        assert result.content == instruction
        assert result.variable_tags == ["name", "age"]
        assert result.static_tags == ["name", "age"]
        assert result.dynamic_tags == []

    def test_create_with_dynamic_variables(self):
        instruction = "Respond to <last_helper_utterance> with summary <chat_summary>"
        result = BranchingInstruction.create(instruction)

        assert result.content == instruction
        assert result.variable_tags == ["last_helper_utterance", "chat_summary"]
        assert result.static_tags == []
        assert result.dynamic_tags == ["last_helper_utterance", "chat_summary"]

    def test_create_with_mixed_variables(self):
        instruction = "Hello <name>, respond to <last_helper_utterance>"
        result = BranchingInstruction.create(instruction)

        assert result.content == instruction
        assert result.variable_tags == ["name", "last_helper_utterance"]
        assert result.static_tags == ["name"]
        assert result.dynamic_tags == ["last_helper_utterance"]

    def test_create_no_variables(self):
        instruction = "No variables here"
        result = BranchingInstruction.create(instruction)

        assert result.content == instruction
        assert result.variable_tags == []
        assert result.static_tags == []
        assert result.dynamic_tags == []

    def test_create_removes_duplicates(self):
        instruction = (
            "Hello <name>, your name is <name>, respond to <last_helper_utterance>"
        )
        result = BranchingInstruction.create(instruction)

        assert result.content == instruction
        assert result.variable_tags == ["name", "last_helper_utterance"]
        assert result.static_tags == ["name"]
        assert result.dynamic_tags == ["last_helper_utterance"]

    def test_create_empty_string(self):
        result = BranchingInstruction.create("")

        assert result.content == ""
        assert result.variable_tags == []
        assert result.static_tags == []
        assert result.dynamic_tags == []


class TestParsedInstruction:
    """Tests for ParsedInstruction dataclass."""

    def test_dataclass_creation(self):
        parsed = BranchingInstruction(
            content="test <name>",
            variable_tags=["name"],
            static_tags=["name"],
            dynamic_tags=[],
        )

        assert parsed.content == "test <name>"
        assert parsed.variable_tags == ["name"]
        assert parsed.static_tags == ["name"]
        assert parsed.dynamic_tags == []

    def test_content_can_be_modified(self):
        parsed = BranchingInstruction(
            content="Hello <name>",
            variable_tags=["name"],
            static_tags=["name"],
            dynamic_tags=[],
        )

        # Simulate substitution
        parsed.content = "Hello John"

        assert parsed.content == "Hello John"  # Content modified
