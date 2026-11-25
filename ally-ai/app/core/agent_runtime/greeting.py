"""Whole-message greetings and self-introductions (TF1 round 2, Saathi B-1).

"Hi, I'm Asha" was searched before the first model call, the search found passages,
and the reply check then treated the greeting as an answer with no citation and sent
the fixed decline instead. A message that is ONLY a greeting and/or an introduction
needs no search and stays small talk.

Deliberately narrow: "Hi, I'm Asha, are you open now?" is a question; "I'm 16",
"I'm scared" and "I'm pregnant" are not introductions.
"""

from __future__ import annotations

import re

_GREETING = (
    r"(?:hi+|hey+|hello+|hiya|helo|namaste|namaskar|namaskaram|salaam|salam|"
    r"good (?:morning|afternoon|evening|day)|hi there|hey there|hello there|"
    r"नमस्ते|नमस्कार)(?:\s+(?:ji|there|everyone|team|saathi|all))?"
)
# Never "call me", "it's", "this is" or "main": "call me tomorrow", "it's urgent",
# "this is serious" and "main thak gayi" are not introductions.
_INTRO_LEAD = r"(?:i'?m|i am|im|my name is|my name's|mera naam|मेरा नाम)"
_INTRO_TAIL = r"(?:\s+(?:hai|hoon|hun|here|हूँ|हूं|है))?"
#: A letter, including Devanagari's vowel signs (not "word" characters to `re`).
_LETTER = r"(?:[^\W\d_]|[\u0900-\u0963\u0971-\u097F])"
_NAME = rf"(?P<name>{_LETTER}{{2,20}}(?:\s+{_LETTER}{{2,20}})?)"

#: Words after "I'm" that describe a state, a feeling or a role, never a name.
_NOT_A_NAME = frozenset(
    """
    a an the so very really just not also still feeling fine good ok okay okk well
    sad scared stressed anxious worried tired afraid alone lonely lost confused upset
    depressed angry sorry sick ill unwell hurt pregnant new back here there home busy
    free done ready sure happy glad bored hungry broke stuck trapped dying calling
    looking trying going asking writing texting from in at with on about for to
    student mother father parent mom mum dad teacher volunteer worker patient caller
    nervous fine-ish better worse great awful terrible bad overwhelmed exhausted
    panicking crying struggling unsafe safe late early sorry interested
    thinking feeling hoping wondering homeless suicidal desperate drunk high numb
    empty useless hopeless helpless worthless urgent serious emergency serious
    alive dead fine-ish worried-sick
    """.split()
)
#: Endings of describing words ("hopeless", "anxious", "helpful", "suicidal").
_NOT_A_NAME_ENDINGS = ("ing", "ed", "less", "ful", "ous", "ive", "ish")

_ONLY = re.compile(
    rf"^\s*(?:(?P<greet>{_GREETING})[\s,.!-]*)?"
    rf"(?:(?:{_INTRO_LEAD})\s+{_NAME}{_INTRO_TAIL})?[\s,.!?:)(\-]*$",
    re.IGNORECASE | re.UNICODE,
)


def is_greeting_or_intro(text: str) -> bool:
    """True when the whole message is a greeting, an introduction, or both."""
    said = (text or "").strip()
    if not said or len(said) > 80:
        return False
    match = _ONLY.match(said)
    if not match:
        return False
    name = match.group("name")
    if name is None:
        return bool(match.group("greet"))
    words = name.lower().split()
    return not any(w in _NOT_A_NAME or w.endswith(_NOT_A_NAME_ENDINGS) for w in words)
