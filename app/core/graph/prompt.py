from enum import Enum
from typing import Any, List, Optional

from langchain_core.messages import SystemMessage

from app.core.logger import get_logger
from app.core.scenario.base import (
    PromptData,
    SimulationBehaviorInstruction,
    SimulationStateInstruction,
)
from app.prompts.manager import prompt_manager
from app.prompts.resolver import load_and_format, load_template

logger = get_logger(__name__)

# Searchable log prefix for prompt injection (grep: SIMULATION_PROMPT)
LOG_PREFIX = "[SIMULATION_PROMPT]"

# Fallback when no prompt_data or legacy prompt_data.prompt; resolver used at runtime
DEFAULT_PROMPT = prompt_manager.get_template("system", "base_role_instruction")


def _coerce_block_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, Enum):
        return str(value.value).strip()
    if isinstance(value, (list, tuple, set)):
        parts = [str(v).strip() for v in value if v is not None and str(v).strip()]
        return "\n".join(parts).strip()
    return str(value).strip()


def _build_dynamic_blocks(prompt_data: PromptData) -> dict:
    """
    Builds all automated blocks by looking at Prompt metadata.

    Iterates through all prompt templates in the 'system' category.
    If a prompt has 'data_field' in its metadata, it is considered a block
    that should be resolved if the corresponding data exists in PromptData.
    """
    blocks = {}
    system_prompts = prompt_manager._prompts.get("system", {})

    for prompt_key in system_prompts.keys():
        meta = prompt_manager.get_meta("system", prompt_key)
        field_name = meta.get("data_field")

        if not field_name:
            continue

        raw_value = getattr(prompt_data, field_name, None)
        value = _coerce_block_value(raw_value)
        if not value:
            blocks[prompt_key] = ""
            continue

        # e.g. load 'system/personality_block' with personality=value, value=value
        result = load_and_format(
            f"system/{prompt_key}",
            prompt_data=prompt_data,
            value=value,
            **{field_name: value},
        )
        blocks[prompt_key] = (
            (result + "\n\n")
            if result and not result.endswith("\n\n")
            else result or ""
        )

    return blocks


def _get_gender_details(prompt_data: PromptData) -> str:
    """Creates formatted blocks for optional gender identity and orientation."""
    content = ""
    if prompt_data.gender_identity:
        block = load_and_format(
            "system/gender_identity",
            prompt_data=prompt_data,
            value=prompt_data.gender_identity,
        )
        content += (
            (block + "\n\n") if block and not block.endswith("\n\n") else block or ""
        )
    if prompt_data.sexual_orientation:
        block = load_and_format(
            "system/sexual_orientation",
            prompt_data=prompt_data,
            value=prompt_data.sexual_orientation,
        )
        content += (
            (block + "\n\n") if block and not block.endswith("\n\n") else block or ""
        )
    return content


def _get_behavioral_guidelines(prompt_data: PromptData) -> str:
    """Returns specific session guidelines if provided."""
    if not prompt_data.session_behavior_guidelines:
        return ""
    result = load_and_format(
        "system/session_behavior_guidelines",
        prompt_data=prompt_data,
        value=prompt_data.session_behavior_guidelines,
    )
    return (result + "\n\n") if result and not result.endswith("\n\n") else result or ""


def _get_competency_block(
    competency: Optional[str], prompt_data: Optional[PromptData] = None
) -> str:
    """
    Returns a formatted counselor competency instruction block.

    When a competency is specified, the simulation is shaped so that the
    client's responses create natural opportunities for the counselor to
    practice and demonstrate that competency.
    """
    if not competency:
        return ""
    result = load_and_format(
        "system/competency_block",
        prompt_data=prompt_data,
        competency=competency,
    )
    if not result or not result.strip():
        return (
            "## Counselor Training Competency\n"
            "The counselor attending this simulation is being trained on the following"
            " competency:\n"
            f"**{competency}**\n\n"
            "Shape your responses to create natural opportunities for the counselor to"
            " practice and demonstrate this competency. Do not make it obvious or"
            " forced — let it emerge organically through the conversation.\n\n"
        )
    return (result + "\n\n") if result and not result.endswith("\n\n") else result


def _format_language_samples(samples: List) -> str:
    """
    Format sample dialogues for injection into multilingual_instructions template.
    Supports both formats:
    - List[str]: ["utterance 1", "utterance 2", ...]
    - List[Dict]: [{"counselor": "...", "actor": "..."}, ...] (legacy)
    """
    lines = []
    for i, s in enumerate(samples, 1):
        if isinstance(s, str) and s.strip():
            lines.append(f"Example {i}: {s.strip()}")
            lines.append("")
        elif isinstance(s, dict):
            counselor = s.get("counselor", "").strip()
            actor = s.get("actor", "").strip()
            if counselor or actor:
                lines.append(f"Example {i}:")
                if counselor:
                    lines.append(f"  Counselor: {counselor}")
                if actor:
                    lines.append(f"  Client: {actor}")
                lines.append("")
    return "\n".join(lines).strip()


def _get_language_sample_block(
    samples: Optional[List],
    language_code: str,
    backend_prompts: Optional[dict] = None,
) -> str:
    """
    Build language instruction block for non-English scenarios.

    Always uses the multilingual prompt from dashboard (if enabled) or local
    template, with language_code and samples (or empty string when none), so
    dashboard edits apply whether or not the scenario has samples. Falls back
    to a base instruction only when the template is missing or returns empty.

    Args:
        samples: Optional list of language dialogue samples
        language_code: BCP 47 language code
        backend_prompts: promptData.prompts from metadata (dashboard edits)
    """
    samples_text = _format_language_samples(samples) if samples else ""

    result = load_and_format(
        "system/multilingual_instructions",
        prompt_data=backend_prompts,
        language_code=language_code,
        samples=samples_text,
    )
    if not result or not result.strip():
        fallback = load_and_format(
            "system/language_instruction_fallback",
            prompt_data=backend_prompts,
            language_code=language_code,
        )
        if fallback and fallback.strip():
            return fallback.strip() + "\n\n"
        return (
            f"**LANGUAGE INSTRUCTION:**\n"
            f"Generate next dialogue in the language for code '{language_code}'.\n\n"
        )

    return result.strip() + "\n\n"


def _get_language_block(
    prompt_data: PromptData, language_code: Optional[str] = None
) -> str:
    """
    Creates a formatted block for language instruction.

    For non-English scenarios, always injects a language block. When
    language_dialogue_samples are present and non-empty, includes the
    samples section; otherwise uses the base instruction only.

    For English or missing language_code, returns empty string.
    """
    if not language_code or language_code.startswith("en"):
        return ""

    samples = prompt_data.language_dialogue_samples
    backend_prompts = getattr(prompt_data, "prompts", None)

    block = _get_language_sample_block(samples, language_code, backend_prompts)
    if not block or not block.strip():
        return ""

    sample_count = len(samples) if samples else 0
    logger.info(
        "%s INJECTED language_block (language_code=%s, samples=%d)",
        LOG_PREFIX,
        language_code,
        sample_count,
    )
    return block


def _format_custom_fields(
    custom_fields: list, prompt_data: Optional[PromptData] = None
) -> str:
    """
    Formats custom fields into markdown sections for prompt injection.

    Args:
        custom_fields: List of dicts with 'name' and 'value' keys
        prompt_data: Optional PromptData for template resolution (dashboard override)

    Returns:
        Formatted markdown string with custom field sections,
        or empty string if no fields
    """
    if not custom_fields:
        return ""

    formatted_blocks = []
    for field in custom_fields:
        if isinstance(field, dict) and "name" in field and "value" in field:
            if field.get("useInDefaultPrompt", True) is not False:
                field_name = field["name"]
                field_value = field["value"]
                if field_value:
                    block = load_and_format(
                        "system/custom_field_item",
                        prompt_data=prompt_data,
                        field_name=field_name,
                        field_value=field_value,
                    )
                    formatted_blocks.append(
                        (block + "\n\n")
                        if block and not block.endswith("\n\n")
                        else block or f"**{field_name}:**\n{field_value}\n\n"
                    )

    return "".join(formatted_blocks)


def _build_behavior_conditions_block(
    behavior_instructions: List[SimulationBehaviorInstruction],
    current_state: Optional[SimulationStateInstruction] = None,
    prompt_data: Optional[PromptData] = None,
) -> str:
    """
    Build the behavior-based conditions block for the prompt.

    Generates conditional instructions based on helper behaviors and actor responses,
    combined with the current state's dialogues.

    Args:
        behavior_instructions: List of behavior instructions with categories,
            behaviors, and actor responses.
        current_state: Optional current state instruction (resolved by score).
        prompt_data: Optional PromptData for template resolution (dashboard override).

    Returns:
        Formatted conditions block string for prompt injection.
    """
    if not behavior_instructions:
        return ""

    # Build the state continuation text from the current state
    state_continuation = ""
    if current_state:
        state_label = f"State {current_state.state_id}"

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
        if not bi.behaviors:
            continue

        non_empty_behaviors = [b for b in bi.behaviors if b]
        if not non_empty_behaviors:
            continue

        behaviors_str = " OR ".join([f'"{b}"' for b in non_empty_behaviors])

        condition = load_and_format(
            "system/behavior_condition_if",
            prompt_data=prompt_data,
            behaviors_str=behaviors_str,
        )
        if not condition or not condition.strip():
            condition = (
                f"If the previous helper utterance can be classified as {behaviors_str}"
            )

        if state_continuation:
            then_clause = load_and_format(
                "system/behavior_condition_then_state",
                prompt_data=prompt_data,
                state_continuation=state_continuation,
            )
            if not then_clause or not then_clause.strip():
                then_clause = f"Then, continue with{state_continuation}"
        else:
            then_clause = load_and_format(
                "system/behavior_condition_then_natural",
                prompt_data=prompt_data,
            )
            if not then_clause or not then_clause.strip():
                then_clause = "Then, respond naturally based on your character."

        condition_blocks.append(f"{condition.strip()}\n{then_clause.strip()}")

    return "\n\n".join(condition_blocks)


# --- Prompt Builder Functions ---


def _build_branching_prompt(
    prompt_data: PromptData,
    next_instruction: str,
    language_code: Optional[str] = None,
    retrieved_context: Optional[str] = None,
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

    language_block = _get_language_block(prompt_data, language_code)
    competency_block = _get_competency_block(prompt_data.competency, prompt_data)

    # Only include backstory if context is provided
    backstory_block = ""
    if prompt_data.context:
        block = load_and_format(
            "system/backstory",
            prompt_data=prompt_data,
            context=prompt_data.context,
        )
        backstory_block = (
            (block + "\n\n")
            if block and not block.endswith("\n\n")
            else block or f"Backstory: {prompt_data.context}\n\n"
        )

    retrieved_context_block = ""
    if retrieved_context:
        block = load_and_format(
            "system/retrieved_context_section",
            prompt_data=prompt_data,
            retrieved_context=retrieved_context,
        )
        retrieved_context_block = (
            (block + "\n\n")
            if block and not block.endswith("\n\n")
            else block or f"## Additional Context\n{retrieved_context}\n\n"
        )

    branching_prompt = load_and_format(
        "system/branching_prompt",
        prompt_data=prompt_data,
        name=prompt_data.name or "",
        character_details=character_details,
        language_block=language_block,
        backstory_block=backstory_block,
        retrieved_context_block=retrieved_context_block,
        competency_block=competency_block,
        next_instruction=next_instruction,
    )

    return SystemMessage(content=(branching_prompt or "").strip())


def _build_behavior_prompt(
    prompt_data: PromptData,
    base_system_prompt: str,
    behavior_instructions: List[SimulationBehaviorInstruction],
    current_state: Optional[SimulationStateInstruction] = None,
    language_code: Optional[str] = None,
    retrieved_context: Optional[str] = None,
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
        behavior_instructions, current_state, prompt_data
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

    # Build language block (samples or instruction for non-English)
    language_block = _get_language_block(prompt_data, language_code)

    # Build character backstory from context (only if provided)
    backstory_block = ""
    if prompt_data.context:
        block = load_and_format(
            "system/character_backstory",
            prompt_data=prompt_data,
            context=prompt_data.context,
        )
        backstory_block = (
            (block + "\n\n")
            if block and not block.endswith("\n\n")
            else block or f"Character backstory: {prompt_data.context}\n\n"
        )

    retrieved_context_block = ""
    if retrieved_context:
        block = load_and_format(
            "system/retrieved_context_section",
            prompt_data=prompt_data,
            retrieved_context=retrieved_context,
        )
        retrieved_context_block = (
            (block + "\n\n")
            if block and not block.endswith("\n\n")
            else block or f"## Additional Context\n{retrieved_context}\n\n"
        )

    # Build additional context from custom fields
    custom_context_block = ""
    if prompt_data.custom_fields:
        custom_parts = []
        for cf in prompt_data.custom_fields:
            if isinstance(cf, dict) and cf.get("name") and cf.get("value"):
                custom_parts.append(f"{cf['name']}: {cf['value']}")
        if custom_parts:
            block = load_and_format(
                "system/custom_context_intro",
                prompt_data=prompt_data,
                custom_parts="\n".join(custom_parts),
            )
            custom_context_block = block or (
                "\nRefer to the following additional context:\n"
                + "\n".join(custom_parts)
            )

    # Only include Conditions section if there are actual conditions
    conditions_section = ""
    if conditions_block.strip():
        block = load_and_format(
            "system/conditions_section_wrapper",
            prompt_data=prompt_data,
            conditions_block=conditions_block,
        )
        conditions_section = (
            block or f"\n        Conditions:\n        {conditions_block}"
        )

    # Build automated blocks from PromptData mapping
    dynamic_blocks = _build_dynamic_blocks(prompt_data)

    # Legacy/Computed blocks not in the auto-mapping
    gender_details_block = _get_gender_details(prompt_data)
    guidelines_block = _get_behavioral_guidelines(prompt_data)
    competency_block = _get_competency_block(prompt_data.competency, prompt_data)

    behavior_prompt = load_and_format(
        "system/behavior_prompt",
        prompt_data=prompt_data,
        base_system_prompt=base_system_prompt.strip(),
        character_details=character_details,
        gender_details_block=gender_details_block,
        language_block=language_block,
        backstory_block=backstory_block,
        retrieved_context_block=retrieved_context_block,
        guidelines_block=guidelines_block,
        custom_context_block=custom_context_block,
        competency_block=competency_block,
        conditions_section=conditions_section,
        **dynamic_blocks,
    )

    return SystemMessage(content=(behavior_prompt or "").strip())


def _build_full_prompt(
    prompt_data: PromptData,
    base_system_prompt: str,
    language_code: Optional[str] = None,
    retrieved_context: Optional[str] = None,
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
    gender_details_block = _get_gender_details(prompt_data)
    guidelines_block = _get_behavioral_guidelines(prompt_data)

    # Build language block (samples or instruction for non-English)
    language_block = _get_language_block(prompt_data, language_code)

    # Format custom fields dynamically
    custom_fields_block = _format_custom_fields(
        prompt_data.custom_fields or [], prompt_data
    )

    competency_block = _get_competency_block(prompt_data.competency, prompt_data)

    retrieved_context_block = ""
    if retrieved_context:
        block = load_and_format(
            "system/retrieved_context_section",
            prompt_data=prompt_data,
            retrieved_context=retrieved_context,
        )
        retrieved_context_block = (
            (block + "\n\n")
            if block and not block.endswith("\n\n")
            else block or f"## Additional Context\n{retrieved_context}\n\n"
        )

    dynamic_blocks = _build_dynamic_blocks(prompt_data)

    context_block = ""
    if prompt_data.context and str(prompt_data.context).strip():
        context_block = (
            f"**Your current context:**\n{str(prompt_data.context).strip()}\n\n"
        )

    system_prompt = load_and_format(
        "system/full_prompt",
        prompt_data=prompt_data,
        base_system_prompt=base_system_prompt.strip(),
        name=prompt_data.name or "",
        age=prompt_data.age or "",
        gender=prompt_data.gender or "",
        gender_details_block=gender_details_block,
        current_location=prompt_data.current_location or "",
        language_block=language_block,
        context_block=context_block,
        retrieved_context_block=retrieved_context_block,
        guidelines_block=guidelines_block,
        custom_fields_block=custom_fields_block,
        competency_block=competency_block,
        **dynamic_blocks,
    )

    return SystemMessage(content=(system_prompt or "").strip())


# --- Main Prompt Generator Function ---


def generate_system_message(
    prompt_data: PromptData,
    next_instruction: Optional[str] = None,
    language_code: Optional[str] = None,
    behavior_instructions: Optional[List[SimulationBehaviorInstruction]] = None,
    current_state: Optional[SimulationStateInstruction] = None,
    retrieved_context: Optional[str] = None,
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
    # Prefer editable prompts (prompt_data.prompts) when present; else use
    # legacy prompt_data.prompt; else resolve from local templates.
    backend_prompts = getattr(prompt_data, "prompts", None)
    default_key = "ally_ai_learn_system_base_role_instruction"
    has_editable = (
        backend_prompts
        and default_key in backend_prompts
        and (backend_prompts.get(default_key) or "").strip()
    )
    logger.info(
        "[PROMPT_SOURCE] generate_system_message: prompt_data.prompt=%s, "
        "prompt_data.prompts has default=%s",
        "SET" if prompt_data.prompt else "None",
        has_editable,
    )
    if has_editable:
        base_system_prompt = (
            load_template(default_key, backend_prompts) or DEFAULT_PROMPT
        )
        logger.info(
            "[PROMPT_SOURCE] Using editable prompt_data.prompts, len=%d",
            len(base_system_prompt),
        )
    elif prompt_data.prompt:
        base_system_prompt = prompt_data.prompt
        logger.info(
            "[PROMPT_SOURCE] Using legacy prompt_data.prompt, len=%d",
            len(prompt_data.prompt),
        )
    else:
        base_system_prompt = (
            load_template(default_key, backend_prompts) or DEFAULT_PROMPT
        )

    if next_instruction:
        msg = _build_branching_prompt(
            prompt_data, next_instruction, language_code, retrieved_context
        )
        logger.info(
            "%s BUILT branching prompt: language_code=%s",
            LOG_PREFIX,
            language_code or "None",
        )
        return msg

    if behavior_instructions is not None:
        # Handle empty behavior_instructions list by providing a default behavior prompt
        if not behavior_instructions:
            logger.warning(
                "Empty behavior_instructions provided, using default behavior prompt"
            )
        msg = _build_behavior_prompt(
            prompt_data,
            base_system_prompt,
            behavior_instructions,
            current_state,
            language_code,
            retrieved_context,
        )
        logger.info(
            "%s BUILT behavior prompt: language_code=%s",
            LOG_PREFIX,
            language_code or "None",
        )
        return msg

    # TODO: Deprecated, remove in future versions
    # Full prompt generation when neither next_instruction nor
    # behavior_instructions provided
    msg = _build_full_prompt(
        prompt_data, base_system_prompt, language_code, retrieved_context
    )
    logger.info(
        "%s BUILT full prompt: language_code=%s",
        LOG_PREFIX,
        language_code or "None",
    )
    return msg


def generate_prompt_content(
    prompt_data: PromptData,
    next_instruction: Optional[str] = None,
    language_code: Optional[str] = None,
    behavior_instructions: Optional[List[SimulationBehaviorInstruction]] = None,
    current_state: Optional[SimulationStateInstruction] = None,
    retrieved_context: Optional[str] = None,
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
        retrieved_context=retrieved_context,
    )
    return system_message.content
