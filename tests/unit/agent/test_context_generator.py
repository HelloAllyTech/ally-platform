from unittest.mock import AsyncMock

import pytest
from langchain_core.messages import AIMessage

from app.core.agent.context_generator import generate_cultural_context
from app.core.scenario.base import PromptData


@pytest.mark.asyncio
async def test_generate_cultural_context_generates_and_translates():
    """
    Test that the function generates context only.
    """
    # Setup
    prompt_data = PromptData(
        name="Ahana",
        age="16",
        gender="female",
        current_location="Kolkata",
        context="Academic crisis",
        opening_statements=["Hello", "Hi"],
        profession="Student",
    )
    language_code = "hi-IN"
    llm_client = AsyncMock()

    # Mock LLM response (JSON format)
    llm_response_content = (
        '{"cultural_context": "Urban Indian middle class context.", '
        '"speaking_style": "Hinglish, casual and stressed."}'
    )
    llm_client.achat.return_value = AIMessage(content=llm_response_content)

    # Execute
    cultural, style = await generate_cultural_context(
        prompt_data, language_code, llm_client
    )

    # Verify
    assert cultural == "Urban Indian middle class context."
    assert style == "Hinglish, casual and stressed."


@pytest.mark.asyncio
async def test_generate_cultural_context_preserves_existing_context_but_translates():
    """
    Test that if cultural context exists, it is NOT overwritten.
    """
    # Setup
    prompt_data = PromptData(
        name="Ahana",
        age="16",
        gender="female",
        current_location="Kolkata",
        context="Context",
        opening_statements=["Hello"],
        profession="Student",
        cultural_context="PRE_EXISTING_CULTURE",
        speaking_style="PRE_EXISTING_STYLE",
    )
    language_code = "hi-IN"
    llm_client = AsyncMock()

    # Mock LLM response - it might generate new context, but we should ignore it
    llm_response_content = (
        '{"cultural_context": "NEW GENERATED CONTEXT", '
        '"speaking_style": "NEW GEN STYLE"}'
    )
    llm_client.achat.return_value = AIMessage(content=llm_response_content)

    # Execute
    cultural, style = await generate_cultural_context(
        prompt_data, language_code, llm_client
    )

    # Verify
    assert cultural == "PRE_EXISTING_CULTURE"  # Should NOT change
    assert style == "PRE_EXISTING_STYLE"  # Should NOT change
    # Translation assertions removed


@pytest.mark.asyncio
async def test_generate_cultural_context_fallback_on_failure():
    """Test that it returns original values if LLM fails."""
    prompt_data = PromptData(
        name="Ahana",
        age="16",
        gender="female",
        current_location="Kolkata",
        context="Context",
        opening_statements=["Hello"],
        profession="Student",
    )
    language_code = "hi-IN"
    llm_client = AsyncMock()
    llm_client.achat.side_effect = Exception("LLM Error")

    # Execute
    cultural, style = await generate_cultural_context(
        prompt_data, language_code, llm_client
    )

    # Verify
    assert cultural == ""
    assert style == ""
