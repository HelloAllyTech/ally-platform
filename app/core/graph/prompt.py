from textwrap import dedent
from typing import List, Optional

from langchain_core.messages import SystemMessage

from app.core.logger import get_logger
from app.core.scenario.base import (
    PromptData,
    SimulationBehaviorInstruction,
    SimulationStateInstruction,
)
from app.prompts.manager import prompt_manager
from app.prompts.resolver import resolve_template

logger = get_logger(__name__)

# Fallback when no prompt_data or legacy prompt_data.prompt; resolver used at runtime
DEFAULT_PROMPT = prompt_manager.get_template("system", "default_system_prompt")


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


def _get_language_instruction(
    language_code: Optional[str],
    backend_prompts: Optional[dict] = None,
) -> str:
    """
    Get language instruction from prompt template when language is non-English.
    Uses metadata template if available in promptData.prompts, else local YAML.
    Returns empty string for English or missing language_code.
    """
    if not language_code or language_code.startswith("en"):
        return ""
    template = resolve_template(
        "language_instruction_non_english",
        backend_prompts,
    )
    if not template:
        return ""
    try:
        return template.format(language_code=language_code) + "\n\n"
    except KeyError:
        return template + "\n\n"


def _get_cultural_and_style_block(
    prompt_data: PromptData, language_code: Optional[str] = None
) -> str:
    """
    Creates a formatted block for cultural context and speaking style.
    Also adds a specific instruction if the language is not English.
    """
    content = ""

    # Add Language specific instruction from template if not English
    backend_prompts = getattr(prompt_data, "prompts", None)
    content += _get_language_instruction(language_code, backend_prompts)

    if prompt_data.cultural_context:
        content += f"**Cultural Context:**\n{prompt_data.cultural_context}\n\n"

    if prompt_data.speaking_style:
        content += f"**Speaking Style & Tone:**\n{prompt_data.speaking_style}\n\n"

    return content


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


def _build_behavior_conditions_block(
    behavior_instructions: List[SimulationBehaviorInstruction],
    current_state: Optional[SimulationStateInstruction] = None,
) -> str:
    """
    Build the behavior-based conditions block for the prompt.

    Generates conditional instructions based on helper behaviors and actor responses,
    combined with the current state's dialogues.

    Args:
        behavior_instructions: List of behavior instructions with categories,
            behaviors, and actor responses.
        current_state: Optional current state instruction (resolved by score).

    Returns:
        Formatted conditions block string for prompt injection.
    """
    if not behavior_instructions:
        return ""

    # Build the state continuation text from the current state
    state_continuation = ""
    if current_state:
        state_label = f"State {current_state.state_id}"

        # Check if dialogues exist and are not empty
        dialogue_options = []
        if current_state.dialogues:
            dialogue_options = [d for d in current_state.dialogues if d and d.strip()]

        if dialogue_options:
            dialogues_str = " OR ".join([f'"{d}"' for d in dialogue_options])
            state_continuation = (
                f" - ({state_label}) {current_state.instruction} "
                f"and say something similar to: {dialogues_str}"
            )
        elif current_state.instruction:
            state_continuation = f" - ({state_label}) {current_state.instruction}"

    # Build condition blocks from behavior instructions
    condition_blocks = []
    for bi in behavior_instructions:
        # Skip if behaviors list is empty or None
        if not bi.behaviors:
            continue

        # Filter out empty strings and join behaviors with OR
        non_empty_behaviors = [b for b in bi.behaviors if b]
        if not non_empty_behaviors:
            continue

        behaviors_str = " OR ".join([f'"{b}"' for b in non_empty_behaviors])

        # Determine the classification context based on category
        if bi.category.value == "SHOULD_DO":
            classification_prefix = "can be classified as"
        else:
            classification_prefix = "can be classified as"

        # Build the actor response prefix
        actor_response_prefix = ""
        if bi.actors_responses:
            non_empty_responses = [r for r in bi.actors_responses if r]
            if non_empty_responses:
                actor_response_prefix = f'start by saying: "{non_empty_responses[0]}"'

        # Build the condition block
        condition = (
            f"If the previous helper utterance {classification_prefix} "
            f"{behaviors_str}"
        )

        if actor_response_prefix:
            then_clause = f"Then, {actor_response_prefix}"
            if state_continuation:
                then_clause += f" and continue with{state_continuation}"
        else:
            if state_continuation:
                then_clause = f"Then, continue with{state_continuation}"
            else:
                then_clause = "Then, respond naturally based on your character."

        condition_blocks.append(f"{condition}\n{then_clause}")

    return "\n\n".join(condition_blocks)


# --- Prompt Builder Functions ---


def _build_branching_prompt(
    prompt_data: PromptData,
    next_instruction: str,
    language_code: Optional[str] = None,
) -> SystemMessage:
    """
    Build a branching prompt that includes core persona context.

    Includes character identity and style to ensure consistency even when
    following specific directives.
    """
    # Build minimal but essential context blocks
    character_details_parts = []
    if prompt_data.name:
        character_details_parts.append(f"Name: {prompt_data.name}")
    if prompt_data.age:
        character_details_parts.append(f"Age: {prompt_data.age}")
    if prompt_data.gender:
        character_details_parts.append(f"Gender: {prompt_data.gender}")
    character_details = ", ".join(character_details_parts)

    cultural_block = _get_cultural_and_style_block(prompt_data, language_code)

    character_backstory = prompt_data.context or ""

    branching_prompt = dedent(
        f"""
        Role: You are the client {prompt_data.name}. Stay in character.

        ## Character Context
        {character_details}
        {cultural_block}
        Backstory: {character_backstory}

        ## Current Task
        Generate next dialogue as per the conversation history and instruction below.

        Important Instruction: {next_instruction}
    """
    ).strip()

    return SystemMessage(content=branching_prompt)


def _build_behavior_prompt(
    prompt_data: PromptData,
    base_system_prompt: str,
    behavior_instructions: List[SimulationBehaviorInstruction],
    current_state: Optional[SimulationStateInstruction] = None,
    language_code: Optional[str] = None,
) -> SystemMessage:
    """
    Build a behavior-conditioned prompt using helper behavior classifications.

    Generates conditional instructions based on helper behaviors and actor
    responses, combined with the current state's dialogues.

    Args:
        prompt_data: An instance of PromptData containing all client info.
        base_system_prompt: The resolved base system prompt text.
        behavior_instructions: List of behavior instructions for
            condition-based response generation.
        current_state: Optional current state instruction (resolved by score).

    Returns:
        A SystemMessage with the behavior-conditioned prompt.
    """
    conditions_block = _build_behavior_conditions_block(
        behavior_instructions, current_state
    )

    # Build character details summary
    character_details_parts = []
    if prompt_data.name:
        character_details_parts.append(f"Name: {prompt_data.name}")
    if prompt_data.age:
        character_details_parts.append(f"Age: {prompt_data.age}")
    if prompt_data.gender:
        character_details_parts.append(f"Gender: {prompt_data.gender}")
    if prompt_data.profession:
        character_details_parts.append(f"Profession: {prompt_data.profession}")
    if prompt_data.current_location:
        character_details_parts.append(f"Location: {prompt_data.current_location}")
    character_details = ", ".join(character_details_parts)

    # Build cultural and style block
    cultural_block = _get_cultural_and_style_block(prompt_data, language_code)

    # Build character backstory from context
    character_backstory = prompt_data.context or ""

    # Build additional context from custom fields
    custom_context_block = ""
    if prompt_data.custom_fields:
        custom_parts = []
        for cf in prompt_data.custom_fields:
            if isinstance(cf, dict) and cf.get("name") and cf.get("value"):
                custom_parts.append(f"{cf['name']}: {cf['value']}")
        if custom_parts:
            custom_context_block = (
                "\nRefer to the following additional context:\n"
                + "\n".join(custom_parts)
            )

    # Only include Conditions section if there are actual conditions
    conditions_section = ""
    if conditions_block.strip():
        conditions_section = f"\n        Conditions:\n        {conditions_block}"

    # Build ALL optional blocks to ensure full context is present
    gender_details_block = _get_gender_details(prompt_data)
    profession_block = _get_optional_block("Your profession", prompt_data.profession)
    guidelines_block = _get_behavioral_guidelines(prompt_data)
    previous_memory_block = _get_optional_block(
        "Summary from your previous session", prompt_data.previous_memory
    )
    core_memories_block = _get_optional_block(
        "Your core memories influencing your beliefs & actions",
        prompt_data.core_memories,
    )
    personality_block = _get_optional_block("Your personality", prompt_data.personality)
    starting_state_block = _get_optional_block(
        "Your current thoughts", prompt_data.starting_state
    )
    emotional_needs_block = _get_optional_block(
        "Your emotional needs from this counselling session",
        prompt_data.emotional_needs,
    )
    tone_block = _get_optional_block("Your talking style/tone", prompt_data.tone)
    life_history = _get_optional_block(
        "your life history is", prompt_data.life_history_summary
    )
    response_length = _get_optional_block(
        "your response length should be", prompt_data.response_length
    )
    agent_dialogues = _get_optional_block(
        "use these dialogues for reference", prompt_data.agent_dialogues
    )

    behavior_prompt = dedent(
        f"""
        Role instruction: {base_system_prompt.strip()}

        ## Your Client Persona Details
        Character details: {character_details}
        {gender_details_block}
        {profession_block}
        {cultural_block}

        Character backstory: {character_backstory}
        {life_history}
        {guidelines_block}
        {previous_memory_block}
        {core_memories_block}
        {personality_block}
        {starting_state_block}
        {emotional_needs_block}
        {tone_block}

        {custom_context_block}
        {response_length}
        {agent_dialogues}

        Conversation history: Use the conversation history provided in the messages.

        Instruction: Use following conditions to generate next dialogue
        Previous helper utterance: Use the last helper message from history.
        {conditions_section}

        Generate the next dialogue.
    """
    ).strip()

    return SystemMessage(content=behavior_prompt)


def _build_full_prompt(
    prompt_data: PromptData,
    base_system_prompt: str,
    language_code: Optional[str] = None,
) -> SystemMessage:
    """
    Build a comprehensive prompt with full character details, personality,
    and behavioral guidelines.

    This is the original full prompt generation that includes all character
    information and optional fields.

    Args:
        prompt_data: An instance of PromptData containing all client info.
        base_system_prompt: The resolved base system prompt text.

    Returns:
        A SystemMessage with the comprehensive prompt.
    """
    # Use helper functions to build optional sections
    gender_details_block = _get_gender_details(prompt_data)
    profession_block = _get_optional_block("Your profession", prompt_data.profession)
    guidelines_block = _get_behavioral_guidelines(prompt_data)
    previous_memory_block = _get_optional_block(
        "Summary from your previous session",
        prompt_data.previous_memory,
    )
    core_memories_block = _get_optional_block(
        "Your core memories influencing your beliefs & actions",
        prompt_data.core_memories,
    )
    personality_block = _get_optional_block("Your personality", prompt_data.personality)
    starting_state_block = _get_optional_block(
        "Your current thoughts", prompt_data.starting_state
    )
    emotional_needs_block = _get_optional_block(
        "Your emotional needs from this counselling session",
        prompt_data.emotional_needs,
    )
    tone_block = _get_optional_block("Your talking style/tone", prompt_data.tone)

    # Build cultural and style block
    cultural_block = _get_cultural_and_style_block(prompt_data, language_code)

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

    # Assemble the full detailed prompt
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

    {cultural_block}

    **Your current context:**
    {prompt_data.context}

    {guidelines_block}

    {previous_memory_block}

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


# --- Main Prompt Generator Function ---


def generate_system_message(
    prompt_data: PromptData,
    next_instruction: Optional[str] = None,
    language_code: Optional[str] = None,
    behavior_instructions: Optional[List[SimulationBehaviorInstruction]] = None,
    current_state: Optional[SimulationStateInstruction] = None,
) -> SystemMessage:
    """
    Generates a SystemMessage prompt for an AI roleplay assistant
    based on the structured PromptData.

    When a branching instruction is provided (next_instruction), this function
    generates a minimal, directive-focused prompt that prioritizes the
    branching instruction over the detailed script. This ensures the agent
    strictly follows the branching instruction without conflicting signals.

    When behavior_instructions are provided (and no branching instruction),
    generates a behavior-conditioned prompt that uses helper behavior
    classifications to determine the actor's response.

    When neither next_instruction nor behavior_instructions are provided,
    generates a comprehensive prompt with full character details, personality,
    and behavioral guidelines.

    Args:
        prompt_data: An instance of PromptData containing all client info.
        next_instruction: Optional conversation-specific directive
            (branching instruction).
                         If provided, triggers minimal prompt mode.
        language_code: Optional language code.
        behavior_instructions: Optional list of behavior instructions for
            condition-based response generation.
        current_state: Optional current state instruction (resolved by score).

    Returns:
        A SystemMessage object with the complete, formatted prompt.
    """
    # Use legacy prompt_data.prompt if set; else resolve from backend or local
    if prompt_data.prompt:
        base_system_prompt = prompt_data.prompt
    else:
        base_system_prompt = (
            resolve_template(
                "ally_ai_learn_default",
                getattr(prompt_data, "prompts", None),
            )
            or DEFAULT_PROMPT
        )

    if next_instruction:
        return _build_branching_prompt(prompt_data, next_instruction, language_code)

    if behavior_instructions is not None:
        # Handle empty behavior_instructions list by providing a default behavior prompt
        if not behavior_instructions:
            logger.warning(
                "Empty behavior_instructions provided, using default behavior prompt"
            )
        return _build_behavior_prompt(
            prompt_data,
            base_system_prompt,
            behavior_instructions,
            current_state,
            language_code,
        )

    # TODO: Deprecated, remove in future versions
    # Full prompt generation when neither next_instruction nor
    # behavior_instructions provided
    return _build_full_prompt(prompt_data, base_system_prompt, language_code)


def generate_prompt_content(
    prompt_data: PromptData,
    next_instruction: Optional[str] = None,
    language_code: Optional[str] = None,
    behavior_instructions: Optional[List[SimulationBehaviorInstruction]] = None,
    current_state: Optional[SimulationStateInstruction] = None,
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
        language_code: Optional language code.
        behavior_instructions: Optional list of behavior instructions.
        current_state: Optional current state instruction (resolved by score).

    Returns:
        The prompt content as a string.
    """
    system_message = generate_system_message(
        prompt_data,
        next_instruction,
        language_code,
        behavior_instructions=behavior_instructions,
        current_state=current_state,
    )
    return system_message.content
