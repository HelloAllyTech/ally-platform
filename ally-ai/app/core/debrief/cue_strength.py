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
from typing import Any, Dict, List, Optional, Tuple

CLEAR = "clear"
POSSIBLE = "possible"

#: Categories that are clear risk cues whatever the words.
CLEAR_CATEGORIES = frozenset(
    {"suicide_or_self_harm", "harm_to_others", "abuse_disclosure"}
)

# A hopelessness cue whose own words point at death, not being around,
# self-harm, a means or a plan is clear. English, Hindi, Tamil, Kannada,
# Marathi and Malayalam, in their own scripts and romanised; first-person or
# wish forms, so a grieving client's "my father died" stays possible. The
# list only ever raises a cue: the Safety reader's own clear or possible, by
# the RISK CUE DEFINITION, is the main signal.
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
            # Tamil, native script (2026-11-16; for native review). Wish and
            # first-person forms only: "செத்துட்டார்" / "இறந்துட்டார்"
            # (he died) stay possible. விஷம் (poison) is not a prefix of
            # விஷயம் (a matter).
            r"சாகணும்|சாக\s*வேண்டும்|சாகப்\s*போறேன்|சாகலாம்",
            r"செத்துப்\s*போகணும்|செத்துடணும்|செத்துடலாம்",
            r"தற்கொலை",
            r"வாழ\s*(?:விருப்பம்\s*இல்ல|பிடிக்கல|வேண்டாம்)",
            r"வாழ்ந்து\s*என்ன\s*(?:பயன்|பிரயோஜனம்)",
            r"உயிரை\s*(?:மாய்த்து|விட)",
            r"என்னை(?:யே)?\s*(?:நானே\s*)?கொல்ல",
            r"விஷம்|பூச்சி\s*மருந்து|தூக்கு\s*போட|தூக்கில்\s*தொங்க",
            # Tamil, romanised
            r"\b(?:saaganum|saganum|saaga\s*poren|saga\s*poren|saagalaam)\b",
            r"\b(?:sethu\s*poganum|sethudanum|sethudalaam|sethudalam)\b",
            r"\b(?:tharkolai|thatkolai|tarkolai)\b",
            r"\b(?:vaazha|vazha)\s*(?:pidikkala|viruppam\s*illa|vendaam)",
            r"\b(?:thookku|thooku)\s*poda",
            # Kannada, native script. "ಸತ್ತು ಹೋದರು" (they died) stays
            # possible; ವಿಷ alone is the start of ವಿಷಯ (a matter), so poison
            # counts only with "drink".
            r"ಸಾಯಬೇಕು|ಸಾಯ್ಬೇಕು|ಸಾಯ್ತೀನಿ|ಸತ್ತು\s*ಹೋಗಬೇಕು|ಸತ್ತರೆ\s*ಒಳ್ಳೆಯದು",
            r"ಆತ್ಮಹತ್ಯೆ",
            r"ಬದುಕ(?:ೋಕೆ|ಲು)\s*ಇಷ್ಟ\s*ಇಲ್ಲ|ಬದುಕಲು\s*ಇಷ್ಟವಿಲ್ಲ|ಬದುಕಿ\s*ಏನು\s*ಪ್ರಯೋಜನ",
            r"ವಿಷ\s*ಕುಡಿ|ನೇಣು",
            # Kannada, romanised
            r"\b(?:saayabeku|saaybeku|sayabeku|saaytini|sattu\s*hogabeku)\b",
            r"\b(?:aatmahatye|atmahatye)\b",
            r"\bbaduk(?:oke|alu)\s*ishta\s*illa",
            r"\bvisha\s*kudi",
            # Marathi, Devanagari (the Hindi entries above also apply:
            # आत्महत्या, मरणे). "वारले" / "मेला" (died) stay possible; विष
            # alone is the start of विषय (a subject), so poison counts only
            # with "drink" or "take".
            r"मरावं|मरावसं|मरावंसं|मरायचं|मरून\s*जाव",
            r"जगायचं\s*नाही|जगावंसं\s*वाटत\s*नाही|जगण्यात\s*(?:काही\s*)?अर्थ\s*नाही",
            r"जीव\s*द्याय|स्वतःला\s*संपव|संपवून\s*टाक",
            r"विष\s*(?:प्या|पिऊ|घे|खा)|गळफास|फास\s*(?:लाव|घे)",
            # Marathi, romanised
            r"\b(?:maravasa|maravsa|maraycha|marayche)\b",
            r"\bjagaych?a?\s*nahi",
            r"\b(?:jeev|jiv)\s*dyaych",
            r"\b(?:galphas|galfas)\b",
            # Malayalam, native script. "മരിച്ചു" (died) stays possible;
            # വിഷം (poison) is not a prefix of വിഷമം (sadness).
            r"ചാകണം|മരിക്കണം|മരിച്ചാൽ\s*മതി|ചത്താൽ\s*മതി|മരിക്കാൻ\s*തോന്നു",
            r"ആത്മഹത്യ",
            r"ജീവിക്കണ്ട|ജീവിക്കാൻ\s*ആഗ്രഹമില്ല|ജീവിച്ചിട്ട്\s*കാര്യമില്ല",
            r"വിഷം|തൂങ്ങി\s*മരിക്ക",
            # Malayalam, romanised: "vishamam" (sadness) never matches \bvisham\b.
            r"\b(?:chaakanam|chakanam|marikkanam|marichaal\s*mathi)\b",
            r"\b(?:aathmahathya|athmahathya)\b",
            r"\b(?:jeevikkanda|jeevikanda)\b",
            r"\bthoongi\s*marikk",
            # Poison, romanised (Tamil and Malayalam)
            r"\bvisham\b",
        ]
    ),
    re.IGNORECASE,
)


def cue_strength(cue: Dict[str, Any], word_list_raises: bool = True) -> str:
    """``clear`` or ``possible`` for one Safety reader cue.

    Clear when ANY signal says so (2026-11-16): the reader judged it clear by
    the RISK CUE DEFINITION; its category is a clear one; or the word list
    matches its quote. Nothing here lowers a cue: a reader's ``possible`` on
    a clear category or with clear words stays clear, and a cue the reader
    gave no strength is read as before (hopelessness without clear words is
    possible). With ``word_list_raises`` False the reader's own judgement
    decides: its ``strength`` (clear when it gave none), with neither the word
    list nor the always-clear categories applied."""
    if not word_list_raises:
        return POSSIBLE if cue.get("strength") == POSSIBLE else CLEAR
    if cue.get("strength") == CLEAR:
        return CLEAR
    if cue.get("category") in CLEAR_CATEGORIES:
        return CLEAR
    if cue.get("category") != "hopelessness":
        # An unknown category is not ours to discount.
        return CLEAR
    return CLEAR if _CLEAR_WORDS.search(str(cue.get("quote") or "")) else POSSIBLE


def with_strength(
    cues: List[Dict[str, Any]], word_list_raises: bool = True
) -> List[Dict[str, Any]]:
    """The cues, each with its final ``strength`` (the reader's own answer is
    one of the signals); every other field the reader returned is untouched."""
    return [{**c, "strength": cue_strength(c, word_list_raises)} for c in cues]


def is_clear(cue: Dict[str, Any]) -> bool:
    """A cue with no strength (an older run, another caller) counts as clear."""
    return cue.get("strength") != POSSIBLE


def quote_names_clear_risk(quote: str) -> bool:
    """The word list on its own: a quote that names death, self-harm, a means
    or a plan in a language the list covers. It only ever raises a cue to
    clear; a language it does not cover gets no help from it, never a lower
    strength."""
    return bool(_CLEAR_WORDS.search(str(quote or "")))


def turn_is_clear(
    turn: Any,
    quote: str,
    evaluator_cues: List[Dict[str, Any]],
    safety_cues: List[Dict[str, Any]],
    word_list_raises: bool = True,
) -> bool:
    """Is this client turn a clear risk cue? Yes when ANY signal says so:
    the word list on its quote; the Safety reader, which filed the turn under
    a clear category or with clear words; or the Evaluator, which listed the
    turn as a risk cue and did not answer ``clear: false`` (its answer is a
    reading of the meaning, in whatever language). Only when every signal
    reads it as ordinary low mood, burden, grief or guilt is it possible.
    No signal can lower another's clear."""
    if word_list_raises and quote_names_clear_risk(quote):
        return True
    if any(is_clear(c) for c in safety_cues or [] if c.get("turn_index") == turn):
        return True
    return any(
        c.get("clear", True) is not False
        for c in evaluator_cues or []
        if c.get("turn_index") == turn
    )


def split_missed_cues(
    evaluator_cues: List[Dict[str, Any]],
    safety_cues: List[Dict[str, Any]],
    word_list_raises: bool = True,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """The Evaluator's cues the debrief did not address, as (clear, possible)
    by ``turn_is_clear``. A clear one holds the debrief for a person, exactly
    as before; a possible one is published and sent to review."""
    clear: List[Dict[str, Any]] = []
    possible: List[Dict[str, Any]] = []
    for cue in evaluator_cues or []:
        if cue.get("addressed_by_debrief"):
            continue
        if turn_is_clear(
            cue.get("turn_index"),
            cue.get("quote") or "",
            [cue],
            safety_cues,
            word_list_raises,
        ):
            clear.append(cue)
        else:
            possible.append(cue)
    return clear, possible


def effective_hard_fails(
    hard_fails: List[Dict[str, Any]],
    evaluator_cues: List[Dict[str, Any]],
    safety_cues: List[Dict[str, Any]],
    word_list_raises: bool = True,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """The Evaluator's hard fails as the run counts them, with the missed cues
    split by ``split_missed_cues``: (hard fails, clear missed, possible missed).

    A ``missed_risk_cue`` hard fail raised only for cues every signal reads as
    possible is not one (the debrief is published and a person checks it), so
    it is dropped. The score and the step's one-line summary both use this, so
    the console never shows a hard fail the run did not count."""
    clear, possible = split_missed_cues(evaluator_cues, safety_cues, word_list_raises)
    if possible and not clear:
        return (
            [h for h in hard_fails if h["code"] != "missed_risk_cue"],
            clear,
            possible,
        )
    return list(hard_fails), clear, possible


def drop_possible_important_moment(
    cards: Dict[str, Any],
    evaluator_cues: List[Dict[str, Any]],
    safety_cues: List[Dict[str, Any]],
    word_list_raises: bool = True,
) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    """An important-moment card is for a clear risk cue. When the card's own
    moment and every other moment on it are possible by ``turn_is_clear``,
    the card goes and the moment is returned for review; otherwise the cards
    are unchanged. Call it only once the Evaluator has read the draft."""
    im = (cards or {}).get("important_moment")
    if not im:
        return cards, None
    moments = [im] + list(im.get("others") or [])
    if any(
        turn_is_clear(
            m.get("turn_index"),
            m.get("quote") or "",
            evaluator_cues,
            safety_cues,
            word_list_raises,
        )
        for m in moments
    ):
        return cards, None
    return {**cards, "important_moment": None}, {
        "turn_index": im.get("turn_index"),
        "quote": im.get("quote"),
    }
