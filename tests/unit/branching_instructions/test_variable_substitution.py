"""
Tests for variable substitution in BranchingInstruction.
"""

from app.core.branching_instructions.base import BranchingInstruction


class TestVariableSubstitution:
    """Tests for static variable substitution logic."""

    def test_build_substitution_map(self):
        """Test extraction of variables from prompt_data."""
        prompt_data = {
            "context": "Customer support scenario",
            "customFields": [
                {"field": "user_name", "value": "Alice"},
                {"field": "account_type", "value": "Premium"},
                {"field": "  spaced_key  ", "value": "trimmed_value"},
                {"field": "empty_val", "value": ""},  # Should be ignored
                {"field": "", "value": "no_key"},  # Should be ignored
            ],
        }

        expected_map = {
            "your context": "Customer support scenario",
            "user_name": "Alice",
            "account_type": "Premium",
            "spaced_key": "trimmed_value",
        }

        result = BranchingInstruction._build_substitution_map(prompt_data)
        assert result == expected_map

    def test_build_substitution_map_empty(self):
        """Test with empty prompt_data."""
        prompt_data = {}
        result = BranchingInstruction._build_substitution_map(prompt_data)
        assert result == {}

    def test_resolve_static_variables(self):
        """Test string substitution logic."""
        content = "Hello <user_name>, welcome to <your context>. Status: <status>."
        tags = ["user_name", "your context", "status"]
        substitution_map = {
            "user_name": "Bob",
            "your context": "Support",
            "other": "unused",
        }

        expected_content = "Hello Bob, welcome to Support. Status: <status>."
        expected_unresolved = ["status"]

        updated_content, unresolved = BranchingInstruction._resolve_static_variables(
            content, tags, substitution_map
        )

        assert updated_content == expected_content
        assert unresolved == expected_unresolved

    def test_create_with_substitution_success(self):
        """Test full flow: create with prompt_data substitutes variables."""
        instruction = (
            "Hello <user_name>, context: <your context>."
            " Dynamic: <last_helper_utterance>"
        )
        prompt_data = {
            "context": "Sales Call",
            "customFields": [{"field": "user_name", "value": "Charlie"}],
        }

        bi = BranchingInstruction.create(instruction, prompt_data)

        # Check content has been substituted
        assert (
            bi.content
            == "Hello Charlie, context: Sales Call. Dynamic: <last_helper_utterance>"
        )

        # Check tags lists
        assert "user_name" in bi.variable_tags
        assert "your context" in bi.variable_tags
        assert "last_helper_utterance" in bi.variable_tags

        # Static tags should now only contain unresolved ones (none in this case)
        # Wait, the implementation returns unresolved tags as static_tags.
        # Let's check the code:
        # final_content, unresolved_tags = cls._resolve_static_variables(...)
        # static_tags=unresolved_tags
        assert bi.static_tags == []

        assert bi.dynamic_tags == ["last_helper_utterance"]

    def test_create_with_partial_substitution(self):
        """Test full flow: create with partial prompt_data."""
        instruction = "Hello <user_name>, age <age>."
        prompt_data = {"customFields": [{"field": "user_name", "value": "Dave"}]}

        bi = BranchingInstruction.create(instruction, prompt_data)

        assert bi.content == "Hello Dave, age <age>."
        assert bi.static_tags == ["age"]  # 'age' remains unresolved

    def test_create_without_prompt_data(self):
        """Test full flow: create without prompt_data (should behave as before)."""
        instruction = "Hello <user_name>"

        bi = BranchingInstruction.create(instruction)

        assert bi.content == "Hello <user_name>"
        assert bi.static_tags == ["user_name"]
