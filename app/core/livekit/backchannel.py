"""Continuous back-channeling during the learner's turn.

Beyond the post-turn thinking-filler (which plays the instant the learner stops,
while the real reply is forming), a human listener also makes brief affirmations
*while the other person is still talking* on a long utterance — "mm-hmm", a soft
"yeah", "right". These back-channels signal "I'm listening, go on" without taking
the floor. Emitting them makes the persona feel like an engaged listener rather
than a silent recorder.

This module owns the language-correct PHRASES. The worker drives playback
(see ``worker._on_backchannel_user_state`` / ``worker._backchannel_loop``):
driven off the user-speaking state, it waits out a long-utterance gate, then
emits a phrase sparsely (randomized gap + probability gate) on the SAME
``BackgroundAudioPlayer`` track the filler/comfort tone use — its own published
track, so a back-channel can never race or preempt the agent's real reply.

Phrases are LLM-generated once at session start from the superadmin-editable
``filler/backchannel`` template (System Skills), resolved via the normal prompt
pipeline (DB override when a superadmin edits it, local ``.txt`` otherwise). The
prompt forces the right language / native script so this works across languages
(the Indic TTS spells Latin text out letter-by-letter, so "Mm" must arrive as the
language's own back-channel, not transliterated).

Controlled by a single global flag (``settings.BACKCHANNEL_GLOBALLY_ENABLED``,
default on) with an off switch — a baseline naturalness lever, kept sparse so it
never interrupts.

Everything here is best-effort: any failure yields no phrases and the session
continues with no back-channel — it must never break the agent.
"""

from __future__ import annotations

from typing import List

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel

from app.core.config import settings
from app.core.logger import get_logger
from app.prompts.resolver import load_and_format

logger = get_logger(__name__)


def is_backchannel_enabled() -> bool:
    """Whether continuous back-channeling is on for this session.

    A single global flag (default on). Unlike the thinking-filler there is no
    per-scenario opt-in: a sparse listening signal is a baseline naturalness
    lever the whole platform gets unless ops turns it off.
    """
    return bool(getattr(settings, "BACKCHANNEL_GLOBALLY_ENABLED", True))


class _BackchannelPhrases(BaseModel):
    """Structured LLM output: the list of short back-channel options."""

    phrases: List[str]


def _build_scenario_context(scenario) -> str:
    """Compact description of the character doing the listening.

    Pulls the few fields that orient the model to who is listening, skipping
    anything empty. Best-effort — returns "" if nothing useful is available (the
    prompt still works, just with less grounding; back-channels are mostly
    language- not character-specific).
    """
    pd = getattr(scenario, "prompt_data", None)
    if pd is None:
        return ""
    parts: List[str] = []
    for label, attr in (
        ("Title", "title"),
        ("Character", "name"),
        ("Profession", "profession"),
        ("Description", "description"),
        ("Context", "context"),
        ("Role instructions", "role_instructions"),
    ):
        value = getattr(pd, attr, None)
        if value and str(value).strip():
            parts.append(f"{label}: {str(value).strip()}")
    return "\n".join(parts)


async def generate_backchannel_phrases(
    llm_client,
    scenario,
    count: int = 6,
) -> List[str]:
    """Ask the LLM for short listener back-channels in the scenario's language.

    Back-channels are generic listening signals, so unlike predictive fillers
    this needs no conversation history — it runs once at session start. Returns
    a cleaned, de-duplicated list of short phrases, or ``[]`` on any failure /
    empty output (the caller treats ``[]`` as "no back-channel"). Never raises.
    """
    if llm_client is None or count <= 0:
        return []

    try:
        language_code = (
            getattr(getattr(scenario, "language_config", None), "language_code", None)
            or "en-US"
        )
        pd = getattr(scenario, "prompt_data", None)
        language_label = getattr(pd, "language_label", None) or language_code

        system_prompt = load_and_format(
            "filler/backchannel",
            prompt_data=pd,
            scenario_context=_build_scenario_context(scenario),
            language_label=language_label,
            language_code=language_code,
            count=count,
        )
        if not system_prompt or not system_prompt.strip():
            logger.warning("[BACKCHANNEL] prompt template empty; skipping")
            return []

        llm_instance = llm_client.llm_instance
        response = await llm_instance.with_structured_output(
            _BackchannelPhrases
        ).ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(
                    content=(
                        f"Generate {count} short back-channel options now, "
                        f"in {language_label} ({language_code})."
                    )
                ),
            ]
        )

        raw = getattr(response, "phrases", None) or []
        cleaned: List[str] = []
        seen = set()
        for phrase in raw:
            if not isinstance(phrase, str):
                continue
            p = phrase.strip()
            key = p.lower()
            if p and key not in seen:
                seen.add(key)
                cleaned.append(p)
        return cleaned[:count]
    except Exception as e:  # noqa: BLE001 - back-channel must never break a session
        logger.warning("[BACKCHANNEL] generation failed: %s", e)
        return []
