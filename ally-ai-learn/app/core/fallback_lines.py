"""Spoken fallback lines, resolved by the session's language.

WHY THIS EXISTS
---------------
When the main LLM call times out (``LLM_RESPONSE_TIMEOUT``, 30s) the turn still
has to say SOMETHING, so ``generate_response`` substitutes a fixed line. That
line was hardcoded English, unconditionally — so a Hindi, Tamil, Telugu or
Marathi learner suddenly heard an English sentence in the persona's voice, in
the middle of a session that had been entirely in their language. It is the
most jarring possible moment for the illusion to break, because it only ever
happens when something is already going wrong.

Worse than jarring: the Indic TTS voices spell Latin script out
letter-by-letter (the same trap documented in app/core/livekit/fillers.py), so
an English fallback on a Sarvam/Indic voice can come out as spelled-out
characters rather than a sentence.

This module fixes the MECHANISM: one lookup table, keyed by language, with
English as the default. Adding a real translation is now a one-line change in
one place instead of a code change on the timeout path.

TRANSLATIONS ARE NOT DONE YET
-----------------------------
Every non-English entry below is deliberately still the English string, marked
``TODO(i18n)``. These are lines a learner HEARS in a persona's voice — a
machine translation that is grammatically odd or register-wrong would damage
the roleplay more than the English does, and this file is not the place to
guess. Each language needing a human translation is listed explicitly below so
the list can be handed to a translator as-is.

Resolution order for a code like ``ta-IN``:
  1. exact match (``ta-IN``)
  2. base language (``ta``)
  3. English default

An unknown/absent language code therefore behaves exactly as before this
module existed, which keeps the change safe for any scenario using a language
code that is not in the table.
"""

from __future__ import annotations

from typing import Dict, Optional

from app.core.constants import DEFAULT_LANGUAGE_CODE

#: The English source string. Every entry below that still equals this needs a
#: human translation.
LLM_TIMEOUT_FALLBACK_EN = "Sorry, can you say that again?"

#: Spoken when the main LLM call times out mid-turn, keyed by base language
#: code. Keep keys as BASE codes (``hi``, not ``hi-IN``) — the resolver falls
#: back from region to base, so one entry covers ``hi``, ``hi-IN`` and any
#: future regional variant.
#:
#: TODO(i18n): every entry marked NEEDS-TRANSLATION below is still the English
#: string. Human translations required for: Hindi (hi), Bengali (bn),
#: Tamil (ta), Telugu (te), Kannada (kn), Malayalam (ml), Marathi (mr),
#: Gujarati (gu), Punjabi (pa), Urdu (ur), Odia (or), Assamese (as).
#: The line must read as natural spoken speech in the persona's register — a
#: caller asking someone to repeat themselves — not as a UI error message, and
#: must be in the native script (Latin transliteration is mis-pronounced by the
#: Indic TTS voices).
LLM_TIMEOUT_FALLBACK_LINES: Dict[str, str] = {
    "en": LLM_TIMEOUT_FALLBACK_EN,
    "hi": LLM_TIMEOUT_FALLBACK_EN,  # TODO(i18n) NEEDS-TRANSLATION: Hindi
    "bn": LLM_TIMEOUT_FALLBACK_EN,  # TODO(i18n) NEEDS-TRANSLATION: Bengali
    "ta": LLM_TIMEOUT_FALLBACK_EN,  # TODO(i18n) NEEDS-TRANSLATION: Tamil
    "te": LLM_TIMEOUT_FALLBACK_EN,  # TODO(i18n) NEEDS-TRANSLATION: Telugu
    "kn": LLM_TIMEOUT_FALLBACK_EN,  # TODO(i18n) NEEDS-TRANSLATION: Kannada
    "ml": LLM_TIMEOUT_FALLBACK_EN,  # TODO(i18n) NEEDS-TRANSLATION: Malayalam
    "mr": LLM_TIMEOUT_FALLBACK_EN,  # TODO(i18n) NEEDS-TRANSLATION: Marathi
    "gu": LLM_TIMEOUT_FALLBACK_EN,  # TODO(i18n) NEEDS-TRANSLATION: Gujarati
    "pa": LLM_TIMEOUT_FALLBACK_EN,  # TODO(i18n) NEEDS-TRANSLATION: Punjabi
    "ur": LLM_TIMEOUT_FALLBACK_EN,  # TODO(i18n) NEEDS-TRANSLATION: Urdu
    "or": LLM_TIMEOUT_FALLBACK_EN,  # TODO(i18n) NEEDS-TRANSLATION: Odia
    "as": LLM_TIMEOUT_FALLBACK_EN,  # TODO(i18n) NEEDS-TRANSLATION: Assamese
}


def _base_code(language_code: Optional[str]) -> str:
    if not language_code or not isinstance(language_code, str):
        return DEFAULT_LANGUAGE_CODE.split("-")[0]
    return language_code.strip().split("-")[0].lower()


def resolve_line(
    table: Dict[str, str],
    language_code: Optional[str],
    default: str,
) -> str:
    """Look ``language_code`` up in ``table``: exact, then base, then default."""
    if language_code and isinstance(language_code, str):
        exact = table.get(language_code.strip())
        if exact:
            return exact
    return table.get(_base_code(language_code)) or default


def llm_timeout_fallback_line(language_code: Optional[str]) -> str:
    """The line to speak when the main LLM call times out for this session.

    Returns English for any language without a translation, which is the
    pre-existing behaviour — so this can never make an existing session worse.
    """
    return resolve_line(
        LLM_TIMEOUT_FALLBACK_LINES, language_code, LLM_TIMEOUT_FALLBACK_EN
    )


def tts_failure_fallback_line(language_code: Optional[str]) -> str:
    """The line to speak when a turn's audio was LOST to a TTS failure.

    Different cause, identical need: the learner is sitting in silence after
    saying something, and the only useful thing the persona can do is invite
    them to speak again — which also drives a fresh turn, and with it a fresh
    synthesis attempt. So this deliberately shares the LLM-timeout table rather
    than introducing a second string: two near-identical lines would double the
    translation work (see the TODO(i18n) list above) for no difference the
    learner can hear. Kept as its own function so the call site reads honestly,
    and so the two can diverge later without touching the caller.
    """
    return resolve_line(
        LLM_TIMEOUT_FALLBACK_LINES, language_code, LLM_TIMEOUT_FALLBACK_EN
    )


def untranslated_languages(table: Dict[str, str] = None) -> list[str]:
    """Base language codes whose line is still the untranslated English string.

    Exposed so a test can assert the TODO list stays honest: if someone adds a
    real translation, this shrinks; if someone adds a new language without one,
    it grows and is visible rather than silently English.
    """
    target = LLM_TIMEOUT_FALLBACK_LINES if table is None else table
    return sorted(
        code
        for code, line in target.items()
        if code != "en" and line == LLM_TIMEOUT_FALLBACK_EN
    )
