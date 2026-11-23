"""The purpose section (chunk 20a-2): after the owner's instructions, before safety."""

import pytest

from app.core.knowledge_agent.prompt import PURPOSES, format_persona
from app.prompts.contracts import PromptInputs
from app.prompts.resolver import load_and_format

RULES = "# Safety rules\nNever diagnose."
INSTRUCTIONS = "You answer questions about Sunrise Mind Clinic."


@pytest.mark.parametrize("purpose", PURPOSES)
def test_each_purpose_has_a_seed_with_a_contract(purpose):
    text = load_and_format(f"agent/purpose_{purpose}")
    assert text.startswith("# What you're for")
    codes = {
        model.prompt.code
        for model in PromptInputs.__subclasses__()
        if getattr(model, "prompt", None)
    }
    assert f"ally_ai_agent_purpose_{purpose}" in codes


@pytest.mark.parametrize("purpose", PURPOSES)
def test_purpose_sits_after_instructions_and_before_safety(purpose):
    block = format_persona(
        {"system_prompt": INSTRUCTIONS, "safety_rules": RULES, "purpose": purpose}
    )
    section = load_and_format(f"agent/purpose_{purpose}").strip()
    assert block.index(INSTRUCTIONS) < block.index(section) < block.index(RULES)


def test_purpose_sections_say_what_each_purpose_promises():
    enquiries = load_and_format("agent/purpose_enquiries")
    assert "one short question at a time" in enquiries
    assert "discount" in enquiries and "can't book" in enquiries
    assert "Never make up a procedure" in load_and_format("agent/purpose_training")
    guide = load_and_format("agent/purpose_guide")
    assert "Done?" in guide and "Never skip" in guide and "safety step" in guide


def test_the_skills_store_text_wins_over_the_seed():
    live = {"ally_ai_agent_purpose_answer": {"prompt": "# What you're for\nLive."}}
    assert "Live." in format_persona({"purpose": "answer"}, live)


def test_something_else_uses_the_owners_note_fenced_and_before_safety():
    block = format_persona(
        {
            "purpose": "custom",
            "purpose_note": "Help parents choose a class",
            "safety_rules": RULES,
        }
    )
    assert "Help parents choose a class" in block
    assert block.index("Help parents choose a class") < block.index(RULES)
    assert format_persona({"purpose": "custom"}) == ""


def test_no_purpose_renders_exactly_as_before():
    persona = {"display_name": "Asha", "system_prompt": INSTRUCTIONS}
    assert format_persona({**persona, "purpose": None}) == format_persona(persona)
    assert "What you're for" not in format_persona(persona)
    assert format_persona({"purpose": "unknown"}) == ""
