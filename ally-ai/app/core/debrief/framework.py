"""The roleplay's skill framework, risk cue handling and speaker labels.

ally-be sends these on the run's ``session`` (all optional); an absent value
means today's behaviour exactly, so every helper here defaults to it:

- ``session.framework``: ``{id, name, foundational, skills: [{key, name,
  words}], areas: [{name, description}]}``. Absent = the 14 foundational
  helping skills with the three coverage areas. Present with no skills =
  "None": the Analyst assesses only the roleplay's own behaviours and
  competencies, and there are no coverage areas.
- ``session.risk_cue``: ``{key, name, handling: "alarm"|"assessed",
  word_list_raises}``. Absent = alarm, with the word list raising cues.
- ``session.speaker_labels``: ``"legacy"`` (COUNSELLOR / CLIENT, the judge's
  AI_CLIENT) or ``"neutral"`` (LEARNER / CHARACTER). Internal role values
  (``counselor`` / ``client``) never change.

Pure functions, no I/O.
"""

from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional, Tuple

#: The 14 foundational helping skills: key -> name, as ally-be's
#: `helping-skills-rubric.constants.ts` has them and the Analyst names them.
DEFAULT_FOUNDATIONAL_SKILLS: Dict[str, str] = {
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

DEFAULT_FRAMEWORK_NAME = "Foundational Skills"

#: The three skill-coverage areas today's debrief reports.
DEFAULT_AREAS: Tuple[Dict[str, str], ...] = (
    {
        "name": "Listening Engagement",
        "description": "listening and engaging with what the client said",
    },
    {
        "name": "Emotional Attunement",
        "description": "recognising and responding to the client's emotions",
    },
    {
        "name": "Supportive Engagement",
        "description": "offering support and a safe, non-judgmental space",
    },
)

ALARM = "alarm"
ASSESSED = "assessed"
DEFAULT_RISK_CUE: Dict[str, Any] = {
    "key": None,
    "name": None,
    "handling": ALARM,
    "word_list_raises": True,
}

LEGACY = "legacy"
NEUTRAL = "neutral"


def default_framework() -> Dict[str, Any]:
    """A fresh copy of the default (foundational) framework."""
    return {
        "id": None,
        "name": DEFAULT_FRAMEWORK_NAME,
        "foundational": True,
        "skills": [
            {"key": k, "name": n, "words": []}
            for k, n in DEFAULT_FOUNDATIONAL_SKILLS.items()
        ],
        "areas": [dict(a) for a in DEFAULT_AREAS],
    }


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _skills(raw: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen = set()
    for s in raw if isinstance(raw, list) else []:
        if not isinstance(s, dict):
            continue
        key, name = _text(s.get("key")), _text(s.get("name"))
        if not key or not name or key in seen:
            continue
        seen.add(key)
        words = [w for w in s.get("words") or [] if isinstance(w, str) and w.strip()]
        out.append({"key": key, "name": name, "words": words})
    return out


def _areas(raw: Any) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    seen = set()
    for a in raw if isinstance(raw, list) else []:
        if not isinstance(a, dict):
            continue
        name = _text(a.get("name"))
        if not name or name in seen:
            continue
        seen.add(name)
        out.append({"name": name, "description": _text(a.get("description"))})
    return out


def normalise_framework(raw: Any) -> Dict[str, Any]:
    """A request's framework value, normalised; the default when it is absent
    (None, or not an object). An object with no skills is the "None"
    framework."""
    if not isinstance(raw, dict):
        return default_framework()
    return {
        "id": raw.get("id"),
        "name": _text(raw.get("name")),
        "foundational": bool(raw.get("foundational")),
        "skills": _skills(raw.get("skills")),
        "areas": _areas(raw.get("areas")),
    }


def _session_value(session: Optional[Mapping[str, Any]], key: str) -> Any:
    """A session field in ally-be's snake_case or camelCase."""
    s = session or {}
    if key in s:
        return s[key]
    head, *rest = key.split("_")
    return s.get(head + "".join(p.title() for p in rest))


def framework_of(session: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    """The session's framework, normalised; default foundational when absent."""
    return normalise_framework(_session_value(session, "framework"))


def has_framework(session: Optional[Mapping[str, Any]]) -> bool:
    return isinstance(_session_value(session, "framework"), dict)


def session_has(session: Optional[Mapping[str, Any]], key: str) -> bool:
    """Does the session carry this optional contract field?"""
    return _session_value(session, key) is not None


def is_none_framework(framework: Mapping[str, Any]) -> bool:
    """A framework that lists no skills: assess only the roleplay's own."""
    return not (framework or {}).get("skills")


def skill_names(
    framework: Optional[Mapping[str, Any]],
    extra: Optional[Mapping[str, Any]] = None,
) -> Dict[str, str]:
    """key -> name of every progress key: the framework's skills, then the
    profile's extra named competencies. The framework wins a clash."""
    fw = framework if framework is not None else default_framework()
    out: Dict[str, str] = {s["key"]: s["name"] for s in fw.get("skills") or []}
    if isinstance(extra, Mapping):
        for k, v in extra.items():
            key, name = _text(k), _text(v)
            if key and name and key not in out:
                out[key] = name
    return out


def areas_of(framework: Optional[Mapping[str, Any]]) -> List[Dict[str, str]]:
    fw = framework if framework is not None else default_framework()
    return [dict(a) for a in fw.get("areas") or []]


def area_names(framework: Optional[Mapping[str, Any]]) -> List[str]:
    return [a["name"] for a in areas_of(framework)]


def risk_cue_of(session: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    """The session's risk cue handling; alarm with the word list raising when
    absent. An unknown handling is read as alarm (the safe one)."""
    raw = _session_value(session, "risk_cue")
    out = dict(DEFAULT_RISK_CUE)
    if not isinstance(raw, dict):
        return out
    out["key"] = raw.get("key")
    out["name"] = raw.get("name")
    out["handling"] = ASSESSED if raw.get("handling") == ASSESSED else ALARM
    wlr = raw.get("word_list_raises", raw.get("wordListRaises"))
    out["word_list_raises"] = True if wlr is None else bool(wlr)
    return out


def speaker_labels_of(session: Optional[Mapping[str, Any]]) -> str:
    """``neutral`` or ``legacy`` (the default, and for any other value)."""
    value = _session_value(session, "speaker_labels")
    return NEUTRAL if value == NEUTRAL else LEGACY


def normalise_labels(value: Any) -> str:
    return NEUTRAL if value == NEUTRAL else LEGACY


def speaker(role: str, labels: Any = LEGACY, judge: bool = False) -> str:
    """The transcript label for an internal role (``client`` / ``counselor``).
    ``judge`` is the quality judge's legacy ``AI_CLIENT``."""
    is_client = role == "client"
    if normalise_labels(labels) == NEUTRAL:
        return "CHARACTER" if is_client else "LEARNER"
    if is_client:
        return "AI_CLIENT" if judge else "CLIENT"
    return "COUNSELLOR"


def skill_framework_text(framework: Optional[Mapping[str, Any]]) -> str:
    """The Analyst's ``skill_framework`` variable: the framework's name and its
    skill names exactly, with the rule for using them; ``none`` (the NONE
    marker) when the framework lists no skills."""
    fw = framework if framework is not None else default_framework()
    names = [s["name"] for s in fw.get("skills") or []]
    if not names:
        return "none"
    head = f"{fw.get('name')}" if fw.get("name") else "Skill framework"
    return "\n".join(
        [
            f"{head}. Skills, to be named exactly as written:",
            *[f"- {n}" for n in names],
            "Add a skill from this framework, named exactly as written, only "
            "when it clearly shaped the session and the roleplay's own "
            "expectations do not already cover it.",
        ]
    )
