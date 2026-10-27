import json
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from langchain_core.messages import SystemMessage

from app.core.config import settings
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
        language_glossary=_format_language_glossary_block(
            getattr(prompt_data, "language_glossary", None)
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


def _prompt_declares_variable(prompt_data: PromptData, variable: str) -> bool:
    """Does the selected main-agent variant reference `{variable}`?

    Strictly body-driven: the variant's auto-reconciled `availableVariables`
    is the single source of truth. ally-be recomputes that list from the
    prompt text on every save (`reconcileAvailableVariables` against
    `parseVariablesFromPrompt`, which matches any `{identifier}` with no
    allow-list), so a placeholder appearing in the body is enough to declare
    it — no registry to update, no per-simulation flag.

    Returns False when no variant is selected, the prompts dict is missing,
    the entry is malformed, or the list doesn't reference `variable`.
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
        if name == variable:
            return True
    return False


def prompt_declares_client_working_memory(prompt_data: PromptData) -> bool:
    """Is this simulation opted into the client working memory?

    The opt-in IS the placeholder. A scenario joins by selecting a main-agent
    prompt that declares one or more of the `working_memory_*` section
    placeholders — one field on the scenario, no migration, and nothing to undo
    but re-selecting the old prompt (design §6.1).

    Read by the graph as well as the prompt builder: a simulation that has not
    opted in must not pay for a consolidation call whose output nothing would
    render.

    There used to be a second form: a single `{client_working_memory}`
    placeholder that rendered every section as one block. It was removed once
    the split form had fully replaced it — two readers for one state meant a
    curator could not tell from a prompt which one was live, and the tie-break
    between them (block wins, sections render bare) was a trap. Production's
    last block render was 2026-08-26; the split form has served every session
    since.

    Deliberately ANY rather than ALL. A prompt carrying one section is opted
    in: it renders that section, pays for the update that fills it, and gets
    what it asked for. Requiring all seven would turn a curator dropping the
    fragments section into a silent, total opt-OUT — the loudest possible
    failure for the quietest possible edit. The partial case is a real state
    and it is reported by the coverage log in `worker.py`, not prevented here.
    """
    return prompt_declares_working_memory_sections(prompt_data)


def prompt_declares_working_memory_sections(prompt_data: PromptData) -> bool:
    """Is this prompt using the SPLIT form (one placeholder per section)?

    Distinct from `prompt_declares_client_working_memory` because the two forms
    render differently: the split form leaves `{state_x_guidelines}` alone,
    while the block form folds it in and blanks it to avoid a double render.
    """
    from app.core.working_memory.render import SECTION_VARIABLES

    return any(
        _prompt_declares_variable(prompt_data, name) for name in SECTION_VARIABLES
    )


def declared_working_memory_sections(prompt_data: PromptData) -> tuple:
    """Which section placeholders this prompt actually declares, in render order.

    Used by the opt-in log: with the block form "did it engage?" is a yes/no,
    but the split form adds a state that could not exist before — opted in and
    HALF rendered, where a prompt declares the disclosure ledger and omits the
    stance. That session looks entirely healthy from outside. Naming the
    resolved sections is what makes the difference visible.
    """
    from app.core.working_memory.render import SECTION_VARIABLES

    return tuple(
        name
        for name in SECTION_VARIABLES
        if _prompt_declares_variable(prompt_data, name)
    )


def _get_selected_prompt_has_states(prompt_data: PromptData) -> bool:
    """Decide whether to resolve the active simulation state.

    True when the variant declares `{state_x_guidelines}` — the original
    mechanism, unchanged — OR `{client_working_memory}`.

    The second case is not a special case: the working-memory block RENDERS the
    active state's guidelines as its authored half (§3.1), so a prompt that
    declares the block is asking for state resolution just as surely as one
    that declares the placeholder directly. Without this, a variant that drops
    `{state_x_guidelines}` in favour of the block would silently lose its state
    guidance AND its per-state RAG gating — the state machine would resolve
    nothing, which is exactly the failure the [STATE] warning below exists to
    make visible.

    The SPLIT form counts too, and for a reason that is easy to miss: it does
    NOT render state guidance, so it looks like it has no stake in state
    resolution. But resolving a state is also what gates RAG
    (`activeSimState.ragEnabled`), so a split prompt that left this False
    would keep its knowledge sources switched on in states an author had
    switched them off — a silent, per-state retrieval leak with no visible
    symptom. Resolution is the shared dependency; rendering is not.

    The backend's BackfillAvailableVariables1780150000000 migration populates
    `availableVariables` for every existing row from its latest body, so we no
    longer fall back to the legacy `hasStates` boolean. Empty / missing list
    means "no states".
    """
    return _prompt_declares_variable(
        prompt_data, "state_x_guidelines"
    ) or prompt_declares_client_working_memory(prompt_data)


def _format_dialogue_length_instruction(dialogue_length: Optional[str]) -> str:
    if not dialogue_length:
        return ""
    if dialogue_length == "short":
        return "Keep the response short."
    if dialogue_length == "medium":
        return "Keep the response of medium length."
    if dialogue_length == "long":
        return "Make the response long and detailed."
    return ""


def _build_behavior_prompt(
    prompt_data: PromptData,
    next_instruction: Optional[str],
    language_code: Optional[str],
    behavior_instructions: List[SimulationBehaviorInstruction],
    current_state: Optional[SimulationStateInstruction] = None,
    retrieved_context: Optional[str] = None,
    current_score: Optional[int] = None,
    embed_retrieved_context: bool = True,
    client_working_memory: Any = None,
    locked_memory_topics: Optional[List[str]] = None,
) -> Tuple[SystemMessage, Optional[str]]:
    """Returns (system_message, effective_retrieved_context).

    `effective_retrieved_context` is the ragEnabled-gated value computed below
    — exposed so a caller deferring retrieved_context to a trailing message
    (RETRIEVED_CONTEXT_DEFER_TO_SUFFIX) can reuse the SAME gating decision
    instead of re-resolving simulation state itself. When
    `embed_retrieved_context` is False, the template's own {retrieved_context}
    placeholder (if any) renders blank — the caller is responsible for
    delivering the returned value some other way.
    """
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

    # Working memory MIRRORS the authored state; it does not choose it.
    #
    # For a while it did choose it, and that was the mistake: the ladder's
    # gates — earned advance, two-turn dwell, one rung per turn — sat in front
    # of the author's flow, so a scenario could not move through its own bands
    # until working memory agreed. Two controllers for one behaviour, and the
    # stricter one silently won. That is what "the states stopped doing
    # anything" looked like from the outside.
    #
    # The author's states drive progression, exactly as they do for every other
    # main-agent prompt. Working memory's job is the context around it: what has
    # been said, what is being withheld, what is unresolved, how the client
    # sounds, what their own history brings up. The stance is a LABEL for where
    # the author's state machine already is, so that recall ranking and the
    # withheld ledger have a rung to key off — not a second opinion about it.
    if client_working_memory is not None and active_sim_state is not None:
        _authored = str(active_sim_state.get("name") or "").strip()
        if _authored:
            client_working_memory.stance = _authored

    state_x_guidelines = (
        _coerce_block_value(active_sim_state.get("guidelines"))
        if active_sim_state
        else ""
    )

    # Client working memory. Rendered here rather than appended as a suffix
    # because its POSITION is a variable we intend to test: the author moves
    # `{client_working_memory}` in the body and the block moves with it (§2.3).
    # That is the one thing a suffix append cannot offer.
    #
    # This is also where the two provenances meet (§3.1) and the only place they
    # do — derived state from the store, authored guidance from the state the
    # score just resolved. Passing `state_x_guidelines` in rather than storing it
    # keeps a designer's instruction verbatim: the consolidation call rewrites
    # what lives in the store, and an authored instruction must never be
    # paraphrased into an approximation of itself.
    #
    # Two forms, one store. The BLOCK form (`{client_working_memory}`) renders
    # everything including the authored state guidance, which is why it blanks
    # `{state_x_guidelines}` below. The SPLIT form renders one value per
    # section and leaves the authored half alone — a designer opening the
    # prompt can see their own state guidance in it, which the block form took
    # away and is the reason the split form exists.
    from app.core.working_memory.render import SECTION_VARIABLES

    working_memory_sections = {name: "" for name in SECTION_VARIABLES}
    _declared_sections = declared_working_memory_sections(prompt_data)

    if client_working_memory is not None and _declared_sections:
        from app.core.working_memory.render import NO_STATE_GUIDANCE, render_sections

        working_memory_sections = {
            **working_memory_sections,
            **render_sections(
                client_working_memory, locked_topics=locked_memory_topics or ()
            ),
        }
        # The authored half needs the same named absence the derived half gets.
        #
        # `state_x_guidelines` is "" whenever no state resolves — a score
        # outside every configured band, which is ordinary, not an error. The
        # split form routes the authored guidance around the render module
        # entirely, so "" reached the template and left "## What this
        # conversation is meant to be doing" with nothing under it.
        #
        # A bare heading reads to the model as an absence of CONSTRAINT rather
        # than an absence of data — the exact failure every `NO_*` constant in
        # render.py exists to prevent — and it lands on the heading that tells
        # the actor what the conversation is FOR. Seen in prod: a live session
        # logged the [STATE] warning on every turn as its score climbed past
        # the last configured band.
        #
        # Scoped to working-memory prompts deliberately. Prompts like Main
        # Agent Prompt #2 also declare {state_x_guidelines} and have rendered
        # it empty forever; changing that globally would alter every one.
        if not (state_x_guidelines or "").strip():
            state_x_guidelines = NO_STATE_GUIDANCE

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
    # Only a variant that actually declares {state_x_guidelines} can be
    # MISconfigured this way. Generalising the states gate to fire for
    # {client_working_memory} was right for resolution but made this warning
    # cry wolf: a working-memory prompt with no states is a legitimate setup —
    # the block renders a NAMED absence ("no particular direction for this
    # stage") rather than an empty placeholder — and prod runs at INFO, so this
    # fired every turn of every such session and devalued a real signal.
    if (
        prompt_has_states
        and active_sim_state is None
        and _prompt_declares_variable(prompt_data, "state_x_guidelines")
    ):
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
    dialogue_length_instruction = (
        _format_dialogue_length_instruction(active_sim_state.get("dialogueLength"))
        if active_sim_state
        else ""
    )

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
        retrieved_context=(
            _get_retrieved_context_text(effective_retrieved_context)
            if embed_retrieved_context
            else ""
        ),
        custom_fields_text=_format_custom_fields_text(
            getattr(prompt_data, "custom_fields", []) or []
        ),
        competency=_coerce_block_value(getattr(prompt_data, "competency", None)),
        # Additional persona/style fields exposed for prompt variants.
        # Not referenced by the default main_agent_prompt.txt today; SafeFormatter
        # silently ignores unused kwargs. Future variants can reference any of
        # these as {placeholder} in their prompt text. These attributes are
        # populated on PromptData by app/core/scenario/base.py and otherwise
        # feed evaluator / worker subsystems.
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
        # Tier 0 language-glossary style card, compiled by ally-be from the
        # published always-sections for the session language, wrapped in the
        # private-rules framing (never mention/teach/correct). Scenario
        # `language_characteristics` overrides it on conflict. Empty for
        # English sessions / languages without a published glossary.
        language_glossary=_format_language_glossary_block(
            getattr(prompt_data, "language_glossary", None)
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
        dialogue_length_instruction=dialogue_length_instruction,
        # Retired placeholder, still passed as "" on purpose. The single-block
        # form is gone (see `prompt_declares_client_working_memory`), but a
        # prompt row in the dashboard may still carry `{client_working_memory}`
        # in its body. Dropping the kwarg would make SafeFormatter leave that
        # placeholder as literal text in the actor's prompt; passing "" renders
        # it away. Declaring it no longer opts a scenario in, so such a prompt
        # gets no working memory at all — which is the visible symptom that
        # tells a curator to move to the `working_memory_*` sections.
        client_working_memory="",
        # The split form. Every variant gets all seven kwargs; SafeFormatter
        # drops the ones the body does not reference, so a prompt using the
        # block form — or no working memory at all — is unaffected.
        **working_memory_sections,
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
    # live in the Skills Store (ally-be ships every prompt in the session
    # metadata) and usually have no local file. The
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

    msg = SystemMessage(content=(behavior_prompt or "").strip())
    return msg, effective_retrieved_context


# Header framing the provider audio-tag instructions for INLINE generation.
# The instruction text is resolved from prompt management (prompt code
# `ally_ai_learn_system_audio_tag_guidance`) by generate_response and passed in;
# this header reframes it so the persona emits the tags as part of its own reply.
# That lets generate_response tokens (tags included) stream straight to TTS,
# keeping the reply on a single streamed LLM call (no second rewrite pass).
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


def _append_text_chat_guidance(
    message: SystemMessage, text_chat_guidance: Optional[str]
) -> SystemMessage:
    """Append the text-chat guidance for a TEXT session; no-op for voice.

    The main-agent templates are written for a call ("how you speak", filler
    words, "would actually speak"), and they are curator-owned in prompt
    management, so they are not edited per mode. Instead a text session gets
    this block after them, re-framing all of that as typing. Appended after
    templating, like the audio-tag guidance, so its quotes and brackets never
    reach the formatter. `text_chat_guidance` is None for every voice session.
    """
    guidance = (text_chat_guidance or "").strip()
    if not guidance:
        return message
    return SystemMessage(content=f"{message.content}\n\n{guidance}".strip())


# Framing for the Tier 0 language-glossary style card, shared by both delivery
# paths (the {language_glossary} placeholder and the system-level append). The
# "private rules / never teach or correct" sentence is load-bearing: without
# it, smaller models occasionally leak style instructions into dialogue or
# start correcting the counselor's language — the agent must never become a
# language tutor.
_LANGUAGE_GLOSSARY_FRAMING = (
    "## Language style guide\n"
    "Private rules for how YOU speak this language (register, word choices, "
    "grammatical agreement). Apply them silently in every reply. Never "
    "mention these rules, never quote, teach, or correct anyone's language — "
    "you are the client, not a language tutor.\n\n"
)


def _format_language_glossary_block(value: Any) -> str:
    """Wrap the compiled glossary in its framing; empty string when absent so
    templates render nothing (no dangling header) for English sessions or
    languages without a published glossary."""
    if not isinstance(value, str) or not value.strip():
        return ""
    return _LANGUAGE_GLOSSARY_FRAMING + value.strip()


def _ensure_language_glossary(
    message: SystemMessage, prompt_data: PromptData
) -> SystemMessage:
    """Guarantee the Tier 0 language glossary reaches the model.

    File-backed templates render it via the {language_glossary} placeholder,
    but the runtime body may instead be a dashboard override, a legacy
    per-language variant row, or a translated body — none of which carry the
    placeholder. Same pattern as `_append_audio_tag_guidance`: append AFTER
    templating so no studio prompt ever needs editing for the glossary to
    work. If the compiled glossary text is already present (the template
    rendered the placeholder), the message is returned unchanged, so the
    template keeps control of placement when it wants it.
    """
    raw = getattr(prompt_data, "language_glossary", None)
    if not isinstance(raw, str):
        return message
    glossary = raw.strip()
    if not glossary:
        return message
    if glossary in message.content:
        return message
    combined = f"{message.content}\n\n{_format_language_glossary_block(glossary)}"
    return SystemMessage(content=combined.strip())


# Header for retrieved knowledge context (RAG + Tier-1 glossary), appended in
# the volatile SUFFIX of the system message when the template did not render
# it. It refreshes every KNOWLEDGE_RETRIEVAL_REFRESH_TURNS turns — rendering
# it mid-template invalidated the provider prompt cache for everything after
# it on almost every turn. Placement policy: the DEFAULT main_agent_prompt no
# longer renders {retrieved_context} (gets the cache-friendly suffix);
# main_agent_prompt_full DELIBERATELY keeps it inline next to
# {state_x_guidelines} (retrieval is state-coupled — states can blank it via
# ragEnabled:false — so it belongs with the state guidance), and the
# branching prompt keeps it inline too (branching turns swap templates and
# bust the cache regardless, so there is nothing to win). Dashboard variants
# keep control of placement the same way — the append skips itself when the
# text is already present (same contract as _ensure_language_glossary).
# Header wording kept identical to the old template block.
_RETRIEVED_CONTEXT_HEADER = "## Additional Context\n"


def _append_retrieved_context(
    message: SystemMessage, retrieved_context: Optional[str]
) -> SystemMessage:
    """Append retrieved knowledge as a volatile-suffix block (cache-friendly).

    Ordered AFTER the rolling summary: retrieved context churns roughly every
    2 turns while the summary churns every ~4, and prefix caching means
    everything after the first changed byte is re-processed — so the
    faster-churning block goes last.
    """
    text = _coerce_block_value(retrieved_context)
    if not text:
        return message
    if text in message.content:
        return message
    combined = f"{message.content}\n\n{_RETRIEVED_CONTEXT_HEADER}{text}"
    return SystemMessage(content=combined.strip())


def _build_retrieved_context_message(
    retrieved_context: Optional[str],
) -> Optional[SystemMessage]:
    """Build retrieved context as its OWN trailing message, not a system-message
    suffix (see RETRIEVED_CONTEXT_DEFER_TO_SUFFIX in app/core/config.py).

    Appended AFTER conversation history by the caller, so the (byte-stable)
    system message + history prefix stays cacheable across a retrieved_context
    refresh instead of the whole prefix invalidating every refresh. Same header
    as `_append_retrieved_context` — only the position changes, not the text
    shown to the model.
    """
    text = _coerce_block_value(retrieved_context)
    if not text:
        return None
    return SystemMessage(content=f"{_RETRIEVED_CONTEXT_HEADER}{text}".strip())


# Framing for the rolling conversation summary (episodic memory). Appended in
# the volatile suffix of the system message — after the static persona /
# glossary / audio-tag content — so the static prefix stays byte-stable for
# provider prompt caching (ordering within the suffix: summary before
# retrieved context, ascending churn frequency). The "private memory / stay
# consistent" sentence keeps the persona from re-introducing facts it already
# disclosed once older turns are dropped from the verbatim history.
_ROLLING_SUMMARY_FRAMING = (
    "## Conversation so far (your memory)\n"
    "Private summary of the earlier part of THIS conversation. Older turns are "
    "not repeated verbatim below — treat everything here as things that already "
    "happened and stay consistent with them: never re-introduce yourself, never "
    "repeat a disclosure as if new, and remember what the counsellor already "
    "said or promised.\n\n"
)


def _append_rolling_summary(
    message: SystemMessage, rolling_summary: Optional[str]
) -> SystemMessage:
    """Append the rolling summary as the final system-prompt block.

    Same append-after-templating pattern as `_ensure_language_glossary`, so no
    studio prompt ever needs editing. Applied in the volatile suffix (after
    the static audio tags, before the faster-churning retrieved context) so
    the static prefix stays cache-stable.
    """
    summary = (rolling_summary or "").strip()
    if not summary:
        return message
    max_chars = getattr(settings, "ROLLING_SUMMARY_MAX_CHARS", 0) or 0
    if max_chars > 0 and len(summary) > max_chars:
        summary = summary[:max_chars]
    combined = f"{message.content}\n\n{_ROLLING_SUMMARY_FRAMING}{summary}"
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
    rolling_summary: Optional[str] = None,
    defer_retrieved_context: bool = False,
    client_working_memory: Any = None,
    locked_memory_topics: Optional[List[str]] = None,
    text_chat_guidance: Optional[str] = None,
) -> Tuple[SystemMessage, Optional[SystemMessage]]:
    """
    Generates a SystemMessage prompt for an AI roleplay assistant
    based on the structured PromptData.

    Returns (system_message, retrieved_context_message). The second element
    is normally None; it carries retrieved_context as its own trailing
    message ONLY when `defer_retrieved_context` is True on a non-branching
    turn (RETRIEVED_CONTEXT_DEFER_TO_SUFFIX) — the caller must append it to
    `messages_to_send` AFTER conversation history so provider prompt caching
    can extend across history instead of capping at this system message's
    volatile content. Branching turns ignore the flag entirely (swap
    templates and bust the cache regardless — nothing to win there), always
    returning None for the second element.

    `current_score` is required only when the selected main-agent prompt
    has `hasStates: true`; the score selects the active simulation state.
    Branching mode ignores it.

    `audio_tag_instructions`, when provided (ElevenLabs v3 only), is appended
    so the persona emits voice audio tags inline as it generates — see
    `_append_audio_tag_guidance`.

    `text_chat_guidance`, when provided (text-chat sessions only), is appended
    after the audio-tag block — see `_append_text_chat_guidance`.

    `rolling_summary`, when provided (ROLLING_SUMMARY_ENABLED), is appended as
    the final block — see `_append_rolling_summary` for why it must stay last.

    `client_working_memory`, when provided, is a ClientWorkingMemory snapshot
    substituted into the variant's `{client_working_memory}` placeholder. Only
    the behaviour path takes it: a branching turn swaps in a different template
    entirely to deliver a guardrail, and that instruction outranks the persona's
    inner state for exactly that turn — handing the actor its full working
    memory alongside a guardrail invites it to negotiate with the guardrail.
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
        msg = _ensure_language_glossary(msg, prompt_data)
        msg = _append_audio_tag_guidance(msg, audio_tag_instructions)
        msg = _append_text_chat_guidance(msg, text_chat_guidance)
        msg = _append_rolling_summary(msg, rolling_summary)
        return _append_retrieved_context(msg, retrieved_context), None

    if behavior_instructions is not None:
        if not behavior_instructions:
            logger.warning(
                "Empty behavior_instructions provided, using default behavior prompt"
            )
        msg, effective_retrieved_context = _build_behavior_prompt(
            prompt_data,
            next_instruction,
            language_code,
            behavior_instructions,
            current_state=current_state,
            retrieved_context=retrieved_context,
            current_score=current_score,
            embed_retrieved_context=not defer_retrieved_context,
            client_working_memory=client_working_memory,
            locked_memory_topics=locked_memory_topics,
        )
        logger.info(
            "%s BUILT behavior prompt: language_code=%s",
            LOG_PREFIX,
            language_code or "None",
        )
        msg = _ensure_language_glossary(msg, prompt_data)
        msg = _append_audio_tag_guidance(msg, audio_tag_instructions)
        msg = _append_text_chat_guidance(msg, text_chat_guidance)
        msg = _append_rolling_summary(msg, rolling_summary)
        if defer_retrieved_context:
            return msg, _build_retrieved_context_message(effective_retrieved_context)
        return _append_retrieved_context(msg, effective_retrieved_context), None

    logger.warning(
        "No behavior_instructions provided, "
        "defaulting to behavior prompt with empty conditions"
    )
    msg, effective_retrieved_context = _build_behavior_prompt(
        prompt_data,
        next_instruction,
        language_code,
        [],
        current_state,
        retrieved_context,
        current_score=current_score,
        embed_retrieved_context=not defer_retrieved_context,
        client_working_memory=client_working_memory,
        locked_memory_topics=locked_memory_topics,
    )
    logger.info(
        "%s BUILT behavior prompt: language_code=%s",
        LOG_PREFIX,
        language_code or "None",
    )
    msg = _ensure_language_glossary(msg, prompt_data)
    msg = _append_audio_tag_guidance(msg, audio_tag_instructions)
    msg = _append_text_chat_guidance(msg, text_chat_guidance)
    msg = _append_rolling_summary(msg, rolling_summary)
    if defer_retrieved_context:
        return msg, _build_retrieved_context_message(effective_retrieved_context)
    return _append_retrieved_context(msg, effective_retrieved_context), None
