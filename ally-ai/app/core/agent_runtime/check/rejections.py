"""Why the check sends a draft back, and what the agent is told each time."""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Dict

from app.core.agent_runtime.check.text import detail_kinds


class Rejection(StrEnum):
    """Why the check sent a draft back to the agent (told to it as REJECTIONS).

    Stored in the run's state as its plain value, which the state requires."""

    CLINICAL_ADVICE = "clinical_advice"
    UNCITED = "uncited"
    UNSOURCED_DETAIL = "unsourced_detail"
    EMPTY = "empty"
    SEARCH_FIRST = "search_first"
    MENTIONS_SOURCES = "mentions_sources"
    USE_FOUND = "use_found"
    SEARCH_AGAIN = "search_again"
    OFFERS_SLOT = "offers_slot"
    UNFOUND_SLOT = "unfound_slot"


def rejection_feedback(
    rejection: Rejection, step: Dict[str, Any], *, searched: bool = True
) -> str:
    """What the rewrite is told: the reason, naming the kinds of unsourced detail,
    and to search first when the refused draft was written without searching."""
    feedback = REJECTIONS[rejection]
    if rejection == Rejection.UNSOURCED_DETAIL:
        kinds = detail_kinds(step.get("answer") or "")
        if kinds:
            feedback += f" It contained {' and '.join(kinds)}."
    if not searched and rejection not in (
        Rejection.EMPTY,
        Rejection.SEARCH_FIRST,
        Rejection.MENTIONS_SOURCES,
        Rejection.UNFOUND_SLOT,
    ):
        feedback += " You haven't searched yet: search before you reply."
    return feedback


#: Why a draft was refused, as told to the agent when it rewrites it. Plain
#: guidance, never the refused text.
REJECTIONS: Dict[Rejection, str] = {
    Rejection.CLINICAL_ADVICE: (
        "It diagnosed, interpreted a result, or advised on a medicine or its dose. "
        "This assistant never does, whatever its instructions say. Say plainly that "
        "you can't advise on that, and point the person to the team, or to "
        "emergency care if it sounds urgent."
    ),
    Rejection.UNCITED: (
        "It stated something about the organisation without citing a passage. "
        "Cite the passages that support it; if none do and searches are left, "
        "search; otherwise tell the person, in your own words, that you don't have "
        "that information and where they could go instead."
    ),
    Rejection.UNSOURCED_DETAIL: (
        "It included a specific detail (a phone number, link, email or price) that "
        "no passage offered here contains word for word. Leave it out, or use it "
        "only as a passage gives it."
    ),
    Rejection.EMPTY: "It was empty. Write the reply the person should get.",
    Rejection.SEARCH_FIRST: (
        "It said it doesn't have this without searching. Search first: the answer "
        "may be in the library."
    ),
    Rejection.MENTIONS_SOURCES: (
        "It talked about its reference material, documents or passages. Say the same "
        "as someone who simply knows, or doesn't: no talk of sources."
    ),
    Rejection.USE_FOUND: (
        "A search found passages. If they answer what was asked, answer from them "
        "and cite them. If they are about something else, say plainly what you don't "
        "have and what you can help with."
    ),
    Rejection.SEARCH_AGAIN: (
        "You said you don't have this after one search. Search once more with "
        "different words: the key words of the question, without the business's "
        "name. Then answer from the passages that answer it and cite them, or say "
        "plainly what you don't have."
    ),
    Rejection.OFFERS_SLOT: (
        "It named a day or time as available, called it a slot, or said it was "
        "booked. You can't see or hold appointments: say the team will confirm "
        "what's free, and keep the rest."
    ),
    Rejection.UNFOUND_SLOT: (
        "It named a day or time as free, or as booked, without citing an entry a "
        "find_ or create_ tool returned. Look it up with find first and offer only "
        "what it shows, citing it; say something is booked only after create or "
        "update did it, citing that."
    ),
}
