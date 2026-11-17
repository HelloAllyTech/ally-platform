"""The Analyst reads what the roleplay expects: its own behaviours, and
competencies as labels with their behaviours; never a custom code (review
2026-11-16)."""

import pytest

from app.core.debrief.safety_reader import TranscriptTurn
from app.core.debrief.schemas import DebriefCards, EvidenceMap
from tests.core.debrief_graph.fakes import FOUNDATIONAL_FRAMEWORK as FOUNDATIONAL

TRANSCRIPT = [
    TranscriptTurn(turn_index=1, role="counselor", text="What brings you in?"),
    TranscriptTurn(turn_index=2, role="client", text="Exams."),
]


@pytest.fixture
def dispatch_returns(monkeypatch):
    from app.core.llm import dispatch

    calls = {}

    def _set(output, model="gemini-2.5-pro"):
        async def _fake(**kwargs):
            calls.update(kwargs)
            return output, {"provider": "gemini", "model": model}

        monkeypatch.setattr(dispatch, "generate_structured", _fake)
        return calls

    return _set


@pytest.mark.asyncio
async def test_analyst_assesses_the_roleplay_behaviours(dispatch_returns):
    from app.core.debrief.steps import analyse

    calls = dispatch_returns(EvidenceMap())
    await analyse(
        TRANSCRIPT,
        "en",
        "gemini-2.5-pro",
        expected_behaviours=["Empathy", "QPR"],
        helpful_behaviours=["Asks open questions"],
        unhelpful_behaviours=["Gives advice too early"],
        competencies=[
            {"name": "Empathy", "helpful": ["Reflects feelings"], "unhelpful": []},
            {"name": "QPR", "helpful": [], "unhelpful": []},
            # Never sent by ally-be, and dropped here if it were.
            {"name": None, "helpful": ["x"], "unhelpful": []},
        ],
    )
    prompt = calls["prompt"]
    assert prompt.count("<roleplay_expectations>") == 1
    assert "did the learner show the helpful" in prompt
    assert "never as if it had a definition" in prompt
    assert "lower your confidence" in prompt
    assert "Never write a code" in prompt
    assert "<roleplay_expectations>" in prompt
    assert "Gives advice too early" in prompt
    assert '"name": null' not in prompt


@pytest.mark.asyncio
async def test_analyst_falls_back_to_foundational_skills_with_nothing(
    dispatch_returns,
):
    from app.core.debrief.steps import DEFAULT_ANALYST_SYSTEM, analyse

    calls = dispatch_returns(EvidenceMap())
    await analyse(
        TRANSCRIPT, "en", "gemini-2.5-pro", framework=FOUNDATIONAL
    )
    assert "(ROLEPLAY EXPECTATIONS):\nnone" in calls["prompt"]
    assert "<roleplay_expectations>" not in calls["prompt"]
    assert "Empathy, warmth and genuineness" in calls["prompt"]


@pytest.mark.asyncio
async def test_writer_and_reviser_are_told_never_to_write_a_code(dispatch_returns):
    from app.core.debrief.steps import revise, write

    calls = dispatch_returns(DebriefCards(opening="x"))
    await write({}, {}, "en", "gemini-3-flash-preview", TRANSCRIPT)
    assert "Never write a code such as 478_custom_27" in calls["prompt"]
    await revise({}, [], {}, TRANSCRIPT, "en", "gemini-3-flash-preview")
    assert "Never write a code such as 478_custom_27" in calls["prompt"]


def test_the_analyst_body_carries_the_expectations():
    from app.core.debrief_graph import inputs

    class Ctx:
        transcript = []
        language = "en"
        session = {
            "expected_behaviours": ["Empathy"],
            "helpful_behaviours": ["Asks open questions"],
            "unhelpful_behaviours": [],
            "competencies": [{"name": "Empathy", "helpful": [], "unhelpful": []}],
        }
        inputs = {}

        def sess(self, key, default=None):
            return self.session.get(key, default)

        def step_of(self, *_):
            return None

        def prompt(self, *_):
            return None

    body = inputs.analyst_body({"recipe_key": "standard"}, Ctx())
    assert body["helpful_behaviours"] == ["Asks open questions"]
    assert body["competencies"][0]["name"] == "Empathy"
    keys = list(body)
    assert keys.index("expected_behaviours") < keys.index("helpful_behaviours")


def test_the_defaults_lead_with_the_roleplay_and_use_foundational_skills_loosely():
    """Shipped with this release (owner decision 2026-11-16), not via the ladder."""
    from app.core.debrief.steps import DEFAULT_ANALYST_SYSTEM, DEFAULT_WRITER_SYSTEM

    assert "first, what THIS roleplay expects" in DEFAULT_ANALYST_SYSTEM
    assert "only when it clearly shaped this session" in DEFAULT_ANALYST_SYSTEM
    assert "use the skills from the SKILL FRAMEWORK that mattered" in (
        DEFAULT_ANALYST_SYSTEM.replace("\\\n", "").replace("\n", " ")
    )
    assert "Use a skill from the framework only when it clearly shaped" in (
        DEFAULT_WRITER_SYSTEM.replace("\n", " ")
    )
    assert "preferring one of this roleplay's competencies" in DEFAULT_WRITER_SYSTEM


def test_an_unhelpful_behaviour_is_named_by_what_to_do_instead():
    """Review 2026-11-16: "Interrupts client" became a learner's card heading.
    The wording lives in the Analyst prompt (Skills Store), not in code."""
    from app.core.debrief.steps import DEFAULT_ANALYST_SYSTEM

    assert "Name an unhelpful behaviour by what to do instead" in DEFAULT_ANALYST_SYSTEM
    assert "observed when the" in DEFAULT_ANALYST_SYSTEM
    assert DEFAULT_ANALYST_SYSTEM.count("what to do instead") == 1
