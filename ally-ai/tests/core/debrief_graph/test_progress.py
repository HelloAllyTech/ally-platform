"""Learner progress (PROGRESS_CONTRACT §2): the code vetoes on synthetic
histories, the Writer's legacy reading, the learner's card, the response, and
the graph's routing with and without a progress profile."""

import copy

import pytest

from app.core.debrief.schemas import (
    DebriefCards,
    DebriefCardsReasoned,
    ProgressCard,
    ProgressReportReasoned,
)
from app.core.debrief_graph import circuit
from app.core.debrief_graph.progress import (
    analyst_versions,
    progress_card,
    response_record,
    writer_reading,
)
from app.core.debrief_graph.progress_vetoes import apply_vetoes, skill_key
from tests.core.debrief_graph.fakes import (
    CONTEXT,
    PROGRESS_PROFILE,
    PROGRESS_REPORT,
    FakeGateway,
    FakeSteps,
    names,
    obs,
    run,
)

# --- synthetic histories ----------------------------------------------------------


def profile(empathy, fhs=None, **settings):
    p = copy.deepcopy(PROGRESS_PROFILE)
    p["skills"] = {"empathy": empathy}
    p["fhs"] = fhs
    p["settings"].update(settings)
    return p


def claim(trend="more_consistent", skill="empathy", evidence=None):
    return {
        "skills": [
            {
                "skill": skill,
                "trend": trend,
                "why": "Because.",
                "evidence": evidence or [{"run_id": "r-3", "turn_index": 3}],
                "fhs": "absent",
                "learner_line": "You stayed with the feeling more often.",
            }
        ],
        "followups": [],
        "focus": None,
        "shown_as": "line",
    }


def this_session(observation):
    """This session's evidence map: the Analyst's name for empathy."""
    return {
        "behaviours": [
            {
                "skill": "Empathy, warmth and genuineness",
                "opportunity": True,
                "observation": observation,
                "confidence": "high",
                "importance": 3,
                "turn_index": 5,
                "note": "x",
            }
        ]
    }


RISING = [
    obs("r-1", "2026-11-01", "missed"),
    obs("r-2", "2026-11-02", "partial"),
    obs("r-3", "2026-11-03", "observed"),
]
FLAT = [
    obs("r-1", "2026-11-01", "partial"),
    obs("r-2", "2026-11-02", "partial"),
    obs("r-3", "2026-11-03", "partial"),
]
FALLING = [
    obs("r-1", "2026-11-01", "observed"),
    obs("r-2", "2026-11-02", "observed"),
    obs("r-3", "2026-11-03", "partial"),
]


def vetoed(report, prof, evidence=None):
    out, vetoes = apply_vetoes(report, prof, evidence or this_session("observed"))
    return out, [v["veto"] for v in vetoes]


class TestVetoes:
    def test_a_clean_rising_history_keeps_its_trend(self):
        out, codes = vetoed(claim(), profile(RISING))
        assert codes == []
        skill = out["skills"][0]
        assert skill["trend"] == "more_consistent"
        assert skill["learner_line"]
        assert skill["hidden_from_learner"] is False

    def test_flat_history_about_the_same_is_kept(self):
        out, codes = vetoed(
            claim("about_the_same"), profile(FLAT), this_session("partial")
        )
        assert codes == [] and out["skills"][0]["trend"] == "about_the_same"

    def test_flat_history_claimed_better_is_not_contradicted(self):
        # Flat is not "clearly worse": the analyst veto needs a fall.
        _, codes = vetoed(claim(), profile(FLAT), this_session("partial"))
        assert "contradicted_by_analyst" not in codes

    def test_falling_history_claimed_better_is_contradicted_by_the_analyst(self):
        out, codes = vetoed(claim(), profile(FALLING), this_session("missed"))
        assert codes == ["contradicted_by_analyst"]
        skill = out["skills"][0]
        assert skill["trend"] == "too_early" and skill["learner_line"] == ""

    def test_rising_history_claimed_worse_is_contradicted_by_the_analyst(self):
        _, codes = vetoed(claim("worth_another_look"), profile(RISING))
        assert codes == ["contradicted_by_analyst"]

    def test_too_few_sessions(self):
        _, codes = vetoed(claim(), profile(RISING[1:]), {"behaviours": []})
        assert codes == ["too_few_sessions"]

    def test_this_session_counts_towards_three(self):
        _, codes = vetoed(claim(), profile(RISING[1:]), this_session("observed"))
        assert codes == []

    def test_sessions_without_an_opportunity_do_not_count(self):
        history = [
            obs("r-1", "2026-11-01", "missed", opp=False),
            obs("r-2", "2026-11-02", "partial"),
        ]
        _, codes = vetoed(claim(), profile(history), {"behaviours": []})
        assert codes == ["too_few_sessions"]

    def test_a_corrected_observation_is_not_counted(self):
        history = [
            obs("r-1", "2026-11-01", "missed", corrected=True),
            obs("r-2", "2026-11-02", "partial"),
            obs("r-3", "2026-11-03", "observed"),
        ]
        _, codes = vetoed(claim(), profile(history), {"behaviours": []})
        assert codes == ["too_few_sessions"]

    def test_citing_a_corrected_observation(self):
        history = RISING + [obs("r-4", "2026-11-04", "observed", corrected=True)]
        _, codes = vetoed(
            claim(evidence=[{"run_id": "r-4", "turn_index": 3}]), profile(history)
        )
        assert codes == ["corrected_evidence"]

    def test_fhs_disagreeing(self):
        fhs = {
            "empathy": [
                {"date": "2026-11-01", "session_id": "s-1", "level": 3},
                {"date": "2026-11-03", "session_id": "s-3", "level": 2},
            ]
        }
        _, codes = vetoed(claim(), profile(RISING, fhs=fhs))
        assert codes == ["contradicted_by_fhs"]

    def test_fhs_is_skipped_when_off_or_absent(self):
        fhs = {
            "empathy": [
                {"date": "2026-11-01", "session_id": "s-1", "level": 3},
                {"date": "2026-11-03", "session_id": "s-3", "level": 2},
            ]
        }
        assert vetoed(claim(), profile(RISING, fhs=fhs, useFhs=False))[1] == []
        assert vetoed(claim(), profile(RISING, fhs=None))[1] == []

    def test_version_change_where_the_trend_does_not_hold_within_the_newest(self):
        history = [
            obs("r-1", "2026-11-01", "missed", version=1),
            obs("r-2", "2026-11-02", "observed", version=2),
            obs("r-3", "2026-11-03", "observed", version=2),
        ]
        out, codes = vetoed(claim(), profile(history), this_session("partial"))
        # Rising only because version 1 read lower; within v2: observed,
        # observed, partial is not rising.
        assert codes == ["version_straddle"]
        assert out["skills"][0]["trend"] == "too_early"

    def test_version_change_where_the_trend_holds_within_the_newest(self):
        history = [
            obs("r-1", "2026-11-01", "missed", version=1),
            obs("r-2", "2026-11-02", "missed", version=2),
            obs("r-3", "2026-11-03", "partial", version=2),
        ]
        _, codes = vetoed(claim(), profile(history), this_session("observed"))
        assert codes == []

    def test_other_is_never_trended(self):
        out, codes = vetoed(claim(skill="pacing"), profile(RISING))
        assert codes == ["other_skill"]
        assert out["skills"][0]["trend"] == "too_early"

    def test_worse_is_hidden_from_learners_by_default_not_vetoed(self):
        out, codes = vetoed(
            claim("worth_another_look"), profile(FALLING), this_session("missed")
        )
        assert codes == []
        skill = out["skills"][0]
        assert skill["trend"] == "worth_another_look"
        assert skill["learner_line"] == ""
        assert skill["hidden_from_learner"] is True

    def test_worse_is_shown_when_the_organisation_allows_it(self):
        out, _ = vetoed(
            claim("worth_another_look"),
            profile(FALLING, showWorseToLearners=True),
            this_session("missed"),
        )
        assert out["skills"][0]["learner_line"]
        assert out["skills"][0]["hidden_from_learner"] is False

    def test_names_map_to_keys_and_at_most_three_skills(self):
        report = claim(skill="Empathy, warmth and genuineness")
        report["skills"] *= 5
        out, _ = vetoed(report, profile(RISING))
        assert len(out["skills"]) == 3
        assert {s["skill"] for s in out["skills"]} == {"empathy"}
        assert skill_key("Explore the client’s explanation for the problem") == (
            "explanation"
        )

    def test_shown_as_follows_card_due(self):
        report = claim()
        report["shown_as"] = "card"
        p = profile(RISING)
        p["card_due"] = False
        assert vetoed(report, p)[0]["shown_as"] == "line"
        p["card_due"] = True
        report["shown_as"] = "line"
        assert vetoed(report, p)[0]["shown_as"] == "card"

    def test_the_input_report_is_not_mutated(self):
        report = claim(skill="pacing")
        apply_vetoes(report, profile(RISING), {"behaviours": []})
        assert report["skills"][0]["trend"] == "more_consistent"


# --- the Writer's reading, the card, the response ---------------------------------


class TestWriterReading:
    def test_maps_trends_and_follow_ups(self):
        report, _ = apply_vetoes(PROGRESS_REPORT, PROGRESS_PROFILE, {"behaviours": []})
        reading = writer_reading(report, PROGRESS_PROFILE)
        assert reading == {
            "items": [
                {
                    "skill": "Empathy, warmth and genuineness",
                    "trend": "more_consistent",
                    "evidence": "Missed, then partial, then observed twice.",
                    "follows_up_point": "Name the feeling you hear.",
                }
            ]
        }

    def test_hidden_worse_reads_as_about_the_same_with_no_reason(self):
        out, _ = apply_vetoes(
            claim("worth_another_look"), profile(FALLING), this_session("missed")
        )
        (item,) = writer_reading(out, PROGRESS_PROFILE)["items"]
        assert item["trend"] == "about_the_same" and item["evidence"] == ""

    def test_shown_worse_passes_through(self):
        out, _ = apply_vetoes(
            claim("worth_another_look"),
            profile(FALLING, showWorseToLearners=True),
            this_session("missed"),
        )
        (item,) = writer_reading(out, PROGRESS_PROFILE)["items"]
        assert item["trend"] == "worth_another_look"

    def test_a_vetoed_trend_is_too_early_with_no_reason(self):
        out, _ = apply_vetoes(claim(), profile(FALLING), this_session("missed"))
        (item,) = writer_reading(out, PROGRESS_PROFILE)["items"]
        assert item == {
            "skill": "Empathy, warmth and genuineness",
            "trend": "too_early",
            "evidence": "",
            "follows_up_point": None,
        }

    def test_nothing_for_the_writer(self):
        assert writer_reading({"skills": []}, PROGRESS_PROFILE) is None


class TestCard:
    def report(self, **changes):
        out, _ = apply_vetoes(PROGRESS_REPORT, PROGRESS_PROFILE, {"behaviours": []})
        out.update(changes)
        return out

    def test_the_card_when_due(self):
        card = progress_card(self.report(), PROGRESS_PROFILE)
        assert card == {
            "sessions": 4,
            "skills": [
                {
                    "skill": "empathy",
                    "trend": "more_consistent",
                    "line": "You named the client's feelings more often lately.",
                }
            ],
            "focus": {"skill": "harm", "line": "Next time, ask gently about safety."},
        }
        ProgressCard.model_validate(card)

    def test_no_card_when_shown_as_a_line(self):
        assert progress_card(self.report(shown_as="line"), PROGRESS_PROFILE) is None

    def test_no_card_with_nothing_to_show(self):
        out, _ = apply_vetoes(claim("too_early"), PROGRESS_PROFILE, {"behaviours": []})
        assert progress_card(out, PROGRESS_PROFILE) is None

    def test_blank_lines_are_left_out(self):
        out, _ = apply_vetoes(
            {**claim("worth_another_look"), "focus": PROGRESS_REPORT["focus"]},
            profile(FALLING),
            this_session("missed"),
        )
        card = progress_card(out, PROGRESS_PROFILE)
        assert card["skills"] == [] and card["focus"]["skill"] == "harm"

    def test_the_response_record(self):
        report = self.report()
        record = response_record(report, [], PROGRESS_PROFILE, "progress-m")
        assert record == {
            "report": report,
            "vetoes": [],
            "shown_as": "card",
            "model": "progress-m",
            "window_session_ids": ["s-3", "s-2", "s-1"],
            "analyst_versions": [2],
        }
        p = {**PROGRESS_PROFILE, "sessions": [{"analyst_version": 1}]}
        assert analyst_versions(p) == [1, 2]


class TestCardsSchema:
    def test_the_writer_is_never_asked_for_the_card(self):
        for schema in (DebriefCards, DebriefCardsReasoned):
            assert "progress_card" not in schema.model_json_schema()["properties"]

    def test_a_written_card_never_carries_one(self):
        cards = DebriefCards(opening="Hi")
        assert "progress_card" not in cards.model_dump()

    def test_the_agent_schema_has_the_contract_fields(self):
        props = ProgressReportReasoned.model_json_schema()["properties"]
        assert set(props) == {"skills", "followups", "focus", "shown_as", "reasoning"}


# --- the graph -------------------------------------------------------------------


@pytest.fixture(autouse=True)
def closed_circuits():
    circuit.reset_model_circuits()
    yield
    circuit.reset_model_circuits()


@pytest.mark.asyncio
class TestGraphRouting:
    async def test_with_a_profile_the_agent_runs_and_the_card_is_attached(self):
        steps, gateway = FakeSteps(), FakeGateway()
        result = await run(steps, gateway)

        assert result["status"] == "published"
        assert steps.count("progress-agent") == 1
        assert steps.count("progress-reader") == 0
        assert "progress_reader:done" in names(result)
        body = [c for c in steps.calls if c["path"] == "progress-agent"][0]["body"]
        assert "transcript" not in body
        assert body["profile"]["session_number"] == 5
        # The Writer reads the legacy shape, derived from the vetoed report.
        writer = [c for c in steps.calls if c["path"] == "writer"][0]["body"]
        assert writer["progress"]["items"][0]["trend"] == "more_consistent"
        assert set(writer["progress"]["items"][0]) == {
            "skill",
            "trend",
            "evidence",
            "follows_up_point",
        }
        # The checks see the Writer's cards only.
        assert all(
            "progress_card" not in c["cards"] for c in gateway.tools("run_checks")
        )
        assert result["cards"]["progress_card"]["sessions"] == 4
        assert result["cards"]["point_ids"] is True  # finalised, then attached
        progress = result["progress"]
        assert set(progress) == {
            "report",
            "vetoes",
            "shown_as",
            "model",
            "window_session_ids",
            "analyst_versions",
        }
        assert progress["shown_as"] == "card"
        assert progress["model"] == "progress-m"
        assert progress["report"]["reasoning"] == "Empathy rose across the window."
        veto_log = [e for e in result["logs"] if e["step"] == "progress_vetoes"]
        assert len(veto_log) == 1 and veto_log[0]["output"]["vetoes"] == []

    async def test_a_vetoed_trend_never_reaches_the_card(self):
        steps, gateway = FakeSteps(), FakeGateway()
        report = copy.deepcopy(PROGRESS_REPORT)
        report["skills"][0]["skill"] = "pacing"
        steps.answers["progress-agent"] = {"report": report, "reasoning": ""}
        result = await run(steps, gateway)

        assert [v["veto"] for v in result["progress"]["vetoes"]] == ["other_skill"]
        assert result["cards"]["progress_card"]["skills"] == []
        assert result["cards"]["progress_card"]["focus"]["skill"] == "harm"

    async def test_no_card_when_not_due(self):
        steps, gateway = FakeSteps(), FakeGateway()
        inputs = {
            **CONTEXT,
            "progress_profile": {**PROGRESS_PROFILE, "card_due": False},
        }
        result = await run(steps, gateway, inputs=inputs)
        assert "progress_card" not in result["cards"]
        assert result["progress"]["shown_as"] == "line"

    @pytest.mark.parametrize(
        "profile",
        [None, {**PROGRESS_PROFILE, "sessions": []}],
    )
    async def test_without_history_the_step_is_skipped(self, profile):
        steps, gateway = FakeSteps(), FakeGateway()
        result = await run(
            steps, gateway, inputs={**CONTEXT, "progress_profile": profile}
        )
        assert result["status"] == "published"
        assert steps.count("progress-agent") == 0
        record = next(s for s in result["steps"] if s["step"] == "progress_reader")
        assert record["status"] == "skipped" and record["note"] == "no history"
        assert "progress" not in result
        assert "progress_card" not in result["cards"]
        writer = [c for c in steps.calls if c["path"] == "writer"][0]["body"]
        assert writer["progress"] is None

    async def test_a_failed_agent_never_fails_the_run(self):
        steps, gateway = FakeSteps(), FakeGateway()
        steps.fail["progress-agent"] = "always"
        result = await run(steps, gateway)
        assert result["status"] == "published"
        assert result["fallback_rung"] >= 2
        assert "progress" not in result
        assert "progress_card" not in result["cards"]


# --- the step ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_agent_reads_the_profile_never_the_transcript(monkeypatch):
    from app.core.debrief.schemas import ProgressSkill
    from app.core.debrief.steps import DEFAULT_PROGRESS_SYSTEM, read_progress_report
    from app.core.llm import dispatch

    calls = {}

    async def fake(**kwargs):
        calls.update(kwargs)
        skill = ProgressSkill(
            skill="empathy", trend="too_early", why="", fhs="absent", learner_line=""
        )
        return ProgressReportReasoned(skills=[skill] * 5), {"model": "m"}

    monkeypatch.setattr(dispatch, "generate_structured", fake)
    out, ran = await read_progress_report(
        this_session("observed"),
        {**PROGRESS_PROFILE, "card_due": True},
        {"empathy": {"name": "Empathy"}},
        "hi",
        "progress-m",
    )
    assert ran == "m" and len(out.skills) == 3
    prompt = calls["prompt"]
    assert prompt.startswith(DEFAULT_PROGRESS_SYSTEM)
    assert "CARD DUE: yes" in prompt
    assert "Devanagari" in prompt
    assert "empathy = Empathy, warmth and genuineness" in prompt
    assert "<learner_profile>" in prompt and "<transcript>" not in prompt
    assert calls["model"] == "progress-m" and calls["never_fallback"] is True
