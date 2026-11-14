"""One-line summaries the Console's run view shows for each step.

Ported word for word from ally-be's runner (`evidenceSummary`, `cardsSummary`,
`safetyNarration`, `revisionWhy` and the inline summaries).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from app.core.debrief_graph.drafts import compute_overall, fmt1, js_num


def n(count: int, one: str, many: Optional[str] = None) -> str:
    """ "1 thing" / "3 things": counts read as words in the run view."""
    return f"{count} {one if count == 1 else (many or one + 's')}"


def _spaced(value: Any) -> str:
    return str(value).replace("_", " ")


def evidence_summary(evidence: Dict[str, Any]) -> str:
    """The Analyst's evidence map, in one line."""
    raw = (evidence or {}).get("behaviours")
    b: List[Dict[str, Any]] = raw if isinstance(raw, list) else []

    def seen(o: str) -> int:
        return len(
            [
                x
                for x in b
                if (x or {}).get("opportunity") is not False
                and (x or {}).get("observation") == o
            ]
        )

    pm = (evidence or {}).get("pivotal_moments")
    moments = len(pm) if isinstance(pm, list) else 0
    return (
        f"{n(len(b), 'skill')} read: {seen('observed')} observed, "
        f"{seen('partial')} partial, {seen('missed')} missed; "
        f"{n(moments, 'pivotal moment')}"
    )


def cards_summary(cards: Optional[Dict[str, Any]]) -> str:
    """A draft's cards, in one line."""
    cards = cards or {}
    worked = len(cards.get("what_worked") or [])
    work = len(cards.get("work_on_this") or [])
    parts = [
        (
            "an important moment"
            if cards.get("important_moment")
            else "no important moment"
        ),
        n(worked, "strength"),
        n(work, "point to work on", "points to work on"),
        "Practise next" if cards.get("practise_next") else None,
    ]
    return ", ".join(p for p in parts if p)


def safety_narration(safety: Dict[str, Any]) -> str:
    """What code found in the Safety reader's reading (its model is pinned and
    gives no rationale)."""
    cues = safety.get("risk_cues") or []
    distress = safety.get("learner_distress") or []
    if not cues and not distress:
        return "No client risk cues and no sign of the learner’s own distress."
    parts: List[str] = []
    if cues:
        listed = ", ".join(
            f"turn {c.get('turn_index')} ({_spaced(c.get('category'))}; "
            f"learner {_spaced(c.get('learner_response'))})"
            for c in cues
        )
        parts.append(
            f"{n(len(cues), 'client risk cue')}: {listed}. "
            "The debrief must cover every one."
        )
    if distress:
        turns = ", ".join(str(d.get("turn_index")) for d in distress)
        parts.append(
            f"The learner’s own distress at turn {turns}: "
            "the debrief opens with support first."
        )
    return " ".join(parts)


def safety_summary(res: Dict[str, Any]) -> str:
    return (
        f"{n(len(res.get('risk_cues') or []), 'risk cue')}, "
        f"{n(len(res.get('learner_distress') or []), 'sign', 'signs')} "
        "of the learner’s own distress"
    )


def progress_summary(res: Dict[str, Any]) -> str:
    items = ((res.get("progress") or {}).get("items")) or []
    if not items:
        return "nothing to follow up this time"
    return "; ".join(
        f"{i.get('skill')}: {_spaced(i.get('trend') or '')}" for i in items
    )


def evaluator_summary(res: Dict[str, Any]) -> str:
    ev = res["evaluation"]
    overall = compute_overall(
        {d["dimension"]: d["score"] for d in ev["dimensions"]},
        len(ev["hard_fails"]),
    )
    return "; ".join(
        [
            f"{fmt1(overall)} overall" if overall is not None else "no overall score",
            (
                "hard fails: " + ", ".join(h["code"] for h in ev["hard_fails"])
                if ev["hard_fails"]
                else "no hard fail"
            ),
            n(len(ev.get("fixes") or []), "fix note"),
        ]
    )


def revision_why(best: Dict[str, Any], pass_score: float, advisory: set) -> str:
    """Why the Reviser ran: what kept the best draft below the bar."""
    blocking = [c for c in best["checks"] if c["code"] not in advisory]
    ev = best.get("evaluation")
    reasons = [
        ("it failed " + ", ".join(c["code"] for c in blocking) if blocking else None),
        (
            "the Evaluator found " + ", ".join(h["code"] for h in ev["hardFails"])
            if ev and ev["hardFails"]
            else None
        ),
        (
            f"it scored {fmt1(ev['overall'])} (the bar is {js_num(pass_score)})"
            if ev and ev["overall"] is not None and ev["overall"] < pass_score
            else None
        ),
        "it could not be scored" if not ev else None,
    ]
    said = ", and ".join(r for r in reasons if r) or "it is below the bar"
    return f"Revising round {best['round']} because {said}."
