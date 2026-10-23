"""How the learner and the simulated client talk: spoken (VOICE) or typed (TEXT).

ally-be puts ``interactionMode: "TEXT"`` on the room-metadata envelope only for a
text-chat roleplay, and sends no key at all for a voice one. Parsing is lenient
on purpose: TEXT is the only value that changes anything, so a missing,
misspelt or future value must land on VOICE — the behaviour every session had
before text chat existed — rather than fail the session.
"""

from typing import Any

INTERACTION_MODE_VOICE = "VOICE"
INTERACTION_MODE_TEXT = "TEXT"


def parse_interaction_mode(raw: Any) -> str:
    """Return TEXT only for an explicit TEXT (any case); VOICE otherwise."""
    if isinstance(raw, str) and raw.strip().upper() == INTERACTION_MODE_TEXT:
        return INTERACTION_MODE_TEXT
    return INTERACTION_MODE_VOICE
