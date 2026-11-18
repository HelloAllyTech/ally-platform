"""Debrief language judge: one structured call per debrief.

The LLM returns findings only. Everything checkable is checked here in code:
a finding must use a known type, and its evidence must really appear in the
debrief text (an invented quote is dropped, not trusted). Rates live in ally-be.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Dict, List, Optional, Tuple

from app.core.config import settings
from app.core.debrief_language.prompt import (
    DebriefSection,
    LanguageEvalParams,
    TranscriptTurn,
    build_judge_prompt,
)
from app.core.debrief_language.schemas import (
    ERROR_TYPES,
    MAX_EVIDENCE_CHARS,
    MAX_FINDINGS,
    MAX_NOTE_CHARS,
    DebriefLanguageOutput,
    JudgedDebriefLanguage,
    LanguageFinding,
    RawFinding,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)

_WS = re.compile(r"\s+")


def _norm(text: str) -> str:
    """NFC + collapsed whitespace + no zero-width joiners' effect on matching.

    Indic text is stored in different but equal code point orders; comparing
    raw strings would drop a real quote."""
    t = unicodedata.normalize("NFC", text or "")
    t = t.replace("‌", "").replace("‍", "")
    return _WS.sub(" ", t).strip()


_QUOTED = re.compile(r'"([^"]+)"|“([^”]+)”|«([^»]+)»')


def _verbatim_in_turns(evidence: str, turns: List[TranscriptTurn]) -> bool:
    """True when the quoted words are, character for character, in a cited turn.

    A `quote_altered` finding on words that ARE in the turn is a contradiction
    the model sometimes makes; code, which can compare exactly, settles it.
    """
    haystacks = [_norm(t.get("text", "")) for t in turns]
    marked = [next(g for g in m if g) for m in _QUOTED.findall(evidence)]
    for cand in [evidence] + marked:
        c = _norm(cand)
        if len(c) >= 6 and any(c in h for h in haystacks):
            return True
    return False


_INDIC = (
    (0x0900, 0x097F),  # Devanagari
    (0x0B80, 0x0BFF),  # Tamil
    (0x0C80, 0x0CFF),  # Kannada
    (0x0980, 0x09FF),  # Bengali
    (0x0A80, 0x0AFF),  # Gujarati
    (0x0C00, 0x0C7F),  # Telugu
    (0x0D00, 0x0D7F),  # Malayalam
)
_TOKEN = re.compile(r"[^\s\-–—/\"“”«»(),;:!?।.]+")


def _is_latin(ch: str) -> bool:
    return ("A" <= ch <= "Z") or ("a" <= ch <= "z")


def _is_indic(ch: str) -> bool:
    o = ord(ch)
    return any(lo <= o <= hi for lo, hi in _INDIC)


def mixed_script_words(sections: List[DebriefSection]) -> List[RawFinding]:
    """Words that fuse Latin and Indic letters: decided in code, not by the model.

    "Letters of two scripts inside ONE word" is exactly checkable, and a model
    reading 200 words misses a stray character often. A Latin word and a native
    suffix joined by a hyphen or space ("time-ல்") are separate tokens here, so
    ordinary code-mixing is never flagged.
    """
    out: List[RawFinding] = []
    for sec in sections:
        for tok in _TOKEN.findall(_norm(sec["text"])):
            if any(_is_latin(c) for c in tok) and any(_is_indic(c) for c in tok):
                out.append(
                    RawFinding(
                        section=sec["section"],
                        error_type="script_mix",
                        evidence_quote=tok,
                        note="One word mixes Latin and Indian-script letters.",
                    )
                )
    return out


#: Types that judge the debrief's OWN wording: words that are a verbatim quote of
#: a cited turn are exempt from them (a learner or client may say anything).
_OWN_WORDING = {
    "wrong_language",
    "untranslated_chunk",
    "script_mix",
    "stiff_register",
    "literal_translation",
    "grammar_or_agreement",
}


def validate_findings(
    output: DebriefLanguageOutput,
    sections: List[DebriefSection],
    quoted_turns: Optional[List[TranscriptTurn]] = None,
) -> JudgedDebriefLanguage:
    """Keep only findings that name a known type and quote real words."""
    texts = [(s["section"], _norm(s["text"])) for s in sections]
    kept: List[LanguageFinding] = []
    dropped: Dict[str, int] = {}
    seen = set()

    def drop(reason: str) -> None:
        dropped[reason] = dropped.get(reason, 0) + 1

    for f in list(output.findings) + mixed_script_words(sections):
        if f.error_type not in ERROR_TYPES:
            drop("unknown_type")
            continue
        quote = _norm(f.evidence_quote)
        if not quote or len(quote) > MAX_EVIDENCE_CHARS:
            drop("bad_evidence")
            continue
        where = next((name for name, t in texts if quote in t), None)
        if where is None:
            drop("quote_not_in_debrief")
            continue
        if f.error_type == "quote_altered" and _verbatim_in_turns(
            quote, quoted_turns or []
        ):
            drop("quote_is_verbatim")
            continue
        if f.error_type in _OWN_WORDING and any(
            len(quote) >= 6 and quote in _norm(t.get("text", ""))
            for t in quoted_turns or []
        ):
            drop("verbatim_quote_exempt")
            continue
        key = (f.error_type, quote)
        if key in seen:
            drop("duplicate")
            continue
        seen.add(key)
        if len(kept) >= MAX_FINDINGS:
            drop("over_cap")
            continue
        kept.append(
            LanguageFinding(
                section=where,  # the section the words are really in
                error_type=f.error_type,  # type: ignore[arg-type]
                evidence_quote=quote,
                note=(f.note or "").strip()[:MAX_NOTE_CHARS],
            )
        )
    if dropped:
        logger.warning("[debrief-language] dropped findings: %s", dropped)
    return JudgedDebriefLanguage(findings=kept, dropped=dropped)


async def judge_debrief_language(
    sections: List[DebriefSection],
    language: str,
    params: Optional[LanguageEvalParams] = None,
    quoted_turns: Optional[List[TranscriptTurn]] = None,
    rubric: Optional[str] = None,
    scenario_session_id: Optional[str] = None,
    model: Optional[str] = None,
    provider: Optional[str] = None,
) -> Tuple[Optional[JudgedDebriefLanguage], str]:
    """Judge one debrief's language. Returns (result, model that ran).

    None means "nothing to judge" or "no usable answer"; the caller records a
    failed attempt, never a clean result. An empty findings list is a real
    answer: the language is fine."""
    cfg = settings.DEBRIEF_LANGUAGE_JUDGE
    run_model = model or cfg.MODEL
    if not any(s["text"].strip() for s in sections):
        return None, run_model

    prompt = build_judge_prompt(
        sections, language, params=params, quoted_turns=quoted_turns, rubric=rubric
    )

    from app.core.llm.dispatch import generate_structured
    from app.core.llm_usage.tasks import LLMTask

    output, meta = await generate_structured(
        schema=DebriefLanguageOutput,
        prompt=prompt,
        task=LLMTask.DEBRIEF_LANGUAGE_JUDGE.value,
        provider=provider or cfg.PROVIDER,
        # Pinned: a substitute's judgment would break the measured series.
        never_fallback=True,
        model=run_model,
        temperature=0,
        max_tokens=None,
        scenario_session_id=scenario_session_id,
    )
    if output is None:
        logger.warning("[debrief-language] judge returned no output")
        return None, meta["model"]
    return validate_findings(output, sections, quoted_turns), meta["model"]
