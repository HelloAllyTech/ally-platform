"""Step 4 (2026-11-16): every Debrief prompt has a Skills Store code, and wording
that sat next to a prompt in code moved into it. Code keeps data, format and
checked safety lines."""

from pathlib import Path

import pytest
from langgraph.store.memory import InMemoryStore

from app.core.debrief.safety_reader import TranscriptTurn

SEED = Path(__file__).resolve().parents[3] / "ally-be/src/prompts/debrief"
TRANSCRIPT = [
    TranscriptTurn(turn_index=1, role="counselor", text="What brings you in?"),
    TranscriptTurn(turn_index=2, role="client", text="Exams."),
]


@pytest.fixture
def prompts(monkeypatch):
    from app.core.llm import dispatch

    sent = []

    async def _fake(**kwargs):
        sent.append(kwargs["prompt"])
        return None, {"provider": "gemini", "model": "m"}

    monkeypatch.setattr(dispatch, "generate_structured", _fake)
    return sent


def _seed(name):
    path = SEED / name
    if not path.exists():
        pytest.skip("ally-be is not checked out beside ally-ai")
    return path.read_text()


# --- A1/A2: the Evaluator's own prompts ------------------------------------------


def test_the_evaluator_defaults_match_the_seeds():
    from app.core.debrief.steps import (
        DEFAULT_EVALUATOR_FIX_SYSTEM,
        DEFAULT_EVALUATOR_SYSTEM,
    )

    assert DEFAULT_EVALUATOR_SYSTEM.strip() == _seed("evaluator_system.txt").strip()
    assert (
        DEFAULT_EVALUATOR_FIX_SYSTEM.strip()
        == _seed("evaluator_fix_system.txt").strip()
    )


@pytest.mark.asyncio
async def test_the_pass_bar_is_the_release_setting_not_text(prompts):
    from app.core.debrief.steps import evaluate

    await evaluate(TRANSCRIPT, "A debrief.", "en", "m", pass_score=7.5)
    p = prompts[-1]
    assert "PASS BAR: 7.5" in p and p.count("PASS BAR:") == 1
    assert "reach 8" not in p
    assert p.count("FIX SECTIONS: opening, important_moment") == 1
    await evaluate(TRANSCRIPT, "A debrief.", "en", "m")
    assert "PASS BAR: 8\nFIX SECTIONS: opening" in prompts[-1]


@pytest.mark.asyncio
async def test_the_evaluator_reads_its_own_live_texts(prompts):
    from app.core.debrief.steps import evaluate

    await evaluate(
        TRANSCRIPT,
        "A debrief.",
        "en",
        "m",
        system="EVALUATOR LIVE",
        fix_system="FIX LIVE {{pass_bar}} {{fix_sections}}",
    )
    p = prompts[-1]
    assert p.count("EVALUATOR LIVE") == 1 and p.count("FIX LIVE") == 1
    assert "FIX NOTES." not in p


def test_the_evaluator_body_carries_its_prompts_and_the_bar():
    from app.core.debrief_graph import inputs

    class Ctx:
        transcript = []
        language = "en"
        settings = {"passScore": 9}

        def sess(self, *_):
            return None

        def prompt(self, code):
            return f"<{code}>"

        def setting(self, k, d=None):
            return self.settings.get(k, d)

    body = inputs.evaluator_body({"current": {"debrief": "x"}}, Ctx())
    assert body["system_prompt"] == "<debrief_evaluator_system>"
    assert body["fix_prompt"] == "<debrief_evaluator_fix_system>"
    assert body["pass_score"] == 9


# --- A3/A4: PM agent subagents and skills ----------------------------------------


def test_the_pm_defaults_match_the_seeds():
    from app.core.pm_agent import agent

    assert agent.INVESTIGATOR_PROMPT.strip() == (
        _seed("pm_investigator_system.txt").strip()
    )
    assert agent.REVIEWER_PROMPT.strip() == _seed("pm_reviewer_system.txt").strip()
    for name, code in agent.SKILL_PROMPT_CODES.items():
        packaged = (agent.SKILLS_DIR / name / "SKILL.md").read_text()
        assert packaged == _seed(code.replace("debrief_", "", 1) + ".txt")


@pytest.mark.asyncio
async def test_skills_come_from_the_store_texts_and_load_as_skills():
    """Deep Agents' own skills loader reads /skills/ from the store backend."""
    from deepagents.middleware.skills import _alist_skills

    from app.core.pm_agent import agent

    store = InMemoryStore()
    live = (
        "---\nname: prompt-change\ndescription: LIVE description of the skill.\n"
        "---\n\n# Live body\n"
    )
    await agent.seed_skills(store, {"debrief_pm_skill_prompt_change": {"prompt": live}})
    backend = agent.build_backend(store)
    skills = await _alist_skills(backend, "/skills/")
    by_name = {s["name"]: s for s in skills}
    assert set(by_name) == set(agent.SKILL_PROMPT_CODES)
    assert by_name["prompt-change"]["description"] == "LIVE description of the skill."
    item = await store.aget(agent.SKILLS_NAMESPACE, "/prompt-change/SKILL.md")
    assert "Live body" in str(item.value)
    # Without a live text the packaged default is used.
    await agent.seed_skills(store, None)
    item = await store.aget(agent.SKILLS_NAMESPACE, "/prompt-change/SKILL.md")
    assert "Live body" not in str(item.value)


def test_the_subagents_take_their_live_texts(monkeypatch):
    from app.core.pm_agent import agent
    from app.core.pm_agent.ledger import RunLedger
    from app.core.pm_agent.tools import make_tools
    from tests.core.ask_ally.fakes import FakeGateway, ScriptedModel

    seen = {}

    def fake(**kw):
        seen.update(kw)
        return object()

    monkeypatch.setattr(agent, "create_deep_agent", fake)
    ledger = RunLedger(run_id="r", budget_usd=1, prices={})
    agent.build_pm_agent(
        ledger=ledger,
        tools=make_tools(FakeGateway(), ledger),
        models={"m": ScriptedModel()},
        primary="m",
        backup=None,
        system_prompt="s",
        store=InMemoryStore(),
        checkpointer=None,
        gateway=FakeGateway(),
        prompts={
            "debrief_pm_investigator_system": "INVESTIGATE LIVE",
            "debrief_pm_reviewer_system": {"prompt": "REVIEW LIVE"},
        },
    )
    investigator, reviewer = seen["subagents"]
    assert investigator["system_prompt"] == "INVESTIGATE LIVE"
    assert reviewer["system_prompt"] == "REVIEW LIVE"


# --- B5/B6: the planner ----------------------------------------------------------


def test_the_planner_agents_default_is_the_manifests_wording():
    from app.core.debrief_graph.registry.wording import render_default

    assert render_default() == _seed("planner_agents.txt")


def test_the_planner_sees_the_same_cards_from_the_default_text():
    from app.core.debrief_graph.registry.manifest import REGISTRY
    from app.core.debrief_graph.registry.wording import (
        parse,
        render_default,
        with_wording,
    )

    wording = parse(render_default())
    for m in REGISTRY.values():
        if not m.floor:
            assert with_wording(m.card(), wording) == m.card(), m.id


def test_live_wording_replaces_only_the_wording():
    from app.core.debrief_graph.registry.manifest import REGISTRY
    from app.core.debrief_graph.registry.wording import parse, with_wording

    card = REGISTRY["protocol_check"].card()
    live = parse(
        "Header text.\n\n## protocol_check\nuse_when: Only when NEW wording.\n"
        "id: hacked\ncost_estimate_usd: 0\n"
    )
    out = with_wording(card, live)
    assert out["use_when"] == "Only when NEW wording."
    assert out["description"] == card["description"]
    assert out["id"] == "protocol_check"
    assert out["cost_estimate_usd"] == card["cost_estimate_usd"]


@pytest.mark.asyncio
async def test_the_top_up_is_a_data_line_and_its_wording_is_the_prompts(prompts):
    from app.core.debrief.steps import DEFAULT_PLANNER_SYSTEM, plan_agents

    await plan_agents({}, [], "m", max_agents=2, critique=[], already=["x"])
    p = prompts[-1]
    assert p.count("TOP-UP: given") == 1
    assert p.count("ALREADY RAN lists agents that may not be chosen again") == 1
    assert "TOP-UP. When TOP-UP is given" in DEFAULT_PLANNER_SYSTEM
    await plan_agents({}, [], "m", max_agents=2)
    assert "TOP-UP: none" in prompts[-1]


# --- B7: the flag answer's cap is checked in code --------------------------------


def test_the_flag_reply_cap_is_checked():
    from app.core.debrief.flag_answer import (
        FlagAnswerRequest,
        FlagDecision,
        problem_with,
        sentence_count,
    )

    assert sentence_count("One. Two! Three?") == 3
    assert sentence_count("एक। दो। तीन। चार") == 4
    assert sentence_count("Kept it, because the quote is right") == 1
    req = FlagAnswerRequest(
        flag_id="f",
        run_id="r",
        section="what_worked[0]",
        card={"lead": "x"},
        transcript=[],
        model="m",
    )
    ok = FlagDecision(action="keep", reply="I kept it. The quote is right.")
    assert problem_with(ok, req) is None
    long = FlagDecision(action="keep", reply="One. Two. Three. Four.")
    assert "4 sentences" in problem_with(long, req)
    assert "three short sentences" in _flag_prompt()
    assert "three" not in FlagDecision.model_fields["reply"].description


def _flag_prompt():
    from app.prompts.resolver import load_template

    return load_template("debrief/flag_answer_system")


# --- B8: Ask Ally's tool descriptions --------------------------------------------


def test_tool_descriptions_are_short_and_the_wording_is_the_reply_prompts():
    from app.core.ask_ally.tools import ASK_ALLY_TOOLS, clean_topic

    for t in ASK_ALLY_TOOLS:
        assert "Use it when" not in t.description
        assert "second opinion" not in t.description
    reply = _seed("reply_system.txt")
    assert "TOOLS. Use search_guidance" in reply
    assert "never the learner's own words, names or personal details" in reply
    assert "THEIR ORGANISATION. When THEIR ORGANISATION is given" in reply
    # Still enforced in code: a topic is a few words, never a message.
    assert clean_topic("a " * 30).count("a") == 10
