from textwrap import dedent
from typing import Optional

from langchain_core.messages import SystemMessage

from app.core.scenario.base import PromptData

# --- Constants ---

DEFAULT_PROMPT = """
You are an AI roleplay assistant for counselor training.
In this simulation, you must act ONLY as the **client** in a therapy session.
Stay fully in character, provide realistic dialogue, and do not switch roles
unless explicitly instructed.

**Important Instructions:**
- Prefer first-person phrasing (e.g., "I feel…", "I've been struggling with…").
- Allow the counselor to guide the conversation.
- If the counselor is silent or open-ended, share one thought, feeling,
  or small story, then stop.
- Maintain consistency with your life history but allow natural
  variation in tone and detail.
- Respond naturally, as a real client would (use first-person voice).
- Reveal information gradually, not all at once.
- Start with few details and open up more as counsellor asks questions.
- Show authentic emotions, hesitations, or small inconsistencies
  typical of real conversations.
- Do not give therapy advice, diagnoses, or act as the counselor.
- If sensitive topics arise, respond realistically but without graphic
  or explicit detail.
- Keep each reply under ~120 words to simulate session pacing.
"""


def _get_optional_block(label: str, value: Optional[str]) -> str:
    """Wraps an optional value in a simple formatted block if it exists."""
    if value:
        return f"**{label}:**\n{value}\n\n"
    return ""


def _get_gender_details(prompt_data: PromptData) -> str:
    """Creates formatted blocks for optional gender identity and orientation."""
    content = ""
    if prompt_data.gender_identity:
        content += f"**Your gender identity:**\n{prompt_data.gender_identity}\n\n"
    if prompt_data.sexual_orientation:
        content += f"**Your sexual orientation:**\n{prompt_data.sexual_orientation}\n\n"
    return content


def _get_behavioral_guidelines(prompt_data: PromptData) -> str:
    """Returns specific session guidelines if provided."""
    if prompt_data.session_behavior_guidelines:
        return (
            f"**How will you behave in this session:**\n"
            f"{prompt_data.session_behavior_guidelines}\n\n"
        )
    return ""


def _format_custom_fields(custom_fields: list) -> str:
    """
    Formats custom fields into markdown sections for prompt injection.

    Args:
        custom_fields: List of dicts with 'name' and 'value' keys

    Returns:
        Formatted markdown string with custom field sections,
        or empty string if no fields
    """
    if not custom_fields:
        return ""

    formatted_blocks = []
    for field in custom_fields:
        if isinstance(field, dict) and "name" in field and "value" in field:
            field_name = field["name"]
            field_value = field["value"]
            if field_value:
                formatted_blocks.append(f"**{field_name}:**\n{field_value}\n\n")

    return "".join(formatted_blocks)


# --- Main Prompt Generator Function ---


def generate_system_message(
    prompt_data: PromptData, next_instruction: Optional[str] = None
) -> SystemMessage:
    """
    Generates a SystemMessage prompt for an AI roleplay assistant
    based on the structured PromptData.

    When a branching instruction is provided (next_instruction), this function
    generates a minimal, directive-focused prompt that prioritizes the
    branching instruction over the detailed script. This ensures the agent
    strictly follows the branching instruction without conflicting signals.

    When no branching instruction is provided, it generates a comprehensive
    prompt with full character details, personality, and behavioral guidelines.

    Args:
        prompt_data: An instance of PromptData containing all client info.
        next_instruction: Optional conversation-specific directive
            (branching instruction).
                         If provided, triggers minimal prompt mode.

    Returns:
        A SystemMessage object with the complete, formatted prompt.
    """

    # 1. Determine the base instruction (Custom vs Default)
    # This prevents code duplication and keeps the fallback logic in one place.
    base_system_prompt = prompt_data.prompt if prompt_data.prompt else DEFAULT_PROMPT

    # If we have a branching instruction, use simplified minimal prompt
    if next_instruction:
        # 2. Construct the final prompt using dedent to handle indentation cleanly
        minimal_prompt = dedent(
            f"""
            <SYSTEM>
            {base_system_prompt.strip()}
            </SYSTEM>

            <CRITICAL_INSTRUCTION>
            {next_instruction}

            This instruction takes ABSOLUTE PRIORITY over all other guidelines.
            You MUST follow this instruction exactly in your next response.
            </CRITICAL_INSTRUCTION>

            Respond as {prompt_data.name} while strictly following the critical
            instruction above.
        """
        ).strip()

        return SystemMessage(content=minimal_prompt)

    # Otherwise, use the full detailed prompt (original behavior)

    # Use helper functions to build optional sections
    gender_details_block = _get_gender_details(prompt_data)
    profession_block = _get_optional_block("Your profession", prompt_data.profession)
    guidelines_block = _get_behavioral_guidelines(prompt_data)
    core_memories_block = _get_optional_block(
        "Your core memories influencing your beliefs & actions",
        prompt_data.core_memories,
    )
    personality_block = _get_optional_block("Your personality", prompt_data.personality)
    starting_state_block = _get_optional_block(
        "Your current thoughts", prompt_data.starting_state
    )  # Mapped from starting_state
    emotional_needs_block = _get_optional_block(
        "Your emotional needs from this counselling session",
        prompt_data.emotional_needs,
    )
    tone_block = _get_optional_block("Your talking style/tone", prompt_data.tone)

    # Format custom fields dynamically
    custom_fields_block = _format_custom_fields(prompt_data.custom_fields or [])

    life_history = _get_optional_block(
        "your life history is", prompt_data.life_history_summary
    )
    response_length = _get_optional_block(
        "your response length should be", prompt_data.response_length
    )
    agent_dialogues = _get_optional_block(
        "use these dialogues for reference", prompt_data.agent_dialogues
    )

    # Assemble the full detailed prompt (when no branching instruction is present)
    system_prompt = dedent(
        f"""
    {base_system_prompt.strip()}

    ## Your Client Persona Details
    This is the background information for your character.

    **Your name:**
    {prompt_data.name}

    **Your age:**
    {prompt_data.age}

    **Your gender:**
    {prompt_data.gender}

    {gender_details_block}

    **Your current location:**
    {prompt_data.current_location}

    {profession_block}

    **Your current context:**
    {prompt_data.context}

    {guidelines_block}

    {life_history}

    {core_memories_block}
    {personality_block}
    {starting_state_block}
    {emotional_needs_block}
    {tone_block}
    {custom_fields_block}

    {response_length}
    {agent_dialogues}

    """
    )

    return SystemMessage(content=system_prompt.strip())


def generate_prompt_content(
    prompt_data: PromptData, next_instruction: Optional[str] = None
) -> str:
    """
    Generate prompt content string from PromptData.

    This is a convenience function that extracts the content string from
    generate_system_message(). Used when you need the prompt as a string
    rather than a SystemMessage object.

    Args:
        prompt_data: An instance of PromptData containing all client info.
        next_instruction: Optional conversation-specific directive
            (branching instruction).

    Returns:
        The prompt content as a string.
    """
    system_message = generate_system_message(prompt_data, next_instruction)
    return system_message.content
