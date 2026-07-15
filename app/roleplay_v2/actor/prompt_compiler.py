"""Layered prompt compilation for the v2 Actor.

The Actor prompt is split into two system messages around the conversation:

    [static prefix]  L1 identity core + L2 scenario context   (byte-stable)
    ...history...
    [turn card]      L3 state card + L4 ledger + L5 chunks + L6 direction

The static prefix is compiled ONCE per session and must be byte-stable across
turns — identical input bytes let provider-side prompt caching hit on every
turn. Everything per-turn lives in the turn card.

The disclosure ledger rendering is the safety-critical part: a LOCKED secret
renders its topic and lockedDeflection ONLY — its content string must never
enter the Actor's context, so the model cannot leak what it was never told.

Templates live in app/prompts/actor/*.txt and are resolved through
load_and_format so dashboard overrides work; the data blocks are assembled in
Python and passed as kwargs (format_map inserts values verbatim, so braces in
spec-authored text can never break formatting).
"""

from __future__ import annotations

from typing import List, Optional

from app.core.constants import get_language_name_from_code

# Reused v1 helpers (per contract): language-sample + filler formatting, and
# the audio-tag framing header used when the TTS provider supports inline tags.
from app.core.graph.prompt import (
    _AUDIO_TAG_GUIDANCE_HEADER,
    _format_allowed_fillers_for_prompt,
    _format_language_samples,
)
from app.core.logger import get_logger
from app.prompts.resolver import load_and_format
from app.roleplay_v2.spec.models import PersonaChunk, ScenarioSpec, SpecState
from app.roleplay_v2.spec.runtime_state import (
    LEDGER_LOCKED,
    LEDGER_REVEALED,
    RuntimeSessionState,
)

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Static prefix (L1 + L2)
# ---------------------------------------------------------------------------


def compile_static_prefix(
    spec: ScenarioSpec,
    *,
    audio_tag_instructions: Optional[str] = None,
    prompt_data=None,
) -> str:
    """Compile the byte-stable session prefix (L1 identity + L2 context).

    Pure function of its arguments: calling it twice with the same spec MUST
    return identical bytes (asserted in tests) so prompt caching stays warm.

    ``audio_tag_instructions`` — when the scenario's TTS provider supports
    inline audio tags (ElevenLabs v3), the guidance is appended STATICALLY
    here (unlike v1, which appends per-turn) so the prefix stays cacheable.
    ``prompt_data`` — optional backend prompts dict for dashboard overrides.
    """
    language_code = spec.language_code
    language_label = get_language_name_from_code(language_code)

    prefix = load_and_format(
        "actor/static_prefix",
        prompt_data=prompt_data,
        title=spec.title,
        identity_core=spec.persona.identity_core.strip(),
        scenario_context=spec.persona.scenario_context.strip(),
        competency=spec.competency_label or "general counseling skills",
        language_code=language_code,
        language_label=language_label,
        linguistic_samples=_format_language_samples([]),
        allowed_fillers=_format_allowed_fillers_for_prompt(None),
    ).strip()

    instructions = (audio_tag_instructions or "").strip()
    if instructions:
        prefix = f"{prefix}{_AUDIO_TAG_GUIDANCE_HEADER}{instructions}".strip()
    return prefix


# ---------------------------------------------------------------------------
# Turn card (L3 + L4 + L5 + L6)
# ---------------------------------------------------------------------------


def _render_state_section(state: SpecState) -> str:
    lines = [
        f"Emotional register: {state.emotional_register}",
        f"Disclosure posture: {state.disclosure_posture}",
        f"Resistance level: {state.resistance_level}",
    ]
    if state.prosody_hints:
        lines.append(f"Prosody: {state.prosody_hints}")
    if state.state_card:
        lines.append("")
        lines.append(state.state_card.strip())
    return "\n".join(line for line in lines if line is not None)


def _render_ledger_section(spec: ScenarioSpec, snapshot: RuntimeSessionState) -> str:
    """Render L4. LOCKED items: topic + deflection ONLY — content NEVER."""
    if not spec.disclosure_ledger.secrets:
        return "(nothing is being withheld in this scenario)"
    lines: List[str] = []
    for secret in spec.disclosure_ledger.secrets:
        status = snapshot.ledger.get(secret.id, LEDGER_LOCKED)
        if status == LEDGER_LOCKED:
            deflection = secret.locked_deflection.strip() or (
                "Deflect naturally and change the subject."
            )
            lines.append(
                f"- [LOCKED] {secret.topic}: you have NOT shared this and "
                f"must not reveal it. If probed: {deflection}"
            )
        elif status == LEDGER_REVEALED:
            lines.append(
                f"- [ALREADY SHARED] {secret.topic}: you have told the "
                f"counselor this — stay consistent with it: {secret.content}"
            )
        else:  # unlocked
            lines.append(
                f"- [UNLOCKED] {secret.topic}: you may now share this when "
                f"the moment feels right: {secret.content}"
            )
    return "\n".join(lines)


def _render_chunks_section(chunks: List[PersonaChunk]) -> str:
    if not chunks:
        return "(no additional memories retrieved this turn)"
    return "\n\n".join(chunk.content.strip() for chunk in chunks)


def compile_turn_card(
    spec: ScenarioSpec,
    snapshot: RuntimeSessionState,
    chunks: List[PersonaChunk],
    *,
    prompt_data=None,
) -> str:
    """Compile the per-turn directors' note (L3 current state ONLY + L4
    ledger + L5 retrieved chunks + L6 stage direction).

    The stage direction falls back to the current state's
    ``defaultStageDirection`` when the Director hasn't issued one.
    """
    state = spec.get_state(snapshot.current_state_id)
    if state is None:  # defensive: commit validation should make this unreachable
        logger.error(
            "[roleplay_v2] Unknown current_state_id %r; falling back to initial",
            snapshot.current_state_id,
        )
        state = spec.state_machine.initial_state

    stage_direction = (
        snapshot.stage_direction or state.default_stage_direction or ""
    ).strip() or "Respond naturally, staying true to your current state."

    return load_and_format(
        "actor/turn_card",
        prompt_data=prompt_data,
        state_name=state.name,
        state_section=_render_state_section(state),
        ledger_section=_render_ledger_section(spec, snapshot),
        chunks_section=_render_chunks_section(chunks),
        stage_direction=stage_direction,
    ).strip()
