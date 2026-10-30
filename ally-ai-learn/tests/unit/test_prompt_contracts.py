from app.prompts.contracts import SystemMainAgentPromptInputs


def test_system_main_agent_prompt_does_not_contain_deprecated_fields():
    """The main agent prompt contract should not offer deprecated fields."""
    schema = SystemMainAgentPromptInputs.model_json_schema()
    properties = schema.get("properties", {})

    assert "competency" not in properties
    assert "behavior_instructions_json" not in properties
