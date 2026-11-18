"""The data-access matrix is a mirror of the real wiring, never a second source.

`docs/debrief-harness/data-access.json` (written from ally-be's
`debrief-data-access.constants.ts`) declares what each Debrief agent can read.
This test builds every step body in `inputs.py` with every optional input
present and fails when a body carries a key the declaration does not name, or
the declaration names a key the body no longer has: adding an input to a step
without declaring it (or removing one) is caught here. The PM agent's tools are
checked the same way.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

import pytest

from app.core.debrief_graph import inputs
from app.core.pm_agent.tools import make_tools

DECLARED = json.loads(
    (
        Path(__file__).resolve().parents[4]
        / "docs"
        / "debrief-harness"
        / "data-access.json"
    ).read_text()
)
AGENTS = {a["key"]: a for a in DECLARED["agents"]}
DATA_KEYS = {d["key"] for d in DECLARED["data"]}

TRANSCRIPT = [
    {"turn_index": 1, "role": "counselor", "text": "Hello"},
    {"turn_index": 2, "role": "client", "text": "I want to die"},
]
CARDS = {
    "what_worked": [{"turn_index": 1}],
    "work_on_this": [],
    "important_moment": {"turn_index": 2},
}


class Ctx:
    """A context with every optional input present."""

    transcript = TRANSCRIPT
    language = "en"
    session = {
        "scenario": {"title": "t", "description": "d"},
        "expected_behaviours": ["Empathy"],
        "helpful_behaviours": ["Asks open questions"],
        "unhelpful_behaviours": ["Interrupts"],
        "competencies": [{"name": "Empathy", "helpful": [], "unhelpful": []}],
        "learner_level": "new",
        "framework": {"skills": [{"key": "k", "name": "n"}], "areas": []},
        "risk_cue": {"key": "part_of_practice", "handling": "assessed"},
        "speaker_labels": "legacy",
    }
    inputs = {
        "live_detections": [{"behaviour": "b", "detected": True}],
        "case_memory": "remembers",
        "cohort": {"trainees": "five or more", "skills": []},
        "practice_options": [{"id": 1}],
        "past_work_on_this": [{"skill": "s"}],
        "progress_profile": {"sessions": 3, "skills": {}, "past_points": []},
    }
    risk_cue = {"handling": "assessed", "word_list_raises": True}

    def sess(self, key, default=None):
        return self.session.get(key, default)

    def step_of(self, *_):
        return {"step": "analyst"}

    def prompt(self, *_):
        return "text"

    def setting(self, key, default=None):
        return default

    def recipe(self, key):
        return {"key": key, "shortForm": False}

    def skill_names(self):
        return {"k": "n"}


def state(**extra: Any) -> Dict[str, Any]:
    base = {
        "recipe_key": "standard",
        "evidence": {"behaviours": []},
        "safety": {"risk_cues": [{"turn_index": 2}], "learner_distress": []},
        "current": {"debrief": {"cards": CARDS}},
        "best": {"cards": CARDS, "checks": [], "evaluation": {}},
        "history": [],
        "progress": None,
        "orchestrated": True,
        "tool_passages": [{"title": "x"}],
        "top_up_agents": ["a"],
        "anchor_quotes": None,
    }
    base.update(extra)
    return base


BODIES = {
    "safety_reader": lambda: inputs.safety_body(state(), Ctx()),
    "analyst": lambda: inputs.analyst_body(state(), Ctx()),
    "progress_agent": lambda: inputs.progress_agent_body(state(), Ctx()),
    "progress_reader": lambda: inputs.progress_body(state(), Ctx()),
    "writer": lambda: inputs.writer_body(state(), Ctx()),
    "evaluator": lambda: inputs.evaluator_body(state(), Ctx()),
    "reviser": lambda: inputs.reviser_body(state(), Ctx()),
}


@pytest.mark.parametrize("agent", sorted(BODIES))
def test_a_step_body_carries_exactly_the_declared_inputs(agent: str):
    body = BODIES[agent]()
    declared = AGENTS[agent]["body"]
    assert set(body) - set(declared) == set(), (
        f"{agent} is now sent {sorted(set(body) - set(declared))}: declare what data "
        "it is in ally-be debrief-data-access.constants.ts (then UPDATE_DATA_ACCESS=1)"
    )
    assert set(declared) - set(body) == set(), (
        f"{agent} no longer carries {sorted(set(declared) - set(body))}: "
        "remove it from the declaration"
    )
    for item in declared.values():
        assert item is None or item in DATA_KEYS


def test_every_wired_step_is_declared_and_every_declared_agent_is_wired():
    assert set(BODIES) == set(AGENTS)


def test_the_pm_agent_declaration_matches_its_tools():
    tools = {t.name for t in make_tools(None, None)}
    declared = {t["tool"] for t in DECLARED["pmAgent"]}
    assert tools == declared, (
        f"undeclared PM agent tools {sorted(tools - declared)}; "
        f"declared but gone {sorted(declared - tools)}"
    )
