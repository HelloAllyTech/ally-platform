import json
from enum import Enum
from typing import Any, Dict, List, Optional

from langchain_core.messages import SystemMessage

from app.core.logger import get_logger
from app.core.scenario.base import (
    PromptData,
    SimulationBehaviorInstruction,
    SimulationStateInstruction,
)
from app.prompts.resolver import load_and_format, load_and_format_by_code

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


def _format_allowed_fillers_for_prompt(fillers: Optional[List[str]]) -> str:
    """Human-readable list for the {allowed_fillers} placeholder.

    Used inline by the main agent prompt and the branching prompt.
    """
    empty_guidance = (
        "No curated filler list is set for this language in scenario metadata. "
        "Speak naturally and idiomatically; do not invent or assume a prescribed "
        "set of interjections."
    )
    if not fillers:
        return empty_guidance
    parts = [str(f).strip() for f in fillers if f is not None and str(f).strip()]
    if not parts:
        return empty_guidance
    return ", ".join(parts)


def _format_language_samples(samples: List) -> str:
    """
    Format sample dialogues for injection into multilingual_instructions template.
    Supports both formats:
    - List[str]: ["utterance 1", "utterance 2", ...]
    - List[Dict]: [{"counselor": "...", "actor": "..."}, ...] (legacy)
    """
    if not samples:
        return ""
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


def _resolve_effective_language_label(
    language_code: str,
    language_label: Optional[str],
    language_characteristics: Optional[str],
) -> str:
    """Pick the language label that goes into the multilingual block.

    Fallback chain: per-scenario author override (`languageCharacteristics`)
    → DB default label (`languageLabel`, e.g. "Tamil (India)") → bare locale
    code as last resort. Studio surfaces all three as a single concept
    called "Language label", which keeps the author's mental model simple
    while still letting the platform provide a baseline.
    """
    override = (language_characteristics or "").strip()
    if override:
        return override
    label = (language_label or "").strip()
    if label:
        return label
    return language_code


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


def _resolve_state_guidance(
    bi: SimulationBehaviorInstruction,
    current_state: Optional[SimulationStateInstruction],
) -> str:
    if current_state is None:
        return ""

    if bi.state_matched_instructions:
        matched = next(
            (
                smi
                for smi in bi.state_matched_instructions
                if smi.state_id == current_state.state_id
            ),
            None,
        )
        if matched and matched.instruction:
            return matched.instruction.strip()

    if current_state.instruction:
        return current_state.instruction.strip()

    return ""


def _resolve_simulation_state_by_score(
    states: Optional[List[Dict[str, Any]]],
    current_score: Optional[int],
) -> Optional[Dict[str, Any]]:
    """Pick the active simulation state for a given turn score.

    ally-be pre-sorts states by scoreLower (ascending) before sending to
    ai-learn, so this resolver can skip re-sorting on the happy path.

    The starting state is emergent, not flagged: a session's score begins
    at 0 (ScoreKeeper.get_total_score() starts at 0 — never None in
    production), so turn 1 resolves through the same interval match as any
    later turn. The legacy `isStarting` / `default_state_id` flag is gone.

    Selection rules:
      - scoreLower is inclusive; scoreUpper is exclusive.
      - current_score is None only on dev/test paths with no ScoreKeeper
        wired up; it is treated as 0 so it resolves identically to turn 1.
      - Out-of-range scores clamp to first/last state.
    """
    if not states:
        return None

    # No ScoreKeeper (dev/test) → behave as the session's opening turn (score 0)
    # so the "starting state = the state containing 0" rule holds everywhere.
    score = current_score if current_score is not None else 0

    # States are pre-sorted by ally-be; iterate in order for interval match.
    for state in states:
        lower = state.get("scoreLower")
        upper = state.get("scoreUpper")
        if lower is not None and score < lower:
            continue
        if upper is not None and score >= upper:
            continue
        return state

    # Out-of-range clamp. Ally-be pre-sorts states, but we re-sort here as a
    # safety net for legacy sessions or direct test callers that may not.
    sorted_states = sorted(
        states,
        key=lambda s: (
            s.get("scoreLower") if s.get("scoreLower") is not None else float("-inf")
        ),
    )
    first_lower = sorted_states[0].get("scoreLower")
    if first_lower is not None and score < first_lower:
        return sorted_states[0]
    last_upper = sorted_states[-1].get("scoreUpper")
    if last_upper is not None and score >= last_upper:
        return sorted_states[-1]
    return None


def _build_behavior_instructions_json(
    behavior_instructions: List[SimulationBehaviorInstruction],
    current_state: Optional[SimulationStateInstruction] = None,
) -> str:
    if not behavior_instructions:
        return "[]"

    rules = []
    for bi in behavior_instructions:
        if not bi.behaviors:
            continue

        non_empty_behaviors = [b.strip() for b in bi.behaviors if b and b.strip()]
        if not non_empty_behaviors:
            continue

        state_guidance = _resolve_state_guidance(bi, current_state)

        rules.append(
            {
                "trigger_behaviors": non_empty_behaviors,
                "current_state_guidance": state_guidance or None,
            }
        )

    return json.dumps(rules, indent=2, ensure_ascii=False)


def _build_branching_prompt(
    prompt_data: PromptData,
    next_instruction: str,
    language_code: Optional[str] = None,
    retrieved_context: Optional[str] = None,
) -> SystemMessage:
    branching_prompt = load_and_format(
        "system/branching_agent_prompt",
        prompt_data=prompt_data,
        title=_coerce_block_value(getattr(prompt_data, "title", None)),
        challenge_description=_coerce_block_value(
            getattr(prompt_data, "description", None)
        ),
        name=getattr(prompt_data, "name", "") or "",
        age=getattr(prompt_data, "age", "") or "",
        gender=getattr(prompt_data, "gender", "") or "",
        current_location=getattr(prompt_data, "current_location", "") or "",
        character_profile_text=_coerce_block_value(
            getattr(prompt_data, "character_profile_text", None)
            or getattr(prompt_data, "context", None)
        ),
        # Multilingual fields substituted directly into the branching
        # template body (no block wrapper). Mirror of the main-agent
        # path — same kwargs go into both prompts so wording stays
        # consistent across the runtime + branching surfaces.
        language_code=_coerce_block_value(language_code),
        language_label=_coerce_block_value(
            _resolve_effective_language_label(
                language_code=language_code or "",
                language_label=getattr(prompt_data, "language_label", None),
                language_characteristics=getattr(
                    prompt_data, "language_characteristics", None
                ),
            )
            if language_code
            else None
        ),
        linguistic_samples=_format_language_samples(
            getattr(prompt_data, "language_dialogue_samples", None) or []
        ),
        allowed_fillers=_format_allowed_fillers_for_prompt(
            getattr(prompt_data, "allowed_fillers", None)
        ),
        retrieved_context=_get_retrieved_context_text(retrieved_context),
        competency=_coerce_block_value(getattr(prompt_data, "competency", None)),
        next_instruction=next_instruction,
        helpful_behaviours=", ".join(
            getattr(prompt_data, "helpful_behaviours", None) or []
        ),
        unhelpful_behaviours=", ".join(
            getattr(prompt_data, "unhelpful_behaviours", None) or []
        ),
    )

    return SystemMessage(content=(branching_prompt or "").strip())


def _get_selected_prompt_has_states(prompt_data: PromptData) -> bool:
    """Decide whether to compute state guidance for the selected variant.

    Strictly body-driven: the variant's auto-reconciled
    `availableVariables` is the single source of truth. We return True
    iff that list references `{state_x_guidelines}`.

    The backend's BackfillAvailableVariables1780150000000 migration
    populates `availableVariables` for every existing row from its
    latest body, so we no longer fall back to the legacy `hasStates`
    boolean. Empty / missing list now means "no states" — same as a
    row whose reconciled list simply doesn't include the placeholder.

    Returns False when no variant is selected, the prompts dict is
    missing, the entry is malformed, or the list doesn't reference
    `state_x_guidelines`.
    """
    selected_code = getattr(prompt_data, "selected_main_prompt_code", None)
    if not selected_code:
        return False
    prompts = getattr(prompt_data, "prompts", None)
    if not isinstance(prompts, dict):
        return False
    entry = prompts.get(selected_code)
    if not isinstance(entry, dict):
        return False

    # availableVariables can be a list of strings OR a list of
    # {name, label, required} dicts (the studio's chip metadata schema);
    # normalize before the membership check.
    available_vars = entry.get("availableVariables") or []
    if not isinstance(available_vars, list):
        return False
    for var in available_vars:
        name = (
            var
            if isinstance(var, str)
            else (var.get("name") if isinstance(var, dict) else None)
        )
        if name == "state_x_guidelines":
            return True
    return False


def _build_behavior_prompt(
    prompt_data: PromptData,
    behavior_instructions: List[SimulationBehaviorInstruction],
    current_state: Optional[SimulationStateInstruction] = None,
    language_code: Optional[str] = None,
    retrieved_context: Optional[str] = None,
    current_score: Optional[int] = None,
) -> SystemMessage:
    # Resolve the active simulation state (separate from behavior-rules
    # state guidance) when the selected main-agent prompt opts in via
    # `hasStates: true`. The matched state's guidelines go into
    # `{state_x_guidelines}`; if its `ragEnabled` is False, we blank
    # `{retrieved_context}` for this turn even if retrieval ran upstream.
    prompt_has_states = _get_selected_prompt_has_states(prompt_data)
    sim_states = getattr(prompt_data, "states", None)
    active_sim_state: Optional[Dict[str, Any]] = (
        _resolve_simulation_state_by_score(
            sim_states,
            current_score,
        )
        if prompt_has_states
        else None
    )
    state_x_guidelines = (
        _coerce_block_value(active_sim_state.get("guidelines"))
        if active_sim_state
        else ""
    )
    # Observability: surface variant + state + RAG decisions every turn so
    # we can verify behaviour from session logs alone. These fire on every
    # conversation turn — emitted at DEBUG to keep production INFO logs
    # clean. Bump log level via env var when investigating a session.
    # Grep tags:
    #   [VARIANT]      → which main-agent prompt code was selected
    #   [STATE]        → score → resolved state (name, range, ragEnabled)
    #   [RAG_GATE]     → whether prompt-builder is blanking retrieved_context
    selected_code = (
        getattr(prompt_data, "selected_main_prompt_code", None) or "<default>"
    )
    logger.debug(
        "%s [VARIANT] selected_main_prompt_code=%s hasStates=%s",
        LOG_PREFIX,
        selected_code,
        prompt_has_states,
    )
    if prompt_has_states:
        state_name = active_sim_state.get("name") if active_sim_state else None
        state_lower = active_sim_state.get("scoreLower") if active_sim_state else None
        state_upper = active_sim_state.get("scoreUpper") if active_sim_state else None
        state_rag = active_sim_state.get("ragEnabled") if active_sim_state else None
        logger.debug(
            "%s [STATE] current_score=%s resolved=%s range=[%s,%s) ragEnabled=%s",
            LOG_PREFIX,
            current_score,
            state_name,
            state_lower,
            state_upper,
            state_rag,
        )

    # If a variant opted into hasStates but no active state was resolved
    # (states array empty, or current_score outside every range), the
    # rendered {state_x_guidelines} will be empty silently. Warn so this
    # misconfiguration is visible rather than only manifesting as "the LLM
    # ignores state guidance".
    if prompt_has_states and active_sim_state is None:
        logger.warning(
            "%s [STATE] hasStates=true but no active state resolved for "
            "current_score=%s; {state_x_guidelines} will render empty. "
            "Check Scenarios.metadata.states.",
            LOG_PREFIX,
            current_score,
        )
    effective_retrieved_context = retrieved_context
    if active_sim_state is not None and active_sim_state.get("ragEnabled") is False:
        had_context = bool(retrieved_context)
        effective_retrieved_context = ""
        # DEBUG: per-turn diagnostic when RAG is gated off by state config.
        logger.debug(
            "%s [RAG_GATE] gated_off_by_state name=%s id=%s had_upstream_context=%s",
            LOG_PREFIX,
            active_sim_state.get("name"),
            active_sim_state.get("id"),
            had_context,
        )

    # Build kwargs once so we can route through either the default
    # main_agent_prompt or a per-simulation variant selected via
    # PromptData.selected_main_prompt_code without duplicating the call site.
    template_kwargs = dict(
        title=_coerce_block_value(getattr(prompt_data, "title", None)),
        challenge_description=_coerce_block_value(
            getattr(prompt_data, "description", None)
        ),
        role_instructions=_coerce_block_value(
            getattr(prompt_data, "role_instructions", None)
        ),
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
        character_profile_text=_coerce_block_value(
            getattr(prompt_data, "character_profile_text", None)
        ),
        retrieved_context=_get_retrieved_context_text(effective_retrieved_context),
        custom_fields_text=_format_custom_fields_text(
            getattr(prompt_data, "custom_fields", []) or []
        ),
        competency=_coerce_block_value(getattr(prompt_data, "competency", None)),
        # Additional persona/style fields exposed for prompt variants.
        # Not referenced by the default main_agent_prompt.txt today; SafeFormatter
        # silently ignores unused kwargs. Future variants can reference any of
        # these as {placeholder} in their prompt text. These attributes are
        # populated on PromptData by app/core/scenario/base.py and otherwise
        # feed prosody / evaluator / worker subsystems.
        opening_statements=_coerce_block_value(
            getattr(prompt_data, "opening_statements", None)
        ),
        # Persona + language variables used directly by the prompt
        # template body. `previous_memory` is preformatted on the BE
        # side (full "You remember from your last session: …" sentence
        # when present, empty string otherwise), so the template just
        # substitutes it verbatim — no conditional wrapper needed.
        profession=_coerce_block_value(getattr(prompt_data, "profession", None)),
        previous_memory=_coerce_block_value(
            getattr(prompt_data, "previous_memory", None)
        ),
        # Multilingual variables substituted directly into the prompt
        # body. `language_code` is the runtime BCP-47 locale (e.g.
        # 'ta-IN'); empty / 'en' when bare English. The template
        # always renders these (no conditional skip for English) —
        # English sessions get the same multilingual rules.
        language_code=_coerce_block_value(language_code),
        language_label=_coerce_block_value(
            _resolve_effective_language_label(
                language_code=language_code or "",
                language_label=getattr(prompt_data, "language_label", None),
                language_characteristics=getattr(
                    prompt_data, "language_characteristics", None
                ),
            )
            if language_code
            else None
        ),
        language_characteristics=_coerce_block_value(
            getattr(prompt_data, "language_characteristics", None)
        ),
        # Style/voice fields rendered inline by the main agent prompt's
        # multilingual section. Variants can reference them directly via
        # `{linguistic_samples}` / `{allowed_fillers}` (e.g. the lean #2 variant
        # uses both in its `## About you` section).
        linguistic_samples=_format_language_samples(
            getattr(prompt_data, "language_dialogue_samples", None) or []
        ),
        allowed_fillers=_format_allowed_fillers_for_prompt(
            getattr(prompt_data, "allowed_fillers", None)
        ),
        # Active simulation state's guidelines for `hasStates` prompts.
        # Empty when no state is active (no states configured / no match /
        # prompt did not opt in). Variants without {state_x_guidelines} in
        # their text simply ignore this kwarg via SafeFormatter.
        state_x_guidelines=state_x_guidelines,
        behavior_instructions_json=_build_behavior_instructions_json(
            behavior_instructions, current_state
        ),
        helpful_behaviours=", ".join(
            getattr(prompt_data, "helpful_behaviours", None) or []
        ),
        unhelpful_behaviours=", ".join(
            getattr(prompt_data, "unhelpful_behaviours", None) or []
        ),
    )

    # Route through the variant resolver when the simulation has picked a
    # specific main-agent prompt; otherwise use the default. Variants
    # typically live in backend metadata (useDashboardOverride=true) since
    # they are authored in prompt management, not as local files. The
    # fallback path keeps stale/missing codes from breaking the run.
    selected_code = getattr(prompt_data, "selected_main_prompt_code", None)
    if selected_code:
        behavior_prompt = load_and_format_by_code(
            selected_code,
            prompt_data,
            fallback_internal_path="system/main_agent_prompt",
            **template_kwargs,
        )
        logger.info(
            "%s BUILT main agent prompt: selected_code=%s",
            LOG_PREFIX,
            selected_code,
        )
    else:
        behavior_prompt = load_and_format(
            "system/main_agent_prompt",
            prompt_data=prompt_data,
            **template_kwargs,
        )

    return SystemMessage(content=(behavior_prompt or "").strip())


# Header framing the provider audio-tag instructions for INLINE generation.
# The instruction text is resolved from prompt management (prompt code
# `ally_ai_learn_system_audio_tag_guidance`) by generate_response and passed in;
# this header reframes it so the persona emits the tags as part of its own reply.
# That lets generate_response tokens (tags included) stream straight to TTS,
# removing the second prosody LLM call from the critical path.
_AUDIO_TAG_GUIDANCE_HEADER = (
    "\n\n## Voice expression — audio tags\n"
    "Embed the audio tags below INLINE in your spoken replies to convey emotion "
    "and pacing. They are part of how you speak — include them directly in your "
    "dialogue, naturally and sparingly. Never list, describe, or explain the "
    "tags; only use them inline.\n\n"
)


def _append_audio_tag_guidance(
    message: SystemMessage, audio_tag_instructions: Optional[str]
) -> SystemMessage:
    """Append provider audio-tag guidance to the persona prompt for inline use.

    Only takes effect when the scenario's TTS provider exposes tag instructions
    (ElevenLabs v3); for v2 ElevenLabs and every other provider
    `audio_tag_instructions` is None and the message is returned unchanged.
    Appended AFTER templating so the tag examples (square brackets, not braces)
    never reach the prompt formatter.
    """
    instructions = (audio_tag_instructions or "").strip()
    if not instructions:
        return message
    combined = f"{message.content}{_AUDIO_TAG_GUIDANCE_HEADER}{instructions}"
    return SystemMessage(content=combined.strip())


# Header framing performative-text / break-tag guidance for non-v3 providers.
# The instruction text is resolved from prompt management (codes
# `ally_ai_learn_system_text_expressivity_guidance` and
# `ally_ai_learn_system_break_tag_guidance`) by generate_response when the
# scenario opts in, and reframed here so the persona performs it inline.
_TEXT_EXPRESSIVITY_GUIDANCE_HEADER = (
    "\n\n## Voice expression — performative delivery\n"
    "Convey emotion and pacing through the WORDS and PUNCTUATION of your reply "
    "itself — naturally and sparingly. Apply the guidance below inline as part "
    "of how you speak; never describe or explain it, only perform it.\n\n"
)


def _append_text_expressivity_guidance(
    message: SystemMessage, text_expressivity_instructions: Optional[str]
) -> SystemMessage:
    """Append performative-text / break-tag guidance to the persona prompt.

    Used for non-ElevenLabs-v3 providers when the scenario opts in
    (`enable_performative_text` / `enable_break_tags`); `text_expressivity_
    instructions` is None for v3 and when both flags are off, leaving the
    message unchanged. Appended AFTER templating so any literal punctuation or
    `<break>` examples never reach the prompt formatter.
    """
    instructions = (text_expressivity_instructions or "").strip()
    if not instructions:
        return message
    combined = (
        f"{message.content}{_TEXT_EXPRESSIVITY_GUIDANCE_HEADER}{instructions}"
    )
    return SystemMessage(content=combined.strip())


def generate_system_message(
    prompt_data: PromptData,
    next_instruction: Optional[str] = None,
    language_code: Optional[str] = None,
    behavior_instructions: Optional[List[SimulationBehaviorInstruction]] = None,
    current_state: Optional[SimulationStateInstruction] = None,
    retrieved_context: Optional[str] = None,
    current_score: Optional[int] = None,
    audio_tag_instructions: Optional[str] = None,
    text_expressivity_instructions: Optional[str] = None,
) -> SystemMessage:
    """
    Generates a SystemMessage prompt for an AI roleplay assistant
    based on the structured PromptData.

    `current_score` is required only when the selected main-agent prompt
    has `hasStates: true`; the score selects the active simulation state.
    Branching mode ignores it.

    `audio_tag_instructions`, when provided (ElevenLabs v3 only), is appended
    so the persona emits voice audio tags inline as it generates — see
    `_append_audio_tag_guidance`.

    `text_expressivity_instructions`, when provided (non-v3 providers that opted
    into performative-text and/or break-tag guidance), is appended after the
    audio-tag guidance — see `_append_text_expressivity_guidance`. In practice
    exactly one of the two is non-None.
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
        msg = _append_audio_tag_guidance(msg, audio_tag_instructions)
        return _append_text_expressivity_guidance(
            msg, text_expressivity_instructions
        )

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
            current_score=current_score,
        )
        logger.info(
            "%s BUILT behavior prompt: language_code=%s",
            LOG_PREFIX,
            language_code or "None",
        )
        msg = _append_audio_tag_guidance(msg, audio_tag_instructions)
        return _append_text_expressivity_guidance(
            msg, text_expressivity_instructions
        )

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
        current_score=current_score,
    )
    logger.info(
        "%s BUILT behavior prompt: language_code=%s",
        LOG_PREFIX,
        language_code or "None",
    )
    return _append_audio_tag_guidance(msg, audio_tag_instructions)


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
