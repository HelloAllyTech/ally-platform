"""The few lines the guide voice worker speaks on its own.

Everything else Ally says is written by ally-be. These cover the moments when
ally-be can't answer: the session is over, voice is switched off, a turn was
lost, or a turn is slow. Each says what happened and what the learner can do
next — keep typing, or say it again — rather than naming an error (plan §5.12,
"never an error code").

TRANSLATIONS ARE NOT DONE YET — same policy as app/core/fallback_lines.py: a
line a learner hears in Ally's voice is not machine-translated here. Every
non-English entry is still the English string, marked NEEDS-TRANSLATION, and
resolves through the same exact → base → English lookup.
"""

from __future__ import annotations

from enum import Enum
from typing import Dict, Optional

from app.core.fallback_lines import resolve_line

SESSION_ENDED_EN = "This voice session has ended. You can keep going by typing."
VOICE_OFF_EN = "Voice is off for now. You can keep going by typing."
VOICE_UNAVAILABLE_EN = "Voice isn't working right now. You can keep going by typing."
LOST_THAT_EN = "Sorry, I lost that. Could you say it again?"
SLOW_TURN_EN = "This one's taking me a moment…"

#: TODO(i18n): human translations needed for hi, mr, ta, kn (Ally's languages).
#: Native script only — the Indic voices mis-read Latin transliteration.
_UNTRANSLATED = ("hi", "mr", "ta", "kn")


def _table(english: str) -> Dict[str, str]:
    table = {"en": english}
    for code in _UNTRANSLATED:
        table[code] = english  # TODO(i18n) NEEDS-TRANSLATION
    return table


SESSION_ENDED_LINES = _table(SESSION_ENDED_EN)
VOICE_OFF_LINES = _table(VOICE_OFF_EN)
VOICE_UNAVAILABLE_LINES = _table(VOICE_UNAVAILABLE_EN)
LOST_THAT_LINES = _table(LOST_THAT_EN)
SLOW_TURN_LINES = _table(SLOW_TURN_EN)


class LeaveReason(str, Enum):
    """Why the worker is leaving the room on its own."""

    #: ally-be answered 401 — the token expired, or a newer session replaced it.
    SESSION_ENDED = "session_ended"
    #: ally-be answered guide_disabled — a kill switch is off.
    VOICE_OFF = "voice_off"
    #: ally-be could not be reached to start the session.
    UNAVAILABLE = "unavailable"


_LEAVE_LINES = {
    LeaveReason.SESSION_ENDED: (SESSION_ENDED_LINES, SESSION_ENDED_EN),
    LeaveReason.VOICE_OFF: (VOICE_OFF_LINES, VOICE_OFF_EN),
    LeaveReason.UNAVAILABLE: (VOICE_UNAVAILABLE_LINES, VOICE_UNAVAILABLE_EN),
}


def leave_line(reason: LeaveReason, language: Optional[str]) -> str:
    table, default = _LEAVE_LINES[reason]
    return resolve_line(table, language, default)


def lost_that_line(language: Optional[str]) -> str:
    return resolve_line(LOST_THAT_LINES, language, LOST_THAT_EN)


def slow_turn_line(language: Optional[str]) -> str:
    return resolve_line(SLOW_TURN_LINES, language, SLOW_TURN_EN)
