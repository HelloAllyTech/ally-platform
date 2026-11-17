"""The roleplay contract ally-be sends (session.framework, session.risk_cue,
session.speaker_labels, context.progress_profile.skill_names, and the judge's
roleplay_expectations): each behaviour, and that an absent contract changes
nothing."""

import copy

import pytest

from app.core.debrief.safety_reader import TranscriptTurn
from app.core.debrief.schemas import BehaviourEvidence, EvidenceMap
from tests.core.test_debrief_steps import TRANSCRIPT, dispatch_returns  # noqa: F401

FOUNDATIONAL_NAMES = [
    "Verbal communication",
    "Empathy, warmth and genuineness",
    "Elicitation of feedback",
]
CUSTOM = {
    "id": "fw-1",
    "name": "Triage",
    "foundational": False,
    "skills": [{"key": "ask", "name": "Ask directly", "words": []}],
    "areas": [{"name": "Safety", "description": "keeping the person safe"}],
}
NONE_FW = {"id": None, "name": "None", "foundational": False, "skills": []}


def behaviour(category):
    return BehaviourEvidence(
        skill="x",
        opportunity=True,
        observation="observed",
        confidence="high",
        importance=2,
        note="n",
        coverage_category=category,
    )


async def analyse_prompt(dispatch_returns, **kw):  # noqa: F811
    from app.core.debrief.steps import analyse

    calls = dispatch_returns(EvidenceMap())
    await analyse(TRANSCRIPT, "en", "gemini-2.5-pro", **kw)
    return calls["prompt"]


# --- B. Analyst -------------------------------------------------------------


@pytest.mark.asyncio
async def test_default_analyst_prompt_lists_the_foundational_skills(
    dispatch_returns,  # noqa: F811
):
    p = await analyse_prompt(dispatch_returns)
    for name in FOUNDATIONAL_NAMES:
        assert f"- {name}\n" in p
    assert p.count("- ") >= 14
    assert (
        "SKILL COVERAGE: set coverage_category on every behaviour to the one "
        "area it belongs to (Listening Engagement, Emotional Attunement or "
        "Supportive Engagement), or null when none fits." in p
    )
    assert "[turn 2] CLIENT: I don't want to be here." in p
    assert "{{" not in p


@pytest.mark.asyncio
async def test_none_framework_marks_none_and_drops_the_coverage_rule(
    dispatch_returns,  # noqa: F811
):
    p = await analyse_prompt(dispatch_returns, framework=NONE_FW)
    assert "SKILL FRAMEWORK):\nnone" in p
    assert "Verbal communication" not in p
    assert "SKILL COVERAGE" not in p
    assert "EMOTIONAL MOVEMENT" in p


@pytest.mark.asyncio
async def test_custom_framework_names_and_areas(dispatch_returns):  # noqa: F811
    p = await analyse_prompt(dispatch_returns, framework=CUSTOM)
    assert "Triage. Skills, to be named exactly as written:\n- Ask directly" in p
    assert "Verbal communication" not in p
    assert "to the one area it belongs to (Safety), or null" in p
    assert "Safety (keeping the person safe)" in p


@pytest.mark.asyncio
async def test_coverage_category_outside_the_areas_becomes_null(monkeypatch):
    from app.core.debrief.steps import analyse
    from app.core.llm import dispatch

    async def _fake(**kwargs):
        out = EvidenceMap(
            behaviours=[behaviour("Safety"), behaviour("Listening Engagement")]
        )
        return out, {"provider": "gemini", "model": "m", "fell_back_from": None}

    monkeypatch.setattr(dispatch, "generate_structured", _fake)
    out, _ = await analyse(TRANSCRIPT, "en", "m", framework=CUSTOM)
    assert [b.coverage_category for b in out.behaviours] == ["Safety", None]
    out, _ = await analyse(TRANSCRIPT, "en", "m", framework=NONE_FW)
    assert [b.coverage_category for b in out.behaviours] == [None, None]
    out, _ = await analyse(TRANSCRIPT, "en", "m")
    assert [b.coverage_category for b in out.behaviours] == [
        None,
        "Listening Engagement",
    ]


def test_coverage_category_is_free_text_in_the_schema():
    assert BehaviourEvidence.model_fields["coverage_category"].description


def test_render_ignores_a_variable_the_live_text_does_not_mention():
    from app.core.debrief.render import render

    assert render("c", "hello {{a}}", {"a": "x", "skill_framework": "y"}) == "hello x"


@pytest.mark.asyncio
async def test_defaults_are_neutral(dispatch_returns):  # noqa: F811
    from app.core.debrief import steps

    for name in (
        "DEFAULT_ANALYST_SYSTEM",
        "DEFAULT_PROGRESS_READER_SYSTEM",
        "DEFAULT_PROGRESS_SYSTEM",
        "DEFAULT_WRITER_SYSTEM",
        "DEFAULT_REVISER_SYSTEM",
        "DEFAULT_PLANNER_SYSTEM",
        "DEFAULT_PROTOCOL_CHECK_SYSTEM",
        "DEFAULT_HISTORY_DEEP_SYSTEM",
        "DEFAULT_LANGUAGE_SPECIALIST_SYSTEM",
    ):
        text = getattr(steps, name).lower()
        assert "mental-health" not in text and "trainee counsellor" not in text, name
        assert "ai client" not in text, name
    assert "{{skill_framework}}" in steps.DEFAULT_ANALYST_SYSTEM
    assert "Verbal communication" not in steps.DEFAULT_ANALYST_SYSTEM
    for name in (
        "DEFAULT_WRITER_SYSTEM",
        "DEFAULT_REVISER_SYSTEM",
        "DEFAULT_EVALUATOR_FIX_SYSTEM",
    ):
        assert "{{risk_handling}}" in getattr(steps, name)


# --- C. speaker labels ------------------------------------------------------


@pytest.mark.asyncio
async def test_neutral_labels_in_every_transcript(dispatch_returns):  # noqa: F811
    from app.core.debrief import steps
    from app.core.debrief.safety_reader import build_prompt

    neutral = await analyse_prompt(dispatch_returns, speaker_labels="neutral")
    assert "[turn 1] LEARNER: What brings you in?" in neutral
    assert "[turn 2] CHARACTER: I don't want to be here." in neutral
    assert "COUNSELLOR" not in neutral.split("<transcript>")[1]
    assert "for every CHARACTER turn" in neutral

    p = build_prompt(TRANSCRIPT, "en", speaker_labels="neutral")
    assert "[turn 2] CHARACTER:" in p and "[turn 1] LEARNER:" in p
    legacy = build_prompt(TRANSCRIPT, "en")
    assert "[turn 2] CLIENT:" in legacy and "[turn 1] COUNSELLOR:" in legacy

    calls = dispatch_returns(None)
    await steps.write({}, {}, "en", "m", TRANSCRIPT, speaker_labels="neutral")
    assert "[turn 2] CHARACTER:" in calls["prompt"]
    await steps.revise({}, [], {}, TRANSCRIPT, "en", "m", speaker_labels="neutral")
    assert "[turn 1] LEARNER:" in calls["prompt"]
    await steps.find(
        "debrief_x",
        "{{transcript}} {{findings_rules}}",
        {},
        TRANSCRIPT,
        "en",
        "m",
        speaker_labels="neutral",
    )
    assert "[turn 2] CHARACTER:" in calls["prompt"]


def test_judge_labels_legacy_and_neutral():
    from app.core.debrief_quality.prompt import build_judge_prompt

    t = [
        {"role": "counselor", "turn_index": 1, "text": "hi"},
        {"role": "client", "turn_index": 2, "text": "yo"},
    ]
    legacy = build_judge_prompt(t, "d", "en")
    assert "[turn 1] COUNSELLOR: hi" in legacy and "[turn 2] AI_CLIENT: yo" in legacy
    n = build_judge_prompt(t, "d", "en", speaker_labels="neutral")
    assert "[turn 1] LEARNER: hi" in n and "[turn 2] CHARACTER: yo" in n


# --- E. risk handling -------------------------------------------------------


def test_risk_handling_text_and_cues_to_cover():
    from app.core.debrief.steps import (
        ASSESSED_RISK_HANDLING,
        risk_cues_to_cover,
        risk_handling_text,
    )

    safety = {"risk_cues": [{"turn_index": 2, "strength": "clear"}]}
    assert risk_handling_text(None) == "none"
    assert risk_handling_text({"handling": "alarm"}) == "none"
    assert risk_handling_text({"handling": "assessed"}) == ASSESSED_RISK_HANDLING
    assert "do not write an important_moment card" in ASSESSED_RISK_HANDLING
    today = risk_cues_to_cover(safety)
    assert today == (
        "turns 2. The important_moment card covers the most serious one; list "
        "every other one in important_moment.others."
    )
    assert risk_cues_to_cover(safety, {"handling": "alarm"}) == today
    flagged = {
        "risk_cues": [{"turn_index": 2, "strength": "clear", "part_of_practice": True}]
    }
    assessed = risk_cues_to_cover(flagged, {"handling": "assessed"})
    assert "important_moment" in assessed and "no important_moment card" in assessed
    assert risk_cues_to_cover({}, {"handling": "assessed"}) == "none"


@pytest.mark.asyncio
async def test_writer_and_reviser_and_fix_carry_the_handling(
    dispatch_returns,  # noqa: F811
):
    from app.core.debrief import steps

    calls = dispatch_returns(None)
    assessed = {"handling": "assessed", "word_list_raises": False}
    await steps.write({}, {}, "en", "m", TRANSCRIPT, risk_cue=assessed)
    assert steps.ASSESSED_RISK_HANDLING in calls["prompt"]
    assert calls["prompt"].count(steps.ASSESSED_RISK_HANDLING) == 1
    await steps.write({}, {}, "en", "m", TRANSCRIPT)
    assert "RISK HANDLING: none" in calls["prompt"]
    await steps.revise({}, [], {}, TRANSCRIPT, "en", "m", risk_cue=assessed)
    assert steps.ASSESSED_RISK_HANDLING in calls["prompt"]
    await steps.evaluate(TRANSCRIPT, "d", "en", "m", risk_cue=assessed)
    assert calls["prompt"].count(steps.ASSESSED_RISK_HANDLING) == 1
    assert "RISK HANDLING: none" in steps.evaluator_fix_text()


@pytest.mark.asyncio
async def test_assessed_instruction_is_not_lost_when_the_live_text_lacks_it(
    dispatch_returns,  # noqa: F811
):
    from app.core.debrief import steps

    calls = dispatch_returns(None)
    live = "Write. {{risk_cue_turns}} {{risk_cue_definition}} {{safety_reading}}"
    live += " {{transcript}} {{checked_rules}}"
    await steps.write(
        {},
        {},
        "en",
        "m",
        TRANSCRIPT,
        system=live,
        risk_cue={"handling": "assessed"},
    )
    assert steps.ASSESSED_RISK_HANDLING in calls["prompt"]
    text = steps.evaluator_fix_text(
        "Fix {{pass_bar}} {{fix_sections}}", 8, {"handling": "assessed"}
    )
    assert steps.ASSESSED_RISK_HANDLING in text
    # Alarm adds nothing.
    assert "RISK HANDLING" not in steps.evaluator_fix_text(
        "Fix {{pass_bar}} {{fix_sections}}", 8
    )


# --- F. judge ---------------------------------------------------------------


def test_judge_practice_alignment_with_and_without_expectations():
    from app.core.debrief_quality.prompt import build_judge_prompt

    today = build_judge_prompt([], "d", "en")
    assert "consistent with sound helping-skills practice" in today
    assert "ROLEPLAY EXPECTATIONS" not in today
    assert build_judge_prompt([], "d", "en", roleplay_expectations={}) == today
    assert (
        build_judge_prompt(
            [],
            "d",
            "en",
            roleplay_expectations={"helpful_behaviours": [], "competencies": []},
        )
        == today
    )
    exp = {
        "helpful_behaviours": ["Asks open questions"],
        "unhelpful_behaviours": [],
        "competencies": [{"name": "Empathy", "helpful": [], "unhelpful": []}],
    }
    p = build_judge_prompt([], "d", "en", roleplay_expectations=exp)
    assert "<roleplay_expectations>" in p and "Asks open questions" in p
    assert "consistent with what this roleplay expects of the learner" in p
    assert "consistent with sound helping-skills practice" not in p


def test_judge_endpoint_accepts_the_new_fields(dispatch_returns):  # noqa: F811
    from fastapi.testclient import TestClient

    from app.core.config import settings
    from app.main import app

    calls = dispatch_returns(None)
    c = TestClient(app)
    c.headers.update({"x-api-key": settings.API.X_API_KEY})
    r = c.post(
        "/api/v1/debrief-quality/judge",
        json={
            "transcript": [
                {"role": "client", "turn_index": 1, "text": "yo"},
                {"role": "counselor", "turn_index": 2, "text": "hi"},
            ],
            "debrief": "d",
            "speaker_labels": "neutral",
            "roleplay_expectations": {"helpful_behaviours": ["Asks well"]},
        },
    )
    assert r.status_code == 200
    assert "[turn 1] CHARACTER: yo" in calls["prompt"]
    assert "Asks well" in calls["prompt"]
    assert "consistent with what this roleplay expects" in calls["prompt"]


# --- D. progress ------------------------------------------------------------


def _profile(**settings):
    from tests.core.debrief_graph.fakes import PROGRESS_PROFILE

    p = copy.deepcopy(PROGRESS_PROFILE)
    p["settings"].update(settings)
    return p


@pytest.mark.asyncio
async def test_progress_keys_and_fhs_gating(dispatch_returns):  # noqa: F811
    from app.core.debrief.steps import read_progress_report

    calls = dispatch_returns(None)
    await read_progress_report({}, _profile(), {}, "en", "m")
    p = calls["prompt"]
    assert "verbal = Verbal communication" in p
    assert "FOUNDATIONAL SKILLS LEVELS: not used" not in p

    # Custom, non-foundational framework with a named competency.
    prof = _profile()
    prof["skill_names"] = {"competency:calm": "Staying calm"}
    await read_progress_report({}, prof, {}, "en", "m", framework=CUSTOM)
    p = calls["prompt"]
    assert "SKILL KEYS: ask = Ask directly; competency:calm = Staying calm" in p
    assert "verbal = " not in p
    assert "FOUNDATIONAL SKILLS LEVELS: not used; set fhs to absent." in p

    # Foundational but the profile switches levels off.
    await read_progress_report({}, _profile(useFhs=False), {}, "en", "m")
    assert "not used; set fhs to absent" in calls["prompt"]
    # None framework: only the competencies.
    await read_progress_report({}, prof, {}, "en", "m", framework=NONE_FW)
    assert "SKILL KEYS: competency:calm = Staying calm" in calls["prompt"]


def test_vetoes_with_competency_keys_and_fhs_gating():
    from app.core.debrief_graph.progress_vetoes import OTHER, apply_vetoes, skill_key
    from tests.core.debrief_graph.fakes import obs

    names = {"competency:calm": "Staying calm"}
    assert skill_key("Staying calm", names) == "competency:calm"
    assert skill_key("competency:calm", names) == "competency:calm"
    assert skill_key("Verbal communication", names) == OTHER
    assert skill_key("Verbal communication") == "verbal"

    prof = _profile()
    prof["skills"] = {
        "competency:calm": [
            obs("r-1", "2026-11-01", "missed"),
            obs("r-2", "2026-11-02", "partial"),
            obs("r-3", "2026-11-03", "observed"),
        ]
    }
    prof["fhs"] = {
        "competency:calm": [
            {"date": "2026-11-01", "level": 4},
            {"date": "2026-11-03", "level": 2},
        ]
    }
    evidence = {
        "behaviours": [
            {
                "skill": "Staying calm",
                "opportunity": True,
                "observation": "observed",
                "confidence": "high",
                "importance": 3,
                "turn_index": 5,
            }
        ]
    }
    report = {
        "skills": [
            {
                "skill": "Staying calm",
                "trend": "more_consistent",
                "why": "x",
                "evidence": [{"run_id": "r-3", "turn_index": 3}],
                "fhs": "absent",
                "learner_line": "line",
            }
        ],
        "followups": [],
        "focus": None,
    }
    out, vetoes = apply_vetoes(copy.deepcopy(report), prof, evidence, names)
    assert out["skills"][0]["skill"] == "competency:calm"
    assert "contradicted_by_fhs" in [v["veto"] for v in vetoes]
    out, vetoes = apply_vetoes(
        copy.deepcopy(report), prof, evidence, names, foundational=False
    )
    assert [v["veto"] for v in vetoes] == []
    assert out["skills"][0]["trend"] == "more_consistent"
    # Without the mapping the competency is not a skill in play.
    _, vetoes = apply_vetoes(copy.deepcopy(report), prof, evidence)
    assert "other_skill" in [v["veto"] for v in vetoes]


def test_agent_input_uses_the_mapping():
    from app.core.debrief_graph.progress import agent_input

    prof = _profile()
    prof["skills"] = {}
    names = {"competency:calm": "Staying calm", "ask": "Ask directly"}
    evidence = {
        "behaviours": [
            {"skill": "Staying calm", "observation": "observed", "importance": 2}
        ]
    }
    out = agent_input(prof, evidence, names)
    assert list(out) == ["competency:calm"]
    assert out["competency:calm"]["name"] == "Staying calm"
    assert agent_input(prof, evidence) == {}


# --- graph ------------------------------------------------------------------

from app.core.debrief_graph import circuit  # noqa: E402
from tests.core.debrief_graph import fakes  # noqa: E402


@pytest.fixture
def closed():
    circuit.reset_model_circuits()
    yield
    circuit.reset_model_circuits()


def _session(**extra):
    return {**fakes.SESSION, **extra}


@pytest.mark.asyncio
async def test_graph_absent_contract_reports_alarm_and_sends_no_new_body_keys(
    closed,
):
    steps, gateway = fakes.FakeSteps(), fakes.FakeGateway()
    result = await fakes.run(steps, gateway)
    assert result["workspace"]["risk_cue"] == {
        "key": None,
        "handling": "alarm",
        "word_list_raises": True,
    }
    assert result["workspace"]["speaker_labels"] == "legacy"
    assert result["has_alarm_risk_cue"] is result["has_risk_cue"]
    assert result["workspace"]["framework"]["foundational"] is True
    assert gateway.tools("run_checks")[0]["risk_handling"] == "alarm"
    for call in steps.calls:
        for k in ("framework", "risk_cue", "speaker_labels"):
            assert k not in call["body"], (call["path"], k)


@pytest.mark.asyncio
async def test_graph_threads_the_contract_to_the_steps(closed):
    steps, gateway = fakes.FakeSteps(), fakes.FakeGateway()
    steps.answers["safety-reader"] = {
        "risk_cues": [
            {
                "turn_index": 2,
                "quote": "I want to die",
                "category": "hopelessness",
                "learner_response": "explored",
            }
        ],
        "learner_distress": [],
    }
    session = _session(
        framework=CUSTOM,
        risk_cue={"key": "rc", "handling": "assessed", "word_list_raises": False},
        speaker_labels="neutral",
    )
    result = await fakes.run(steps, gateway, session=session)
    bodies = {c["path"]: c["body"] for c in steps.calls}
    assert bodies["analyst"]["framework"]["skills"][0]["name"] == "Ask directly"
    assert bodies["analyst"]["speaker_labels"] == "neutral"
    assert bodies["safety-reader"]["speaker_labels"] == "neutral"
    assert bodies["writer"]["risk_cue"]["handling"] == "assessed"
    # The word list is off: the quote alone does not make the cue clear.
    sent = gateway.tools("run_checks")[0]
    # Safety net off: the reader's own judgement decides (clear when it gave
    # none), not the word list.
    assert sent["safety"]["risk_cues"][0]["strength"] == "clear"
    assert sent["risk_handling"] == "assessed"
    assert result["workspace"]["risk_cue"] == {
        "key": "rc",
        "handling": "assessed",
        "word_list_raises": False,
    }
    # The reader did not mark the cue as part of the practice: it alarms.
    assert result["has_risk_cue"] is True and result["has_alarm_risk_cue"] is True
    assert result["workspace"]["framework"]["id"] == "fw-1"
    assert result["workspace"]["speaker_labels"] == "neutral"


@pytest.mark.asyncio
async def test_graph_word_list_on_still_raises(closed):
    steps, gateway = fakes.FakeSteps(), fakes.FakeGateway()
    steps.answers["safety-reader"] = {
        "risk_cues": [
            {
                "turn_index": 2,
                "quote": "I want to die",
                "category": "hopelessness",
                "learner_response": "explored",
            }
        ],
        "learner_distress": [],
    }
    await fakes.run(steps, gateway)
    assert gateway.tools("run_checks")[0]["safety"]["risk_cues"][0]["strength"] == (
        "clear"
    )


def test_unused_import_guard():
    assert TranscriptTurn


# --- per-cue part_of_practice (the Safety reader decides) ------------------------

ASSESSED = {"handling": "assessed"}


def test_assessed_handling_text_points_at_the_readers_flag():
    from app.core.debrief.steps import ASSESSED_RISK_HANDLING, risk_handling_text

    assert risk_handling_text(ASSESSED) == ASSESSED_RISK_HANDLING
    assert "part_of_practice true" in ASSESSED_RISK_HANDLING
    assert "Any other clear risk cue still gets the important_moment" in (
        ASSESSED_RISK_HANDLING
    )
    assert "categor" not in ASSESSED_RISK_HANDLING


def test_cues_to_cover_follow_the_per_cue_flag():
    from app.core.debrief.steps import risk_cues_to_cover

    def cue(turn, practice=None, strength="clear"):
        c = {"turn_index": turn, "strength": strength, "category": "x"}
        if practice is not None:
            c["part_of_practice"] = practice
        return c

    safety = {"risk_cues": [cue(2, True), cue(4, False), cue(6, True, "possible")]}
    text = risk_cues_to_cover(safety, ASSESSED)
    assert text.startswith("turns 4. The important_moment card covers")
    assert "Separately, turns 2 are practised risk cues:" in text
    assert "no important_moment card" in text
    assert risk_cues_to_cover({"risk_cues": [cue(2, True)]}, ASSESSED).startswith(
        "turns 2. Cover each"
    )
    # Unflagged (null) cues keep the alarm even when the roleplay assesses.
    only_null = {"risk_cues": [cue(2)]}
    assert risk_cues_to_cover(only_null, ASSESSED) == risk_cues_to_cover(only_null)
    # Under alarm a stray flag changes nothing.
    flagged = {"risk_cues": [cue(2, True)]}
    assert risk_cues_to_cover(flagged) == risk_cues_to_cover(only_null)
    assert risk_cues_to_cover({}, ASSESSED) == "none"
    both = {"risk_cues": [cue(2, True), cue(2, False)]}
    assert risk_cues_to_cover(both, ASSESSED).startswith("turns 2. The important")


@pytest.mark.asyncio
async def test_safety_reader_asks_for_part_of_practice_only_when_assessed(
    dispatch_returns,  # noqa: F811
):
    from app.core.debrief.safety_reader import RiskCue, SafetyReading, read_safety

    cue = RiskCue(
        turn_index=2,
        quote="q",
        category="hopelessness",
        learner_response="explored",
        part_of_practice=True,
    )
    calls = dispatch_returns(SafetyReading(risk_cues=[cue]))
    out, _ = await read_safety(TRANSCRIPT, "en", model="m")
    assert "PRACTICE." not in calls["prompt"]
    assert out.risk_cues[0].part_of_practice is None
    cue.part_of_practice = True
    out, _ = await read_safety(
        TRANSCRIPT,
        "en",
        model="m",
        risk_cue=ASSESSED,
        scenario={"title": "Suicide prevention"},
        roleplay_expectations={"helpful_behaviours": ["Asks directly"]},
    )
    p = calls["prompt"]
    assert "This roleplay is designed to practise responding to risk cues" in p
    assert "set it false for any other risk cue" in p and "When unsure, false." in p
    assert "Suicide prevention" in p and "Asks directly" in p
    assert out.risk_cues[0].part_of_practice is True


@pytest.mark.asyncio
async def test_graph_part_of_practice_flows_through_the_state(closed):
    steps, gateway = fakes.FakeSteps(), fakes.FakeGateway()

    def cue(turn, flag):
        c = {
            "turn_index": turn,
            "quote": "x",
            "category": "hopelessness",
            "learner_response": "explored",
        }
        if flag is not None:
            c["part_of_practice"] = flag
        return c

    steps.answers["safety-reader"] = {"risk_cues": [cue(2, True)]}
    session = _session(risk_cue=ASSESSED)
    result = await fakes.run(steps, gateway, session=session)
    assert result["workspace"]["safety"]["risk_cues"][0]["part_of_practice"] is True
    assert (
        gateway.tools("run_checks")[0]["safety"]["risk_cues"][0]["part_of_practice"]
        is True
    )
    assert result["has_risk_cue"] is True and result["has_alarm_risk_cue"] is False
    body = {c["path"]: c["body"] for c in steps.calls}["safety-reader"]
    assert body["scenario"] and "roleplay_expectations" in body
    sent = gateway.tools("run_checks")[0]
    assert "assessed_categories" not in sent and "progress_supported" not in sent
    assert result["workspace"]["risk_cue"] == {
        "key": None,
        "handling": "assessed",
        "word_list_raises": True,
    }

    steps, gateway = fakes.FakeSteps(), fakes.FakeGateway()
    steps.answers["safety-reader"] = {"risk_cues": [cue(2, True), cue(4, False)]}
    result = await fakes.run(steps, gateway, session=_session(risk_cue=ASSESSED))
    assert result["has_alarm_risk_cue"] is True

    # Alarm: no flag asked for, no extra body keys, and every cue alarms.
    steps, gateway = fakes.FakeSteps(), fakes.FakeGateway()
    steps.answers["safety-reader"] = {"risk_cues": [cue(2, None)]}
    result = await fakes.run(steps, gateway)
    body = {c["path"]: c["body"] for c in steps.calls}["safety-reader"]
    assert "scenario" not in body and "risk_cue" not in body
    assert result["has_alarm_risk_cue"] is True


# --- progress claims are the Evaluator's job ------------------------------------


def test_progress_claims_text():
    from app.core.debrief.steps import progress_claims_text

    none = progress_claims_text(None)
    assert "PROGRESS (what the debrief may claim" in none and "\nnone\n" in none
    assert "report unsupported_progress_claim as a hard fail" in none
    assert "calling something a consistent strength" in none
    with_p = progress_claims_text({"items": [{"skill": "Empathy"}]})
    assert "<progress>" in with_p and "Empathy" in with_p


@pytest.mark.asyncio
async def test_evaluator_input_carries_progress(dispatch_returns):  # noqa: F811
    from app.core.debrief import steps

    calls = dispatch_returns(None)
    await steps.evaluate(
        TRANSCRIPT, "d", "en", "m", progress={"items": [{"skill": "Pacing"}]}
    )
    assert "<progress>" in calls["prompt"] and "Pacing" in calls["prompt"]
    assert "unsupported_progress_claim as a hard fail" in calls["prompt"]
    await steps.evaluate(TRANSCRIPT, "d", "en", "m")
    assert "PROGRESS (what the debrief may claim" in calls["prompt"]


@pytest.mark.asyncio
async def test_graph_sends_the_progress_reading_to_the_evaluator(closed):
    steps, gateway = fakes.FakeSteps(), fakes.FakeGateway()
    await fakes.run(steps, gateway)
    body = {c["path"]: c["body"] for c in steps.calls}["evaluator"]
    assert "progress" in body


def test_writer_default_says_progress_claims_need_progress():
    from app.core.debrief.steps import DEFAULT_WRITER_SYSTEM

    assert "consistent strength or pattern unless PROGRESS says so" in (
        DEFAULT_WRITER_SYSTEM.replace("\\\n", "").replace("\n", " ")
    )


# --- judge: neutral legend and the practice note ----------------------------------


def test_judge_neutral_replaces_the_legacy_legend_and_legacy_is_unchanged():
    from app.core.debrief_quality.prompt import DEFAULT_JUDGE_RUBRIC, build_judge_prompt

    t = [{"role": "client", "turn_index": 1, "text": "yo"}]
    legacy = build_judge_prompt(t, "d", "en")
    assert "AI_CLIENT is the AI, COUNSELLOR the trainee" in legacy
    assert "The COUNSELLOR is the human trainee" in legacy
    assert build_judge_prompt(t, "d", "en", speaker_labels="legacy") == legacy
    n = build_judge_prompt(t, "d", "en", speaker_labels="neutral")
    for word in ("AI_CLIENT", "COUNSELLOR"):
        assert word not in n
    assert "CHARACTER is the AI, LEARNER the trainee" in n
    assert "The LEARNER is the human trainee" in n
    assert "The CHARACTER is played by an AI" in n
    assert "[turn 1] CHARACTER: yo" in n
    assert "COUNSELLOR" in DEFAULT_JUDGE_RUBRIC  # the stored default is untouched
    custom = build_judge_prompt(
        t,
        "d",
        "en",
        rubric="{{transcript}}{{debrief}}{{risk_cue_definition}} " "COUNSELLOR",
        instructions="AI_CLIENT",
        speaker_labels="neutral",
    )
    assert "COUNSELLOR" not in custom and custom.endswith("CHARACTER")


def test_judge_note_says_roleplay_expectations_decide():
    from app.core.debrief_quality.prompt import build_judge_prompt

    exp = {"helpful_behaviours": ["Gives advice"]}
    p = build_judge_prompt([], "d", "en", roleplay_expectations=exp)
    assert (
        "the roleplay's expectations decide: following them is not a "
        "contradiction. An ORGANISATION PROTOCOL always applies." in p
    )
    assert "ORGANISATION PROTOCOL always applies" not in build_judge_prompt(
        [], "d", "en"
    )
