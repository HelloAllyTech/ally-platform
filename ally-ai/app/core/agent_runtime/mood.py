"""How the person feels (Q3-fast Part 1): ally-be's crisis check found them upset,
not at risk, and the run is told, so its reply opens warmly instead of with a crisis
template. Nothing here changes a run that isn't upset."""

from __future__ import annotations

import re
from typing import Any, Dict, Mapping, Optional

from app.prompts.resolver import load_and_format

UPSET_PROMPT_PATH = "agent/upset"
UPSET_SUPPORT_PROMPT_PATH = "agent/upset_support"
UPSET_NUMBERS_PROMPT_PATH = "agent/upset_numbers"
#: The numbers every upset person can be given (Q4 G7), whatever the pack.
NATIONAL_NUMBERS = "Tele-MANAS on 14416 (free, 24×7), or 112 if you're in danger"
#: Health and mental-health assistants also name the support there is.
HEALTH_PACKS = frozenset({"mental_health", "medical", "pharmacy"})
#: Only a mental-health assistant falls back to Tele-MANAS (stop 1): someone annoyed
#: about a wait at an eye hospital shouldn't be given a mental-health line.
DEFAULT_HELPLINES = {"mental_health": "Tele-MANAS on 14416 (free, 24×7)"}
#: "Any time" only for a number marked round the clock (stop 1).
ROUND_THE_CLOCK = re.compile(r"24\s*[x×/*]\s*7|round the clock|any ?time", re.I)


def mood_section(
    bot: Mapping[str, Any], prompts: Optional[Dict[str, Any]] = None
) -> str:
    """The "How they feel" section, or "" unless the person is upset."""
    if bot.get("mood") != "upset":
        return ""
    text = load_and_format(UPSET_PROMPT_PATH, prompts=prompts).strip()
    persona = bot.get("persona") or {}
    pack = persona.get("safety_pack")
    helplines = (bot.get("support_helplines") or "").strip() or DEFAULT_HELPLINES.get(
        pack, ""
    )
    if pack in HEALTH_PACKS and helplines:
        support = load_and_format(
            UPSET_SUPPORT_PROMPT_PATH,
            prompts=prompts,
            organisation=(persona.get("display_name") or "").strip() or "the team",
            helplines=helplines,
            any_time=" any time" if ROUND_THE_CLOCK.search(helplines) else "",
        ).strip()
        if support:
            text = f"{text}\n{support}"
    # Q4 G7: on every pack, the numbers it can give, so it never says it has none.
    # `support_helplines` is the organisation's own line, sent only when the owner
    # confirmed it for crisis replies.
    own = (bot.get("support_helplines") or "").strip()
    name = (persona.get("display_name") or "").strip()
    numbers = NATIONAL_NUMBERS + (
        f"; or {name or 'the organisation'} on {own}" if own else ""
    )
    extra = load_and_format(
        UPSET_NUMBERS_PROMPT_PATH, prompts=prompts, numbers=numbers
    ).strip()
    if extra:
        text = f"{text}\n{extra}"
    return text
