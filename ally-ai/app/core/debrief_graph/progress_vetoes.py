"""The progress agent's safety net: AI judges, code vetoes (PROGRESS_CONTRACT §2).

Pure functions, run straight after the progress agent and before the Writer.
A veto never invents a trend: it turns the agent's claim into `too_early`,
blanks the learner line and records why. "Worth another look" is kept for
staff but hidden from the learner unless the organisation allows it (not a
veto).

The evidence is the Analyst's: every past observation in
`progress_profile.skills` plus this session's evidence map. An observation an
advisor corrected or rejected never counts, and `other` is never trended.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, Iterable, List, Optional, Tuple

#: The 14 foundational helping skills: key → name, as ally-be's
#: `helping-skills-rubric.constants.ts` has them and the Analyst names them.
FOUNDATIONAL_SKILLS: Dict[str, str] = {
    "verbal": "Verbal communication",
    "confidentiality": "Explain and promote confidentiality",
    "rapport": "Rapport-building and self-disclosure",
    "feelings": "Exploration and normalisation of feelings",
    "empathy": "Empathy, warmth and genuineness",
    "harm": "Assessment of harm and developing a response plan",
    "functioning": "Connect to social functioning and impact on life",
    "explanation": "Explore the client's explanation for the problem",
    "family": "Involvement of family and significant others",
    "goals": "Collaborative goal-setting",
    "hope": "Promote realistic hope for change",
    "coping": "Incorporate coping mechanisms and prior solutions",
    "psychoeducation": "Psychoeducation with local terminology",
    "feedback": "Elicitation of feedback",
}

OTHER = "other"
THIS_RUN = "this"
MIN_SESSIONS = 3
SCORE = {"observed": 2, "partial": 1, "missed": 0}


def _norm(text: str) -> str:
    return " ".join(str(text or "").lower().replace("’", "'").replace("_", " ").split())


_BY_NAME = {_norm(name): key for key, name in FOUNDATIONAL_SKILLS.items()}


def skill_key(name: Optional[str]) -> str:
    """A skill key or the Analyst's name for it → its key; anything else → other."""
    norm = _norm(name or "")
    if norm in FOUNDATIONAL_SKILLS:
        return norm
    return _BY_NAME.get(norm, OTHER)


# --- the observations ------------------------------------------------------------


def this_session_observations(
    evidence: Dict[str, Any], analyst_version: Optional[int] = None
) -> Dict[str, Dict[str, Any]]:
    """This session's evidence map, one observation per foundational skill (the
    most important behaviour the Analyst gave it), in the profile's shape."""
    out: Dict[str, Dict[str, Any]] = {}
    ranked = sorted(
        (b for b in (evidence or {}).get("behaviours") or [] if isinstance(b, dict)),
        key=lambda b: -(b.get("importance") or 0),
    )
    for b in ranked:
        key = skill_key(b.get("skill"))
        if key == OTHER or key in out:
            continue
        out[key] = {
            "run_id": THIS_RUN,
            "date": None,
            "opportunity": b.get("opportunity") is not False,
            "observation": b.get("observation"),
            "confidence": b.get("confidence"),
            "turn_index": b.get("turn_index"),
            "analyst_version": analyst_version,
            "corrected": False,
        }
    return out


def _sort_key(o: Dict[str, Any]) -> Tuple[int, str]:
    # This session is always the newest.
    return (1, "") if o.get("run_id") == THIS_RUN else (0, str(o.get("date") or ""))


def countable(
    profile: Dict[str, Any], this: Dict[str, Dict[str, Any]], key: str
) -> List[Dict[str, Any]]:
    """The skill's observations that count as evidence, oldest first: an
    opportunity, an observation, and not corrected by an advisor."""
    obs = list(((profile.get("skills") or {}).get(key)) or [])
    if key in this:
        obs.append(this[key])
    keep = [
        o
        for o in obs
        if o.get("opportunity")
        and not o.get("corrected")
        and o.get("observation") in SCORE
    ]
    return sorted(keep, key=_sort_key)


def _halves(obs: List[Dict[str, Any]]) -> Optional[Tuple[float, float]]:
    """Mean score of the earlier and the later half (a middle one sits out)."""
    half = len(obs) // 2
    if half == 0:
        return None
    early = [SCORE[o["observation"]] for o in obs[:half]]
    late = [SCORE[o["observation"]] for o in obs[-half:]]
    return sum(early) / half, sum(late) / half


def direction(obs: List[Dict[str, Any]]) -> Optional[int]:
    """+1 rising, 0 flat, -1 falling; None with fewer than two observations."""
    h = _halves(obs)
    if h is None:
        return None
    return (h[1] > h[0]) - (h[1] < h[0])


def _holds(trend: str, obs: List[Dict[str, Any]]) -> bool:
    d = direction(obs)
    if d is None:
        return False
    if trend == "more_consistent":
        return d > 0 or (d == 0 and all(o["observation"] == "observed" for o in obs))
    if trend == "worth_another_look":
        return d < 0
    return d == 0  # about_the_same


def _fhs_fell(fhs: Optional[Dict[str, Any]], key: str) -> Optional[Tuple[int, int]]:
    levels = [
        x
        for x in ((fhs or {}).get(key) or [])
        if isinstance(x, dict) and isinstance(x.get("level"), (int, float))
    ]
    if len(levels) < 2:
        return None
    levels.sort(key=lambda x: str(x.get("date") or ""))
    first, last = levels[0]["level"], levels[-1]["level"]
    return (int(first), int(last)) if first - last >= 1 else None


def _cited_corrected(
    profile: Dict[str, Any], key: str, refs: Iterable[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """The first cited observation an advisor corrected, for this skill or any
    other (a corrected point is never evidence, whichever skill cites it)."""
    corrected = [
        o
        for obs in (profile.get("skills") or {}).values()
        for o in obs or []
        if o.get("corrected")
    ]
    own = [o for o in corrected if o in ((profile.get("skills") or {}).get(key) or [])]
    for ref in refs or []:
        for o in own + corrected:
            if str(o.get("run_id")) != str(ref.get("run_id")):
                continue
            t = ref.get("turn_index")
            if t is None or o.get("turn_index") is None or o["turn_index"] == t:
                return o
    return None


# --- the vetoes --------------------------------------------------------------------


def skill_vetoes(
    item: Dict[str, Any],
    profile: Dict[str, Any],
    this: Dict[str, Dict[str, Any]],
) -> List[Dict[str, str]]:
    """Every veto that fires on one proposed skill trend (none for too_early)."""
    trend = item.get("trend")
    if trend == "too_early":
        return []
    raw = str(item.get("skill") or "")
    key = skill_key(raw)
    out: List[Dict[str, str]] = []

    def veto(code: str, detail: str) -> None:
        out.append(
            {
                "skill": key if key != OTHER else raw,
                "veto": code,
                "detail": f"Proposed {trend}: {detail}",
            }
        )

    if key == OTHER:
        veto("other_skill", "not one of the foundational skills, so never trended.")
        return out
    obs = countable(profile, this, key)
    sessions = {str(o.get("run_id")) for o in obs}
    if len(sessions) < MIN_SESSIONS:
        veto(
            "too_few_sessions",
            f"{len(sessions)} session(s) with an opportunity for this skill, "
            f"fewer than {MIN_SESSIONS}.",
        )
    h = _halves(obs)
    if h is not None:
        early, late = h
        if trend == "more_consistent" and late < early:
            veto(
                "contradicted_by_analyst",
                f"the later observations score lower ({late:.1f}) than the "
                f"earlier ones ({early:.1f}).",
            )
        if trend == "worth_another_look" and late > early:
            veto(
                "contradicted_by_analyst",
                f"the later observations score higher ({late:.1f}) than the "
                f"earlier ones ({early:.1f}).",
            )
    settings = profile.get("settings") or {}
    if trend == "more_consistent" and settings.get("useFhs", True):
        fell = _fhs_fell(profile.get("fhs"), key)
        if fell:
            veto(
                "contradicted_by_fhs",
                f"the Foundational Skills level fell from {fell[0]} to {fell[1]}.",
            )
    versions = sorted(
        {o["analyst_version"] for o in obs if o.get("analyst_version") is not None}
    )
    if len(versions) > 1:
        latest = versions[-1]
        # This session runs on the newest Analyst prompt.
        within = [
            o
            for o in obs
            if o.get("analyst_version") == latest
            or (o.get("run_id") == THIS_RUN and o.get("analyst_version") is None)
        ]
        if not _holds(trend, within):
            veto(
                "version_straddle",
                f"the evidence spans Analyst versions {versions} and the trend "
                f"does not hold within version {latest} alone.",
            )
    bad = _cited_corrected(profile, key, item.get("evidence") or [])
    if bad is not None:
        veto(
            "corrected_evidence",
            f"cites run {bad.get('run_id')}, whose point an advisor corrected.",
        )
    return out


def apply_vetoes(
    report: Dict[str, Any],
    profile: Dict[str, Any],
    evidence: Dict[str, Any],
) -> Tuple[Dict[str, Any], List[Dict[str, str]]]:
    """The report after the vetoes, and the vetoes that fired.

    Each skill gains `hidden_from_learner`; `shown_as` is `card` only when the
    profile says the card is due; at most 3 skills are kept."""
    out = copy.deepcopy(report or {})
    this = this_session_observations(evidence, profile.get("analyst_version"))
    show_worse = bool((profile.get("settings") or {}).get("showWorseToLearners"))
    vetoes: List[Dict[str, str]] = []
    skills = []
    for item in (out.get("skills") or [])[:3]:
        fired = skill_vetoes(item, profile, this)
        key = skill_key(item.get("skill"))
        if key != OTHER:
            item["skill"] = key
        if fired:
            vetoes.extend(fired)
            item["trend"] = "too_early"
            item["learner_line"] = ""
        if item.get("trend") == "too_early":
            item["learner_line"] = ""
        hidden = item.get("trend") == "worth_another_look" and not show_worse
        if hidden:
            item["learner_line"] = ""
        item["hidden_from_learner"] = hidden
        skills.append(item)
    out["skills"] = skills
    focus = out.get("focus")
    if isinstance(focus, dict):
        key = skill_key(focus.get("skill"))
        if key != OTHER:
            focus["skill"] = key
    out["shown_as"] = "card" if profile.get("card_due") else "line"
    return out, vetoes
