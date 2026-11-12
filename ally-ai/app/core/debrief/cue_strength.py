"""How sure a Safety reader cue is, for the Writer and the coverage check.

The Safety reader is recall-first by design ("when unsure, INCLUDE"), and its
prompt and recall are pinned. Downstream, an "important moment" card on
ordinary low mood, burden, grief or guilt misleads the learner and pulls the
coaching towards risk assessment (gold sessions, 2026-11-12). So each cue gets
a strength, derived here in code from what the reader already returns,
without touching the reader:

- ``clear``: the reader put it under suicide or self-harm, harm to others or
  abuse; or it is under hopelessness but its own words name death, not
  wanting to live or be around, self-harm, a means or a plan. The Writer must
  make the important moment of it, and the coverage check fails a draft that
  leaves it out, exactly as before.
- ``possible``: everything else under hopelessness. The Writer decides from
  its instructions whether it is a clear risk cue, and makes it the important
  moment when it is or when unsure; nothing forces a card.

Strength only ever lowers what is *required* of the learner's cards. Every
cue still counts for ``has_risk_cue`` (the Console's risk flag and the
learner's support lines), and a cue with no strength is treated as clear.
The word list only ever raises a cue to clear, so a missing word costs a
card the Writer may still make, never a cue.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List

CLEAR = "clear"
POSSIBLE = "possible"

#: Categories that are clear risk cues whatever the words.
CLEAR_CATEGORIES = frozenset(
    {"suicide_or_self_harm", "harm_to_others", "abuse_disclosure"}
)

# A hopelessness cue whose own words point at death, not being around,
# self-harm, a means or a plan is clear. English, Hindi (Devanagari) and
# romanised Hindi; first-person or wish forms, so a grieving client's "my
# father died" stays possible.
_CLEAR_WORDS = re.compile(
    "|".join(
        [
            # English
            r"\b(?:want|wanted|wish|wished|going|rather|ready)\s+"
            r"(?:to\s+)?(?:die|be\s+dead)\b",
            r"\bbetter\s+off\s+(?:dead|without\s+me|if\s+i)",
            r"\b(?:kill|killing|hurt|hurting|harm|harming|cut|cutting)\s+my\s*self\b",
            r"\bsuicid",
            r"\bend(?:ing)?\s+(?:it\s+all|my\s+life|things|it)\b",
            r"\b(?:not|never|didn'?t|don'?t)\s+wake\s+up\b",
            r"\b(?:wasn'?t|weren'?t|not\s+be|not)\s+(?:here|around|alive)"
            r"\s*(?:any\s*more)?\b",
            r"\bdisappear\b",
            r"\bcan'?t\s+go\s+on\b",
            r"\bno\s+(?:reason|point)\s+(?:to|in)\s+(?:live|living|being\s+alive)\b",
            r"\b(?:pills|overdose|poison|rope|noose|jump\s+off)\b",
            # Hindi, Devanagari
            r"मर\s*जा",
            r"मरना",
            r"मरने",
            r"मौत",
            r"जान\s*दे",
            r"जान\s*ले",
            r"आत्महत्या",
            r"ख़ुदकुशी|खुदकुशी",
            r"ख़त्म\s*कर|खत्म\s*कर",
            r"जीना\s*नहीं|जीने\s*का\s*मन\s*नहीं|जीने\s*की\s*(?:कोई\s*)?वजह",
            r"न\s*रहूँ|न\s*रहूं|ना\s*रहूँ|ना\s*रहूं|नहीं\s*रहूँगा|नहीं\s*रहूँगी",
            r"काट\s*ल",
            r"ज़हर|जहर|फंदा|फांसी|गोलियाँ|गोलियां|पंख[ेा]",
            # Hindi, romanised
            r"\bmar\s*ja",
            r"\bmarna\b",
            r"\bmarne\b",
            r"\bmaut\b",
            r"\bjaan\s*(?:de|le)",
            r"\bkhudkushi\b",
            r"\b(?:khatam|khatm)\s*kar",
            r"\bjeena\s*nahi|\bjeene\s*ka\s*man\s*nahi",
            r"\b(?:na|naa)\s*rahu",
            r"\b(?:zeher|zehar|jahar|phanda|fansi|faansi|pankh[ea])\b",
        ]
    ),
    re.IGNORECASE,
)


def cue_strength(cue: Dict[str, Any]) -> str:
    """``clear`` or ``possible`` for one Safety reader cue."""
    if cue.get("category") in CLEAR_CATEGORIES:
        return CLEAR
    if cue.get("category") != "hopelessness":
        # An unknown category is not ours to discount.
        return CLEAR
    return CLEAR if _CLEAR_WORDS.search(str(cue.get("quote") or "")) else POSSIBLE


def with_strength(cues: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The cues, each with its ``strength``; the reader's fields are untouched."""
    return [{**c, "strength": cue_strength(c)} for c in cues]


def is_clear(cue: Dict[str, Any]) -> bool:
    """A cue with no strength (an older run, another caller) counts as clear."""
    return cue.get("strength") != POSSIBLE
