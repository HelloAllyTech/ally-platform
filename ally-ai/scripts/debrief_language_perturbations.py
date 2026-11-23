"""The gate for the debrief language judge: is the instrument itself checked?

The judge says "this debrief has a language problem". Before its number is read,
it must (a) catch faults we planted, (b) leave look-alike non-faults alone, and
(c) give the same answer when asked again. No human labels: a planted fault is
known by construction, and the second model only measures agreement (PRD NFR1).

What it does
------------
1. FIXTURES (`--build-fixtures`): per language (en-IN hi-IN mr-IN ta-IN kn-IN),
   several synthetic ~12-turn sessions are written by a model, read by the real
   Analyst and written up by the REAL Writer step (`app.core.debrief.steps`). A
   debrief is kept only if it passes the rule checks the system applies to every
   draft that we can run here (quotes verbatim and from the right speaker, no turn
   numbers, no score, the session language's script). They are saved under
   tests/fixtures/debrief_language/ and are synthetic: no learner data.
2. PLANTED FAULTS, deterministic code edits of a good debrief:
   wrong_language, script_mix, untranslated_chunk, quote_altered.
   NOT GATED (no checked rewrite exists to plant them): stiff_register,
   literal_translation, grammar_or_agreement, meaning_drift. Whatever the judge
   reports for those is informational and the report says so.
3. LOOK-ALIKE NON-FAULTS that must NOT be flagged: a Latin-script proper noun /
   abbreviation, a common loanword ("feedback", "session"), a verbatim English
   learner quote inside a non-English debrief, and the language's intended
   code-mixing with English.
4. Every case runs 3 times. A case is "caught" (fault) or "flagged" (non-fault) by
   majority. Reported per language and per type with a 95% Wilson interval, the
   false-flag rate, and the FLIP RATE (share of cases whose 3 answers disagree).
5. Two candidate judge models are compared (`--models a,b`): agreement (Cohen's
   kappa on "flagged the planted span") and recall; the cheaper one is kept unless
   it is measurably worse (recall lower by more than sampling noise, z < -1.96).
6. Prints the judge model and whether its provider family differs from the Writer's.

Thresholds (the primary judge = settings DEBRIEF_LANGUAGE_JUDGE.MODEL), exit 1 if:
  * a gated fault type's pooled catch rate < 0.80 (n = cases of that type across languages);
  * a language's catch rate over its gated cases < 0.75;
  * the false-flag rate over look-alikes > 0.10;
  * the flip rate > 0.10;
  * detection floor: a gated cell has fewer than MIN_CELL (10) cases, so it cannot show
    a catch rate of 0.80 at all (Wilson lower bound at 10/10 is 0.72): the run is
    refused as "underpowered" rather than passed.
Per-language x per-type cells hold only a few cases each; they are printed with their
intervals but only the pooled numbers gate.

Run from the ally-ai project so the .env loads (a few dollars, live calls):

    poetry run python scripts/debrief_language_perturbations.py --build-fixtures
    poetry run python scripts/debrief_language_perturbations.py --models gpt-5-mini,gpt-5
"""

# flake8: noqa: E501  (fixed native-language sentence banks and long report lines)
from __future__ import annotations

import argparse
import asyncio
import json
import math
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.debrief_language.judge import judge_debrief_language
from app.core.debrief_language.prompt import LanguageEvalParams

FIXTURES = Path(__file__).resolve().parents[1] / "tests/fixtures/debrief_language"
LANGS = ["en-IN", "hi-IN", "mr-IN", "ta-IN", "kn-IN"]
PER_LANG = 3
RUNS = 3

# languages.evalConfig as the judge receives it (label, variety, code-switch partners).
CONFIG: Dict[str, Dict[str, Any]] = {
    "en-IN": dict(
        language_label="English (India)",
        target_variety="plain, warm Indian English",
        diglossia=False,
        code_switch_partners=[],
    ),
    "hi-IN": dict(
        language_label="Hindi (India)",
        target_variety="colloquial spoken Hindi",
        diglossia=True,
        code_switch_partners=["English"],
    ),
    "mr-IN": dict(
        language_label="Marathi (India)",
        target_variety="colloquial spoken Marathi",
        diglossia=True,
        code_switch_partners=["English"],
    ),
    "ta-IN": dict(
        language_label="Tamil (India)",
        target_variety="colloquial spoken Tamil",
        diglossia=True,
        code_switch_partners=["English"],
    ),
    "kn-IN": dict(
        language_label="Kannada (India)",
        target_variety="colloquial spoken Kannada",
        diglossia=True,
        code_switch_partners=["English"],
    ),
}
SCRIPT_RANGE = {  # inclusive code point ranges of the language's own script
    "hi": (0x0900, 0x097F),
    "mr": (0x0900, 0x097F),
    "ta": (0x0B80, 0x0BFF),
    "kn": (0x0C80, 0x0CFF),
}

SCENARIOS = [
    "A young woman, a final-year student, cannot sleep and is afraid of failing her exams; she feels her family's hopes are heavy. No thoughts of self-harm.",
    "A father is exhausted and ashamed because he shouted at his ten-year-old son; he wants to be a calmer parent but does not know how.",
    "A man lost his job two months ago and avoids his friends; he is worried about money and feels like a failure. No thoughts of self-harm.",
    "A woman is caring alone for her elderly mother with memory problems and feels guilty when she gets angry or tired.",
]

# Fixed sentence banks (deterministic plants). Native text written by hand.
EN_SENTENCES = [
    "You did a good job of listening to her and staying calm during the whole conversation.",
    "Next time, try to slow down and let her finish her thought before you respond.",
    "This shows that she felt safe enough to share what was really worrying her.",
]
HI_SENTENCES_FOR_EN = [
    "आपने उसकी बात ध्यान से सुनी और पूरी बातचीत में शांत रहे।",
    "अगली बार थोड़ा धीमे चलें और उसे अपनी बात पूरी करने दें।",
    "इससे पता चलता है कि वह अपनी असली चिंता बताने में सहज महसूस कर रही थी।",
]
EN_CHUNKS = [
    "so that she can feel safe and fully heard",
    "before you offer any advice or a solution",
    "to show that you really understand her feelings",
]
LATIN_NAME = {
    "en-IN": "This also matches the WHO guidance, as Dr. Sharma has said.",
    "hi-IN": "यह बात WHO की गाइडलाइन से भी मेल खाती है, जैसा Dr. Sharma ने भी कहा है।",
    "mr-IN": "हे WHO च्या मार्गदर्शनाशी जुळते, जसे Dr. Sharma यांनीही सांगितले आहे.",
    "ta-IN": "இது WHO வழிகாட்டுதலுடனும், Dr. Sharma கூறியதுடனும் ஒத்துப்போகிறது.",
    "kn-IN": "ಇದು WHO ಮಾರ್ಗಸೂಚಿಗೆ ಮತ್ತು Dr. Sharma ಹೇಳಿದ್ದಕ್ಕೂ ಹೊಂದಿಕೆಯಾಗುತ್ತದೆ.",
}
LOANWORD = {
    "en-IN": "This feedback will help in your next session.",
    "hi-IN": "यह feedback आपके अगले session में काम आएगा।",
    "mr-IN": "हा feedback तुमच्या पुढच्या session मध्ये उपयोगी पडेल.",
    "ta-IN": "இந்த feedback உங்கள் அடுத்த session-ல் உதவும்.",
    "kn-IN": "ಈ feedback ನಿಮ್ಮ ಮುಂದಿನ session ನಲ್ಲಿ ಸಹಾಯ ಮಾಡುತ್ತದೆ.",
}
CODE_MIX = {
    "hi-IN": "आपने उसे reassure किया और सही time पर question पूछा।",
    "mr-IN": "तुम्ही तिला reassure केले आणि योग्य time ला question विचारला.",
    "ta-IN": "நீங்கள் அவரை reassure செய்து சரியான time-ல் question கேட்டீர்கள்.",
    "kn-IN": "ನೀವು ಅವರನ್ನು reassure ಮಾಡಿ ಸರಿಯಾದ time ನಲ್ಲಿ question ಕೇಳಿದಿರಿ.",
}
ENGLISH_QUOTE = "I am here to listen to you, take your time."

FAMILY = {
    "wrong_language": ("wrong_language", "untranslated_chunk"),
    "untranslated_chunk": ("wrong_language", "untranslated_chunk"),
}
GATED_FAULTS = ["wrong_language", "script_mix", "untranslated_chunk", "quote_altered"]
NOT_GATED = [
    "stiff_register",
    "literal_translation",
    "grammar_or_agreement",
    "meaning_drift",
]
NON_FAULTS = ["latin_name", "loanword", "english_quote", "code_mix"]

THRESH_TYPE, THRESH_LANG, MAX_FALSE_FLAG, MAX_FLIP, MIN_CELL = (
    0.80,
    0.75,
    0.10,
    0.10,
    10,
)

PRICES = {
    "gpt-5": (1.25, 10.0),
    "gpt-5-mini": (0.25, 2.0),
}  # USD per 1M tokens (in, out)


# ----------------------------------------------------------------------------
# Statistics
# ----------------------------------------------------------------------------
def wilson(k: int, n: int, z: float = 1.96) -> Tuple[Optional[float], Optional[float]]:
    if n <= 0:
        return None, None
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def fmt(k: int, n: int) -> str:
    if n == 0:
        return "n/a"
    lo, hi = wilson(k, n)
    return f"{k}/{n} = {k / n:.2f} [{lo:.2f}-{hi:.2f}]"


def kappa(a: List[bool], b: List[bool]) -> Optional[float]:
    n = len(a)
    if n == 0:
        return None
    po = sum(x == y for x, y in zip(a, b)) / n
    pa, pb = sum(a) / n, sum(b) / n
    pe = pa * pb + (1 - pa) * (1 - pb)
    return None if pe == 1 else (po - pe) / (1 - pe)


# ----------------------------------------------------------------------------
# Debrief text (a port of ally-be languageSections: only what the learner reads)
# ----------------------------------------------------------------------------
def sections_of(cards: Dict[str, Any]) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []

    def add(name: str, *parts: Optional[str]) -> None:
        text = "\n".join(p.strip() for p in parts if p and p.strip())
        if text:
            out.append({"section": name, "text": text})

    add("opening", cards.get("opening"))
    m = cards.get("important_moment")
    if m:
        add(
            "important_moment",
            m.get("lead"),
            f'"{m["quote"]}"' if m.get("quote") else None,
            m.get("body"),
            *[f'"{o["quote"]}" {o.get("note", "")}' for o in m.get("others") or []],
        )
    add(
        "what_worked",
        *[
            f'{c["lead"]} "{c["quote"]}" {c["body"]}'
            for c in cards.get("what_worked") or []
        ],
    )
    add(
        "work_on_this",
        *[
            f'{c["lead"]} "{c["quote"]}" {c["why"]} "{c["try_saying"]}"'
            for c in cards.get("work_on_this") or []
        ],
    )
    p = cards.get("practise_next")
    if p:
        add(
            "practise_next",
            f'{p["skill"]}. {p["reason"]}',
            *[f"- {t}" for t in p.get("try_next") or []],
        )
    add("skill_names", *[lg["label"] for lg in cards.get("skill_labels") or []])
    add("reflective_question", cards.get("reflective_question"))
    return out


def cited_turns(
    cards: Dict[str, Any], transcript: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    idx = set()
    m = cards.get("important_moment")
    if m:
        idx.add(m["turn_index"])
        idx.update(o["turn_index"] for o in m.get("others") or [])
    idx.update(c["turn_index"] for c in cards.get("what_worked") or [])
    idx.update(c["turn_index"] for c in cards.get("work_on_this") or [])
    return [t for t in transcript if t["turn_index"] in idx]


def norm(s: str) -> str:
    s = unicodedata.normalize("NFC", s or "").replace("‌", "").replace("‍", "")
    return re.sub(r"\s+", " ", s).strip()


# ----------------------------------------------------------------------------
# Fixture building: real Analyst + real Writer on synthetic sessions
# ----------------------------------------------------------------------------
class _Turn(BaseModel):
    role: str = Field(description="'counselor' (the trainee) or 'client'")
    text: str


class _Session(BaseModel):
    turns: List[_Turn]


def rule_checks(
    cards: Dict[str, Any], transcript: List[Dict[str, Any]], language: str
) -> List[str]:
    """The checks the system applies to every draft that can run without ally-be."""
    fails: List[str] = []
    by_idx = {t["turn_index"]: t for t in transcript}
    if not norm(cards.get("opening", "")):
        fails.append("structure: no opening")
    if not cards.get("work_on_this"):
        fails.append("structure: no work_on_this card")
    for c in cards.get("what_worked") or []:
        t = by_idx.get(c["turn_index"])
        if not t or norm(c["quote"]) not in norm(t["text"]):
            fails.append(f"quote_mismatch: what_worked turn {c['turn_index']}")
        elif t["role"] != "counselor":
            fails.append(f"wrong_speaker: what_worked turn {c['turn_index']}")
    for c in cards.get("work_on_this") or []:
        t = by_idx.get(c["turn_index"])
        if not t or norm(c["quote"]) not in norm(t["text"]):
            fails.append(f"quote_mismatch: work_on_this turn {c['turn_index']}")
        elif t["role"] != "counselor":
            fails.append(f"wrong_speaker: work_on_this turn {c['turn_index']}")
    m = cards.get("important_moment")
    if m:
        t = by_idx.get(m["turn_index"])
        if not t or norm(m["quote"]) not in norm(t["text"]):
            fails.append("quote_mismatch: important_moment")
    text = "\n".join(s["text"] for s in sections_of(cards))
    if re.search(r"\bturn\s*\d+\b", text, re.I):
        fails.append("turn_number")
    if re.search(r"\b\d+\s*/\s*10\b|\bscore\b", text, re.I):
        fails.append("score_mentioned")
    rng = SCRIPT_RANGE.get(language[:2])
    if rng:
        letters = [ch for ch in cards.get("opening", "") if ch.isalpha()]
        native = [ch for ch in letters if rng[0] <= ord(ch) <= rng[1]]
        if not letters or len(native) / len(letters) < 0.6:
            fails.append("wrong_language: opening is not mostly in the session script")
    return fails


async def build_fixtures(only: Optional[List[str]] = None) -> int:
    from app.core.debrief import steps
    from app.core.debrief.safety_reader import TranscriptTurn
    from app.core.llm.dispatch import PROVIDER_GEMINI, generate_structured

    FIXTURES.mkdir(parents=True, exist_ok=True)
    writer_model = "gemini-3-flash-preview"
    analyst_model = "gemini-2.5-flash"
    made = 0
    for lang in only or LANGS:
        label = CONFIG[lang]["language_label"]
        kept = 0
        attempt = 0
        while kept < PER_LANG and attempt < PER_LANG * 3:
            seed = SCENARIOS[attempt % len(SCENARIOS)]
            attempt += 1
            prompt = (
                f"Write a realistic practice conversation of exactly 12 turns, alternating, starting with "
                f"'counselor' (a trainee lay counsellor) then 'client'. Language: {label}, written entirely in that "
                "language and in its own script (never romanised, never mixed with another language), "
                "spoken everyday style. The counsellor listens, reflects feelings, asks open questions, and makes "
                "one or two ordinary mistakes (gives advice too early, or asks a closed question). "
                f"Client situation: {seed} Each turn is 1-3 short sentences. Synthetic: no real person."
            )
            try:
                sess, _ = await generate_structured(
                    schema=_Session,
                    prompt=prompt,
                    task="debrief_language_fixture",
                    provider=PROVIDER_GEMINI,
                    never_fallback=True,
                    model=analyst_model,
                    temperature=0,
                    max_tokens=None,
                )
                if not sess or len(sess.turns) < 8:
                    continue
                transcript = [
                    {
                        "turn_index": i + 1,
                        "role": (
                            "counselor"
                            if t.role.startswith("c") and t.role != "client"
                            else "client"
                        ),
                        "text": t.text,
                    }
                    for i, t in enumerate(sess.turns)
                ]
                turns = [TranscriptTurn(**t) for t in transcript]
                evidence, _ = await steps.analyse(
                    turns, lang, analyst_model, learner_level="LAY"
                )
                if evidence is None:
                    continue
                ev = evidence.model_dump()
                safety = {"risk_cues": [], "learner_distress": []}
                cards, _ = await steps.write(
                    ev, safety, lang, writer_model, turns, learner_level="LAY"
                )
                if cards is None:
                    continue
            except Exception as exc:  # a transient model failure: try the next attempt
                print(
                    f"  {lang} #{attempt}: model call failed ({type(exc).__name__}), retrying"
                )
                continue
            c = cards.model_dump(exclude={"reasoning", "progress_card"})
            fails = rule_checks(c, transcript, lang)
            print(
                f"  {lang} #{attempt}: {'kept' if not fails else 'rejected ' + '; '.join(fails)}"
            )
            if fails:
                continue
            kept += 1
            made += 1
            (FIXTURES / f"{lang}_{kept}.json").write_text(
                json.dumps(
                    {
                        "language": lang,
                        "writer_model": writer_model,
                        "scenario": seed,
                        "transcript": transcript,
                        "cards": c,
                        "rule_checks": "passed",
                    },
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n"
            )
        if kept < PER_LANG:
            print(f"!! only {kept} good debriefs for {lang}")
    print(f"built {made} fixtures in {FIXTURES}")
    return 0 if made >= PER_LANG * len(only or LANGS) else 1


# ----------------------------------------------------------------------------
# Planting
# ----------------------------------------------------------------------------
_SENT_SPLIT = re.compile(r"(?<=[।\.\?!])\s+")


def _replace_in(sections, section, old, new):
    for s in sections:
        if s["section"] == section and old in s["text"]:
            s["text"] = s["text"].replace(old, new, 1)
            return True
    return False


def _body_sentences(sections) -> List[Tuple[str, str]]:
    """(section, sentence) for sentences with no quote mark in them."""
    out = []
    for s in sections:
        if s["section"] in ("opening", "what_worked", "work_on_this"):
            for line in s["text"].split("\n"):
                for sent in _SENT_SPLIT.split(line):
                    if len(sent.split()) >= 5 and '"' not in sent and "“" not in sent:
                        out.append((s["section"], sent.strip()))
    return out


def _is_word(w: str) -> bool:
    """Letters and combining marks only: Indic words carry vowel signs, which `isalpha` rejects."""
    return all(unicodedata.category(ch)[0] in ("L", "M") for ch in w)


def plant(kind: str, lang: str, fx: Dict[str, Any], i: int) -> Optional[Dict[str, Any]]:
    """One case: {sections, quoted, span} or None when the fault does not apply."""
    cards = fx["cards"]
    sections = [dict(s) for s in sections_of(cards)]
    turns = [dict(t) for t in cited_turns(cards, fx["transcript"])]
    sents = _body_sentences(sections)
    base = lang == "en-IN"
    span: Optional[str] = None

    if kind == "wrong_language":
        if len(sents) < 2:
            return None
        sec, old = sents[min(len(sents) - 1, 1 + i % 2)]
        new = (HI_SENTENCES_FOR_EN if base else EN_SENTENCES)[i % 3]
        if not _replace_in(sections, sec, old, new):
            return None
        span = new
    elif kind == "script_mix":
        pool = [
            (sec, w)
            for sec, snt in sents
            for w in snt.split()
            if len(w) >= 6 and _is_word(w)
        ]
        if not pool:
            return None
        sec, w = pool[i % len(pool)]
        mid = len(w) // 2
        new = w[: mid - 1] + ("टे" if base else "er") + w[mid + 1 :]
        if not _replace_in(sections, sec, w, new):
            return None
        span = new
    elif kind == "untranslated_chunk":
        if base or not sents:
            return None
        sec, old = sents[min(len(sents) - 1, i % 3)]
        chunk = EN_CHUNKS[i % 3]
        stem = old.rstrip("।.?! ")
        new = f"{stem} {chunk}{old[len(stem):]}"
        if not _replace_in(sections, sec, old, new):
            return None
        span = chunk
    elif kind == "quote_altered":
        quotes = [
            (c["quote"], c["turn_index"])
            for c in (cards.get("what_worked") or [])
            + (cards.get("work_on_this") or [])
            if len(c["quote"].split()) >= 6
        ]
        if not quotes:
            return None
        q, _ = max(quotes, key=lambda x: len(x[0]))
        w = q.split()
        third = max(1, len(w) // 3)
        altered = " ".join(w[:third] + w[2 * third :])
        for s in sections:
            if q in s["text"]:
                s["text"] = s["text"].replace(q, altered, 1)
                span = altered
                break
        if span is None:
            return None
    elif kind == "latin_name":
        add = LATIN_NAME[lang]
        sections[0]["text"] += " " + add
        span = add
    elif kind == "loanword":
        add = LOANWORD[lang]
        sections[0]["text"] += " " + add
        span = add
    elif kind == "english_quote":
        if base or not cards.get("what_worked"):
            return None
        c0 = cards["what_worked"][0]
        old_q = c0["quote"]
        for t in turns:
            if t["turn_index"] == c0["turn_index"]:
                t["text"] = ENGLISH_QUOTE
        if not _replace_in(sections, "what_worked", old_q, ENGLISH_QUOTE):
            return None
        span = ENGLISH_QUOTE
    elif kind == "code_mix":
        if lang not in CODE_MIX:
            return None
        add = CODE_MIX[lang]
        sections[0]["text"] += " " + add
        span = add
    else:
        return None
    return {"sections": sections, "quoted": turns, "span": span, "kind": kind}


def overlaps(evidence: str, span: str) -> bool:
    e, s = norm(evidence), norm(span)
    if not e or not s:
        return False
    if e in s or s in e:
        return True
    et, st = set(e.split()), set(s.split())
    return bool(et) and len(et & st) / len(et) >= 0.6


# ----------------------------------------------------------------------------
# Running a judge
# ----------------------------------------------------------------------------
class Tally:
    def __init__(self) -> None:
        self.tokens_in = 0
        self.tokens_out = 0
        self.calls = 0


async def judge_once(
    model: str,
    provider: str,
    case: Dict[str, Any],
    lang: str,
    tally: Tally,
    sem: asyncio.Semaphore,
):
    from app.core.llm.capture import capture_calls

    async with sem:
        with capture_calls() as calls:
            res, _ = await judge_debrief_language(
                case["sections"],
                lang,
                params=LanguageEvalParams(**CONFIG[lang]),
                quoted_turns=case["quoted"],
                model=model,
                provider=provider,
            )
    for c in calls:
        tally.tokens_in += c.get("tokens_in") or 0
        tally.tokens_out += c.get("tokens_out") or 0
        tally.calls += 1
    return res


def provider_of(model: str) -> str:
    from app.core.llm.dispatch import PROVIDER_GEMINI, infer_provider_from_model

    return infer_provider_from_model(model) or PROVIDER_GEMINI


async def evaluate_model(
    model: str, fixtures: List[Dict[str, Any]], runs: int
) -> Dict[str, Any]:
    provider = provider_of(model)
    tally = Tally()
    sem = asyncio.Semaphore(24)
    cases: List[Dict[str, Any]] = []
    for fx in fixtures:
        lang = fx["language"]
        i = fx["_i"]
        for kind in GATED_FAULTS + NON_FAULTS:
            p = plant(kind, lang, fx, i)
            if p:
                cases.append({**p, "lang": lang, "fx": f"{lang}_{i}"})
    clean = [
        {
            "sections": sections_of(fx["cards"]),
            "quoted": cited_turns(fx["cards"], fx["transcript"]),
            "lang": fx["language"],
            "fx": f"{fx['language']}_{fx['_i']}",
            "kind": "clean",
            "span": "",
        }
        for fx in fixtures
    ]

    async def run_case(case):
        outs = await asyncio.gather(
            *[
                judge_once(model, provider, case, case["lang"], tally, sem)
                for _ in range(runs)
            ]
        )
        return case, outs

    results = await asyncio.gather(*[run_case(c) for c in cases + clean])
    rows = []
    for case, outs in results:
        answered = [o for o in outs if o is not None]
        per_run = []
        for o in answered:
            fs = o.findings
            hit_span = (
                [f for f in fs if overlaps(f.evidence_quote, case["span"])]
                if case["span"]
                else []
            )
            # "English left in a non-English debrief" is one fault at two sizes: a whole
            # sentence (wrong_language) or a clause inside a sentence (untranslated_chunk).
            # The planted clause may be read as either, so either type catches it;
            # exact-type rates are reported beside.
            ok = FAMILY.get(case["kind"], (case["kind"],))
            typed = [f for f in hit_span if f.error_type in ok]
            exact = [f for f in hit_span if f.error_type == case["kind"]]
            per_run.append(
                dict(
                    flagged=bool(hit_span),
                    caught=bool(typed),
                    exact=bool(exact),
                    any_finding=bool(fs),
                    types=sorted({f.error_type for f in fs}),
                    not_gated=sorted(
                        {f.error_type for f in fs if f.error_type in NOT_GATED}
                    ),
                )
            )
        rows.append(
            {"case": case, "per_run": per_run, "no_answer": len(outs) - len(answered)}
        )
    price = PRICES.get(model)
    cost = (
        (tally.tokens_in * price[0] + tally.tokens_out * price[1]) / 1e6
        if price
        else None
    )
    return {
        "model": model,
        "provider": provider,
        "rows": rows,
        "calls": tally.calls,
        "tokens_in": tally.tokens_in,
        "tokens_out": tally.tokens_out,
        "cost_usd": cost,
    }


def majority(values: List[bool]) -> Optional[bool]:
    if not values:
        return None
    return sum(values) * 2 > len(values)


def summarise(ev: Dict[str, Any]) -> Dict[str, Any]:
    by_type = defaultdict(lambda: [0, 0])
    by_type_exact = defaultdict(lambda: [0, 0])
    by_lang = defaultdict(lambda: [0, 0])
    by_cell = defaultdict(lambda: [0, 0])
    ff = [0, 0]
    ff_by_kind = defaultdict(lambda: [0, 0])
    flips = [0, 0]
    clean = [0, 0]
    not_gated_seen = defaultdict(int)
    clean_types = defaultdict(int)
    no_answer = 0
    vector: Dict[str, bool] = {}
    for r in ev["rows"]:
        c, runs = r["case"], r["per_run"]
        no_answer += r["no_answer"]
        if not runs:
            continue
        kind = c["kind"]
        if kind == "clean":
            clean[1] += 1
            clean[0] += int(bool(majority([x["any_finding"] for x in runs])))
            for x in runs:
                for t in x["not_gated"]:
                    not_gated_seen[t] += 1
                for t in x["types"]:
                    clean_types[t] += 1
            continue
        key = "caught" if kind in GATED_FAULTS else "flagged"
        outcomes = [x[key] for x in runs]
        m = bool(majority(outcomes))
        flips[1] += 1
        flips[0] += int(len(set(outcomes)) > 1)
        vector[f"{c['fx']}:{kind}"] = m
        if kind in GATED_FAULTS:
            by_type[kind][1] += 1
            by_type[kind][0] += int(m)
            by_type_exact[kind][1] += 1
            by_type_exact[kind][0] += int(bool(majority([x["exact"] for x in runs])))
            by_lang[c["lang"]][1] += 1
            by_lang[c["lang"]][0] += int(m)
            by_cell[(c["lang"], kind)][1] += 1
            by_cell[(c["lang"], kind)][0] += int(m)
        else:
            ff[1] += 1
            ff[0] += int(m)
            ff_by_kind[kind][1] += 1
            ff_by_kind[kind][0] += int(m)
    return dict(
        by_type=by_type,
        by_type_exact=by_type_exact,
        by_lang=by_lang,
        by_cell=by_cell,
        ff=ff,
        ff_by_kind=ff_by_kind,
        flips=flips,
        clean=clean,
        not_gated_seen=not_gated_seen,
        clean_types=clean_types,
        no_answer=no_answer,
        vector=vector,
    )


def verdict(s: Dict[str, Any]) -> List[str]:
    fails: List[str] = []
    for t in GATED_FAULTS:
        k, n = s["by_type"][t]
        if n < MIN_CELL:
            fails.append(
                f"underpowered: {t} has {n} cases (< {MIN_CELL}); a catch rate of {THRESH_TYPE} cannot be shown"
            )
        elif k / n < THRESH_TYPE:
            fails.append(f"{t} catch rate {k}/{n} = {k / n:.2f} < {THRESH_TYPE}")
    for lang in LANGS:
        k, n = s["by_lang"][lang]
        if n and k / n < THRESH_LANG:
            fails.append(f"{lang} catch rate {k}/{n} = {k / n:.2f} < {THRESH_LANG}")
    k, n = s["ff"]
    if n and k / n > MAX_FALSE_FLAG:
        fails.append(f"false-flag rate {k}/{n} = {k / n:.2f} > {MAX_FALSE_FLAG}")
    k, n = s["flips"]
    if n and k / n > MAX_FLIP:
        fails.append(f"flip rate {k}/{n} = {k / n:.2f} > {MAX_FLIP}")
    return fails


def report(ev: Dict[str, Any], s: Dict[str, Any]) -> None:
    print(f"\n=== judge {ev['model']} ({ev['provider']}) ===")
    print(
        f"calls {ev['calls']}, tokens in/out {ev['tokens_in']}/{ev['tokens_out']}, no usable answer {s['no_answer']}"
    )
    print(
        "catch rate by fault type (type match AND the judge's quote on the planted words), pooled over languages:"
    )
    for t in GATED_FAULTS:
        print(f"  {t:20s} {fmt(*s['by_type'][t])}")
    print(
        "  (exact type only: "
        + ", ".join(
            f"{t} {fmt(*s['by_type_exact'][t])}"
            for t in ("wrong_language", "untranslated_chunk")
        )
        + ")"
    )
    print("catch rate by language (gated types pooled):")
    for lang in LANGS:
        print(f"  {lang:8s} {fmt(*s['by_lang'][lang])}")
    print("cells (language x type; thin, shown with intervals, not gated):")
    for lang in LANGS:
        print(
            "  "
            + lang
            + ": "
            + "  ".join(
                f"{t}={s['by_cell'][(lang, t)][0]}/{s['by_cell'][(lang, t)][1]}"
                for t in GATED_FAULTS
                if s["by_cell"][(lang, t)][1]
            )
        )
    print(f"false-flag rate on look-alike non-faults: {fmt(*s['ff'])}")
    for kd in NON_FAULTS:
        if s["ff_by_kind"][kd][1]:
            print(f"    {kd:14s} {fmt(*s['ff_by_kind'][kd])}")
    print(f"flip rate (cases whose {RUNS} answers disagree): {fmt(*s['flips'])}")
    print(
        f"clean good debriefs with any finding (could be a real Writer fault, informational): {fmt(*s['clean'])}"
    )
    print(
        "findings on the clean debriefs by type (judge runs; real Writer faults or false flags, informational): "
        f"{dict(s['clean_types']) or 'none'}"
    )
    print(
        "NOT GATED (no checked planting): "
        + ", ".join(NOT_GATED)
        + f"; seen on clean debriefs (judge runs): {dict(s['not_gated_seen']) or 'none'}"
    )


def agreement(a: Dict[str, bool], b: Dict[str, bool]) -> Tuple[Optional[float], int]:
    keys = sorted(set(a) & set(b))
    return kappa([a[k] for k in keys], [b[k] for k in keys]), len(keys)


def recall(s: Dict[str, Any]) -> Tuple[int, int]:
    k = sum(v[0] for v in s["by_type"].values())
    n = sum(v[1] for v in s["by_type"].values())
    return k, n


def not_measurably_worse(
    cheap: Tuple[int, int], dear: Tuple[int, int]
) -> Tuple[bool, float]:
    (k1, n1), (k2, n2) = cheap, dear
    p1, p2 = k1 / n1, k2 / n2
    se = math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2) or 1e-9
    z = (p1 - p2) / se
    return z >= -1.96, z


# ----------------------------------------------------------------------------
def load_fixtures() -> List[Dict[str, Any]]:
    out = []
    for lang in LANGS:
        for i in range(1, PER_LANG + 1):
            f = FIXTURES / f"{lang}_{i}.json"
            if f.exists():
                fx = json.loads(f.read_text())
                fx["_i"] = i
                out.append(fx)
    return out


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build-fixtures", action="store_true")
    ap.add_argument("--models", default=settings.DEBRIEF_LANGUAGE_JUDGE.MODEL)
    ap.add_argument("--langs", default=None, help="with --build-fixtures: only these")
    ap.add_argument("--runs", type=int, default=RUNS)
    ap.add_argument("--out", default=None, help="write the full results as JSON")
    args = ap.parse_args()
    if args.build_fixtures:
        return await build_fixtures(args.langs.split(",") if args.langs else None)
    fixtures = load_fixtures()
    per = defaultdict(int)
    for fx in fixtures:
        per[fx["language"]] += 1
    short = [lg for lg in LANGS if per[lg] < 3]
    if short:
        print(f"fixtures missing for {short}: run --build-fixtures first")
        return 1
    # "gpt-5:1" runs that model once per case (a reference judge needs no flip rate).
    spec = [m.strip() for m in args.models.split(",") if m.strip()]
    models = [m.split(":")[0] for m in spec]
    runs_for = {
        m.split(":")[0]: int(m.split(":")[1]) if ":" in m else args.runs for m in spec
    }
    primary = settings.DEBRIEF_LANGUAGE_JUDGE.MODEL
    writer = fixtures[0]["writer_model"]
    print(
        f"judge model (configured): {primary} [{provider_of(primary)}]; Writer: {writer} [{provider_of(writer)}]; "
        f"different family from the Writer: {provider_of(primary) != provider_of(writer)}"
    )
    evals = {}
    for m in models:
        evals[m] = await evaluate_model(m, fixtures, runs_for[m])
    sums = {m: summarise(e) for m, e in evals.items()}
    for m in models:
        report(evals[m], sums[m])
    if len(models) >= 2:
        a, b = models[0], models[1]
        kp, n = agreement(sums[a]["vector"], sums[b]["vector"])
        print(
            f"\n=== {a} vs {b}: kappa on 'flagged the planted span' = {kp if kp is None else round(kp, 3)} over {n} cases"
        )
        ra, rb = recall(sums[a]), recall(sums[b])
        ok, z = not_measurably_worse(ra, rb)
        print(f"recall {a} {fmt(*ra)} vs {b} {fmt(*rb)}; z = {z:.2f}")
        for m in (a, b):
            e = evals[m]
            if e["cost_usd"] is not None:
                print(
                    f"cost {m}: ${e['cost_usd']:.4f} for {len(fixtures)} debriefs x {runs_for[m]} runs x "
                    f"{len(e['rows']) // len(fixtures)} cases = about ${e['cost_usd'] / max(1, e['calls']):.5f} per judge call"
                )
        print(
            f"{a} is {'not measurably worse than' if ok else 'MEASURABLY WORSE than'} {b} on recall"
        )
    if args.out:
        Path(args.out).write_text(
            json.dumps(
                {
                    m: {
                        "summary": {
                            k: (
                                v
                                if not isinstance(v, defaultdict)
                                else {str(kk): vv for kk, vv in v.items()}
                            )
                            for k, v in sums[m].items()
                        },
                        "model": m,
                        "cost_usd": evals[m]["cost_usd"],
                        "cases": [
                            {
                                "fx": r["case"]["fx"],
                                "kind": r["case"]["kind"],
                                "span": r["case"]["span"][:60],
                                "runs": r["per_run"],
                            }
                            for r in evals[m]["rows"]
                        ],
                        "calls": evals[m]["calls"],
                    }
                    for m in models
                },
                default=str,
                indent=1,
                ensure_ascii=False,
            )
        )
    fails = (
        verdict(sums[primary])
        if primary in sums
        else ["the configured judge model was not among --models"]
    )
    print("\nGATE (" + primary + "): " + ("PASS" if not fails else "FAIL"))
    for f in fails:
        print("  - " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
