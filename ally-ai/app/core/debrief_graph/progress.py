"""Learner progress in the debrief (PROGRESS_CONTRACT §2): what the progress
agent is sent, and what the run does with its vetoed report.

- the Writer still reads `progress` in the old `ProgressReading` shape, derived
  here from the vetoed report, so its prompt is unchanged;
- `cards.progress_card` is attached in code at finish, after the Writer and
  Reviser loop, when the card is due and there is something to show;
- `response.progress` carries the post-veto report for ally-be to store.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.core.debrief_graph.progress_vetoes import (
    FOUNDATIONAL_SKILLS,
    OTHER,
    countable,
    skill_key,
    this_session_observations,
)


def profile_of(inputs: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The request's progress profile when it has any history, else None."""
    profile = (inputs or {}).get("progress_profile")
    if not isinstance(profile, dict) or not profile.get("sessions"):
        return None
    return profile


def past_points(profile: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [p for p in profile.get("past_points") or [] if isinstance(p, dict)]


def history_text(profile: Dict[str, Any], fallback: List[Dict[str, Any]]) -> str:
    """The Evaluator's `history`: the learner's past points, one per line."""
    points = past_points(profile) or fallback
    return "\n".join(
        f"{p.get('date')} · {p.get('skill')}: {p.get('point')}" for p in points
    )


def agent_input(profile: Dict[str, Any], evidence: Dict[str, Any]) -> Dict[str, Any]:
    """This session's observations per foundational skill (the newest evidence),
    beside each skill's countable history, so the agent reads one table."""
    this = this_session_observations(evidence, profile.get("analyst_version"))
    keys = sorted(
        (set(profile.get("skills") or {}) | set(this)) - {OTHER},
        key=lambda k: (
            list(FOUNDATIONAL_SKILLS).index(k) if k in FOUNDATIONAL_SKILLS else 99
        ),
    )
    return {
        k: {
            "name": FOUNDATIONAL_SKILLS.get(k, k),
            "this_session": this.get(k),
            "counted_sessions": len(
                {str(o.get("run_id")) for o in countable(profile, this, k)}
            ),
        }
        for k in keys
        if k in FOUNDATIONAL_SKILLS
    }


# --- the Writer's legacy reading ----------------------------------------------------


def writer_reading(
    report: Dict[str, Any], profile: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """The vetoed report as the Writer's `ProgressReading`
    (`items: [{skill, trend, evidence, follows_up_point}]`), or None when it
    has nothing for the Writer."""
    by_point = {
        str(p.get("point")): skill_key(p.get("skill")) for p in past_points(profile)
    }
    answered: Dict[str, str] = {}
    for f in report.get("followups") or []:
        if f.get("status") in ("done", "partly"):
            key = by_point.get(str(f.get("point")))
            if key and key not in answered:
                answered[key] = str(f.get("point"))
    items = []
    for s in report.get("skills") or []:
        key = s.get("skill")
        trend = s.get("trend")
        hidden = bool(s.get("hidden_from_learner"))
        if trend == "worth_another_look" and hidden:
            trend = "about_the_same"
        items.append(
            {
                "skill": FOUNDATIONAL_SKILLS.get(key, key),
                "trend": trend,
                # The learner never reads a held-back or hidden trend's reason.
                "evidence": (
                    "" if trend == "too_early" or hidden else str(s.get("why") or "")
                ),
                "follows_up_point": answered.get(key),
            }
        )
    if not items:
        return None
    return {"items": items}


# --- the learner's card and the response ------------------------------------------


def progress_card(
    report: Dict[str, Any], profile: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """`cards.progress_card`, or None when the card is not due or has nothing
    to say. Skills with a blank line (held back, too early, hidden) are left out."""
    if report.get("shown_as") != "card":
        return None
    skills = [
        {"skill": s["skill"], "trend": s["trend"], "line": s["learner_line"].strip()}
        for s in report.get("skills") or []
        if str(s.get("learner_line") or "").strip()
    ]
    focus = report.get("focus") or None
    focus_card = (
        {"skill": focus.get("skill"), "line": focus["learner_line"].strip()}
        if focus and str(focus.get("learner_line") or "").strip()
        else None
    )
    if not skills and not focus_card:
        return None
    return {
        "sessions": len(profile.get("sessions") or []) + 1,
        "skills": skills,
        "focus": focus_card,
    }


def analyst_versions(profile: Dict[str, Any]) -> List[int]:
    found = {
        s.get("analyst_version")
        for s in profile.get("sessions") or []
        if isinstance(s, dict)
    }
    for obs in (profile.get("skills") or {}).values():
        found |= {o.get("analyst_version") for o in obs or []}
    if profile.get("analyst_version") is not None:
        found.add(profile["analyst_version"])
    return sorted(v for v in found if isinstance(v, int))


def response_record(
    report: Dict[str, Any],
    vetoes: List[Dict[str, Any]],
    profile: Dict[str, Any],
    model: Optional[str],
) -> Dict[str, Any]:
    """`response.progress` (PROGRESS_CONTRACT §2)."""
    return {
        "report": report,
        "vetoes": vetoes,
        "shown_as": report.get("shown_as") or "line",
        "model": model,
        "window_session_ids": [
            s.get("session_id")
            for s in profile.get("sessions") or []
            if isinstance(s, dict) and s.get("session_id")
        ],
        "analyst_versions": analyst_versions(profile),
    }
