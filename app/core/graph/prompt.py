from enum import Enum
from typing import Any, List, Optional

from langchain_core.messages import SystemMessage

from app.core.logger import get_logger
from app.core.scenario.base import (
    PromptData,
    SimulationBehaviorInstruction,
    SimulationStateInstruction,
)
from app.prompts.resolver import load_and_format

logger = get_logger(__name__)

# Searchable log prefix for prompt injection (grep: SIMULATION_PROMPT)
LOG_PREFIX = "[SIMULATION_PROMPT]"

# Prompt authoring guidance for this module:
# - Keep mandatory prompt structure inline in the top-level .txt template.
# - Use separate block templates only for optional or shared fragments.
# - Do not move prompt wording into Python unless it is true composition logic.
# - Python should prepare values/sections; prompt files should own the language.
# - If a placeholder is hard to understand from the prompt file alone, prefer
#   inlining it or extracting it into a clearly named prompt-backed block.


def _coerce_block_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, Enum):
        return str(value.value).strip()
    if isinstance(value, (list, tuple, set)):
        parts = [str(v).strip() for v in value if v is not None and str(v).strip()]
        return "\n".join(parts).strip()
    return str(value).strip()


def _optional_field_line(prompt_text: str, value: Any) -> str:
    normalized = _coerce_block_value(value)
    if not normalized:
        return ""
    # Instead of technical labels, create a prose-like narrative flow
    # Handle both sentence-starts and continuation-labels
    content = f"{prompt_text.strip()} {normalized}"
    if not content.endswith((".", "!", "?")):
        content += "."
    return content + " "


def _optional_prompt_block(
    internal_path: str,
    value: Any,
    prompt_data: Optional[PromptData] = None,
) -> str:
    normalized = _coerce_block_value(value)
    if not normalized:
        return ""

    block = load_and_format(
        internal_path,
        prompt_data=prompt_data,
        value=normalized,
    )
    content = (block or "").strip()
    if not content:
        return ""
    if not content.endswith((".", "!", "?")):
        content += "."
    return content + " "


def _optional_section(title: str, body: str) -> str:
    normalized = (body or "").strip()
    if not normalized:
        return ""
    return f"## {title}\n{normalized}\n\n"


def _format_language_samples(samples: List) -> str:
    """
    Format sample dialogues for injection into multilingual_instructions template.
    Supports both formats:
    - List[str]: ["utterance 1", "utterance 2", ...]
    - List[Dict]: [{"counselor": "...", "actor": "..."}, ...] (legacy)
    """
    lines = []
    for i, sample in enumerate(samples, 1):
        if isinstance(sample, str) and sample.strip():
            lines.append(f"Example {i}: {sample.strip()}")
            lines.append("")
        elif isinstance(sample, dict):
            counselor = sample.get("counselor", "").strip()
            actor = sample.get("actor", "").strip()
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
    samples_text = _format_language_samples(samples) if samples else ""

    result = load_and_format(
        "system/multilingual_instructions",
        prompt_data=backend_prompts,
        language_code=language_code,
        samples=samples_text,
    )
    if not result or not result.strip():
        logger.error(
            "%s multilingual_instructions template resolved empty for language_code=%s",
            LOG_PREFIX,
            language_code,
        )
        return ""

    return result.strip() + "\n\n"


def _get_language_block(
    prompt_data: PromptData, language_code: Optional[str] = None
) -> str:
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


def _get_retrieved_context_text(retrieved_context: Optional[str]) -> str:
    return _coerce_block_value(retrieved_context)


def _format_custom_fields_text(custom_fields: list) -> str:
    if not custom_fields:
        return ""

    formatted_blocks = []
    for field in custom_fields:
        if isinstance(field, dict) and "name" in field and "value" in field:
            if field.get("useInDefaultPrompt", True) is not False:
                field_name = _coerce_block_value(field["name"])
                field_value = _coerce_block_value(field["value"])
                if field_name and field_value:
                    formatted_blocks.append(f"{field_name}: {field_value}.")

    return " ".join(formatted_blocks)


def _resolve_state_continuation(
    bi: SimulationBehaviorInstruction,
    current_state: Optional[SimulationStateInstruction],
) -> str:
    if current_state is None:
        return ""

    state_label = f"State {current_state.state_id}"

    if bi.state_matched_instructions:
        matched = next(
            (
                smi
                for smi in bi.state_matched_instructions
                if smi.state_id == current_state.state_id
            ),
            None,
        )
        if matched:
            return f" - ({state_label}) {matched.instruction}"

    if current_state.instruction:
        return f" - ({state_label}) {current_state.instruction}"

    return ""


def _get_then_clause(
    bi: SimulationBehaviorInstruction,
    current_state: Optional[SimulationStateInstruction],
) -> str:
    state_continuation = _resolve_state_continuation(bi, current_state)

    if state_continuation:
        return f"continue with{state_continuation}"

    return "respond naturally based on your character."


def _build_behavior_conditions_text(
    behavior_instructions: List[SimulationBehaviorInstruction],
    current_state: Optional[SimulationStateInstruction] = None,
    prompt_data: Optional[PromptData] = None,
) -> str:
    if not behavior_instructions:
        return ""

    condition_blocks = []
    for bi in behavior_instructions:
        if not bi.behaviors:
            continue

        non_empty_behaviors = [b for b in bi.behaviors if b]
        if not non_empty_behaviors:
            continue

        behaviors_str = " OR ".join([f'"{b}"' for b in non_empty_behaviors])
        then_body = _get_then_clause(bi, current_state)
        condition_blocks.append(
            (
                "If the previous helper utterance can be classified as "
                f"{behaviors_str}\nThen, {then_body}"
            ).strip()
        )

    return "\n\n".join(condition_blocks)


def _build_conditions_section(
    behavior_instructions: List[SimulationBehaviorInstruction],
    current_state: Optional[SimulationStateInstruction] = None,
    prompt_data: Optional[PromptData] = None,
) -> str:
    conditions_text = _build_behavior_conditions_text(
        behavior_instructions, current_state, prompt_data
    )
    return conditions_text.strip()


def _build_branching_prompt(
    prompt_data: PromptData,
    next_instruction: str,
    language_code: Optional[str] = None,
    retrieved_context: Optional[str] = None,
) -> SystemMessage:
    branching_prompt = load_and_format(
        "system/branching_agent_prompt",
        prompt_data=prompt_data,
        name=getattr(prompt_data, "name", "") or "",
        age=getattr(prompt_data, "age", "") or "",
        gender=getattr(prompt_data, "gender", "") or "",
        current_location=getattr(prompt_data, "current_location", "") or "",
        character_context_line=_optional_field_line(
            "The context for this character is", getattr(prompt_data, "context", None)
        ),
        language_block=_get_language_block(prompt_data, language_code),
        retrieved_context_section=_optional_section(
            "Additional Context", _get_retrieved_context_text(retrieved_context)
        ),
        competency=_coerce_block_value(getattr(prompt_data, "competency", None)),
        next_instruction=next_instruction,
    )

    return SystemMessage(content=(branching_prompt or "").strip())


def _build_behavior_prompt(
    prompt_data: PromptData,
    behavior_instructions: List[SimulationBehaviorInstruction],
    current_state: Optional[SimulationStateInstruction] = None,
    language_code: Optional[str] = None,
    retrieved_context: Optional[str] = None,
) -> SystemMessage:
    behavior_prompt = load_and_format(
        "system/main_agent_prompt",
        prompt_data=prompt_data,
        name=getattr(prompt_data, "name", "") or "",
        age=getattr(prompt_data, "age", "") or "",
        gender=getattr(prompt_data, "gender", "") or "",
        current_location=getattr(prompt_data, "current_location", "") or "",
        gender_identity=_coerce_block_value(
            getattr(prompt_data, "gender_identity", None)
        ),
        sexual_orientation=_coerce_block_value(
            getattr(prompt_data, "sexual_orientation", None)
        ),
        profession_block=_optional_prompt_block(
            "system/behavior_prompt_profession_block",
            getattr(prompt_data, "profession", None),
            prompt_data,
        ),
        previous_memory_block=_optional_prompt_block(
            "system/behavior_prompt_previous_memory_block",
            getattr(prompt_data, "previous_memory", None),
            prompt_data,
        ),
        character_profile_text=_coerce_block_value(
            getattr(prompt_data, "character_profile_text", None)
        ),
        language_block=_get_language_block(prompt_data, language_code),
        retrieved_context=_get_retrieved_context_text(retrieved_context),
        custom_fields_text=_format_custom_fields_text(
            getattr(prompt_data, "custom_fields", []) or []
        ),
        competency=_coerce_block_value(getattr(prompt_data, "competency", None)),
        behavior_condition_entries=_build_conditions_section(
            behavior_instructions, current_state, prompt_data
        ),
    )

    return SystemMessage(content=(behavior_prompt or "").strip())


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
    """
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
        if not behavior_instructions:
            logger.warning(
                "Empty behavior_instructions provided, using default behavior prompt"
            )
        msg = _build_behavior_prompt(
            prompt_data,
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

    logger.warning(
        "No behavior_instructions provided, "
        "defaulting to behavior prompt with empty conditions"
    )
    msg = _build_behavior_prompt(
        prompt_data,
        [],
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


def generate_prompt_content(
    prompt_data: PromptData,
    next_instruction: Optional[str] = None,
    language_code: Optional[str] = None,
    behavior_instructions: Optional[List[SimulationBehaviorInstruction]] = None,
    current_state: Optional[SimulationStateInstruction] = None,
    retrieved_context: Optional[str] = None,
) -> str:
    system_message = generate_system_message(
        prompt_data,
        next_instruction,
        language_code,
        behavior_instructions=behavior_instructions,
        current_state=current_state,
        retrieved_context=retrieved_context,
    )
    return system_message.content
