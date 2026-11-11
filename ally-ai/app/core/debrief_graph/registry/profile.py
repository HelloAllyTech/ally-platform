"""The session profile (spec A5): cheap facts computed in code, no model. The
planner decides from this, the safety reading's flagged turns and a summary of
the Analyst's evidence map (decided 2026-11-11), never from the transcript.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List

from app.core.debrief_graph import inputs as body
from app.core.debrief_graph.budget import budget_left
from app.core.debrief_graph.context import DebriefRunContext as Ctx

#: ISO 639-1 codes of the Indian languages Ally runs sessions in.
INDIC = {"hi", "mr", "ta", "kn", "te", "bn", "gu", "pa", "ml", "or", "as", "ur"}

#: Unicode blocks by script (the scripts learners write in).
_SCRIPTS = [
    ("devanagari", 0x0900, 0x097F),
    ("bengali", 0x0980, 0x09FF),
    ("gurmukhi", 0x0A00, 0x0A7F),
    ("gujarati", 0x0A80, 0x0AFF),
    ("odia", 0x0B00, 0x0B7F),
    ("tamil", 0x0B80, 0x0BFF),
    ("telugu", 0x0C00, 0x0C7F),
    ("kannada", 0x0C80, 0x0CFF),
    ("malayalam", 0x0D00, 0x0D7F),
    ("arabic", 0x0600, 0x06FF),
]
#: A script counts as used when it is at least this share of the letters.
_SCRIPT_SHARE = 0.1


def _script(ch: str) -> str | None:
    o = ord(ch)
    if ch.isascii():
        return "latin" if ch.isalpha() else None
    for name, lo, hi in _SCRIPTS:
        if lo <= o <= hi:
            return name
    return "other" if ch.isalpha() else None


def scripts_used(texts: List[str]) -> Dict[str, float]:
    """Each script's share of the letters written, for scripts above 10%."""
    counts: Dict[str, int] = {}
    for text in texts:
        for ch in text or "":
            s = _script(ch)
            if s:
                counts[s] = counts.get(s, 0) + 1
    total = sum(counts.values()) or 1
    return {
        s: round(c / total, 2)
        for s, c in sorted(counts.items(), key=lambda kv: -kv[1])
        if c / total >= _SCRIPT_SHARE
    }


def language_facts(ctx: Ctx) -> Dict[str, Any]:
    lang = (ctx.language or "en").split("-")[0].lower()
    learner = [
        t.get("text") or "" for t in ctx.transcript if t.get("role") == "counselor"
    ]
    scripts = scripts_used(learner)
    indic = lang in INDIC
    native = [s for s in scripts if s != "latin"]
    return {
        "language": ctx.language,
        "indic": indic,
        "scripts": scripts,
        # Two scripts in the learner's own words, e.g. Hindi in Devanagari and English.
        "code_mixed": len(scripts) > 1,
        # The learner wrote in a script other than the debrief language's:
        # romanised Hindi in a Hindi session, or Tamil script in an English one.
        "script_mismatch": bool(
            (indic and scripts and not native) or (not indic and native)
        ),
    }


def transcript_gaps(ctx: Ctx) -> int:
    """Empty turns and holes in the turn numbering: where the record is thin."""
    idx = sorted(
        t.get("turn_index")
        for t in ctx.transcript
        if isinstance(t.get("turn_index"), int)
    )
    holes = sum(max(0, b - a - 1) for a, b in zip(idx, idx[1:]))
    empty = sum(1 for t in ctx.transcript if not (t.get("text") or "").strip())
    return holes + empty


def build_profile(state: Dict[str, Any], ctx: Ctx) -> Dict[str, Any]:
    safety = state.get("safety") or {}
    availability = ctx.inputs.get("availability") or {}
    past = body.past_points(ctx)
    past_sessions = availability.get("past_debriefs")
    if not isinstance(past_sessions, int):
        past_sessions = len({p.get("date") for p in past})
    return {
        "session_type": state["recipe_key"],
        "learner_turns": ctx.sess("learner_turns") or 0,
        "turns": len(ctx.transcript),
        **language_facts(ctx),
        "risk_cues": len(safety.get("risk_cues") or []),
        "risk_cue_turns": sorted(
            {c.get("turn_index") for c in safety.get("risk_cues") or []} - {None}
        ),
        "learner_distress": bool(safety.get("learner_distress")),
        "past_debriefs": past_sessions,
        "past_work_on_this_points": len(past),
        "has_learner": bool(ctx.sess("counselor_id")),
        "case_memory": bool(ctx.inputs.get("case_memory")),
        "assessment": bool(ctx.sess("assessment")),
        "org_protocols": int(availability.get("org_protocols") or 0),
        "live_detections": len(ctx.inputs.get("live_detections") or []),
        "cohort_data": bool(ctx.inputs.get("cohort"))
        or bool(availability.get("cohort")),
        "course": bool(availability.get("course")),
        "transcript_gaps": transcript_gaps(ctx),
        "budget_left_usd": budget_left(ctx.ceiling_usd, state.get("estimated", 0.0)),
        "time_left_ms": max(0, round(ctx.time_left_ms(bool(safety.get("risk_cues"))))),
    }


#: The most of each list the planner reads: enough to plan from, small enough
#: that the planner stays fast.
_SUMMARY_MOMENTS = 6
_SUMMARY_SKILLS = 12
_SUMMARY_FAULTS = 5
_SUMMARY_CHARS = 200
#: Anything between quotation marks: the summary is the Analyst's own words,
#: never the transcript's.
_QUOTED = re.compile(r"[\"“”„«»][^\"“”„«»]{0,400}[\"“”„«»]|‘[^‘’]{0,400}’")


def _own_words(text: Any) -> str:
    return _QUOTED.sub("…", str(text or "")).strip()[:_SUMMARY_CHARS]


def evidence_summary(evidence: Dict[str, Any]) -> Dict[str, Any]:
    """What the planner reads of the Analyst's evidence map (decided
    2026-11-11): the pivotal moments (summary and turn), the skills observed,
    partial and missed, and the AI client's faults — the Analyst's words, with
    no quote, no note on a skill, and nothing of the transcript."""
    evidence = evidence or {}
    moments = [
        {"turn": m.get("turn_index"), "summary": _own_words(m.get("summary"))}
        for m in evidence.get("pivotal_moments") or []
        if isinstance(m, dict) and m.get("summary")
    ][:_SUMMARY_MOMENTS]
    skills: Dict[str, List[str]] = {"observed": [], "partial": [], "missed": []}
    for b in evidence.get("behaviours") or []:
        if not isinstance(b, dict) or b.get("opportunity") is False:
            continue
        bucket = skills.get(str(b.get("observation") or ""))
        name = _own_words(b.get("skill"))[:60]
        if bucket is not None and name and len(bucket) < _SUMMARY_SKILLS:
            bucket.append(name)
    faults = [
        {"turn": f.get("turn_index"), "note": _own_words(f.get("note"))}
        for f in evidence.get("ai_faults") or []
        if isinstance(f, dict) and f.get("note")
    ][:_SUMMARY_FAULTS]
    return {"pivotal_moments": moments, "skills": skills, "ai_client_faults": faults}
