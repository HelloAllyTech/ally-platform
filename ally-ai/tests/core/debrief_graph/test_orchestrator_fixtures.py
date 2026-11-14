"""The planner's wiring over the synthetic planner cases
(`docs/debrief-harness/fixtures/orchestrator/planner_cases.json`, no production
data): for each planted session, code offers the planner exactly the agents
whose `available` holds, the planner reads the signal the right choice rests on
(profile and the Analyst's evidence summary, never the transcript), and the
chosen agents run; protocol_check's expected findings survive the quote check
with their protocol named.

The planner here is a fake that follows each agent's `use_when` literally, so
these tests check the wiring, not the planner model's judgement — that is the
offline eval's job, on the same file.
"""

import json
from pathlib import Path

import pytest

from app.core.debrief_graph import circuit
from tests.core.debrief_graph.fakes import (
    CONTEXT,
    SESSION,
    FakeGateway,
    FakeSteps,
    orchestrated_bundle,
    run,
)

pytestmark = pytest.mark.asyncio

FIXTURES = (
    Path(__file__).resolve().parents[4]
    / "docs/debrief-harness/fixtures/orchestrator/planner_cases.json"
)
DATA = json.loads(FIXTURES.read_text(encoding="utf-8"))
CASES = {c["id"]: c for c in DATA["cases"]}


@pytest.fixture(autouse=True)
def closed_circuits():
    circuit.reset_model_circuits()
    yield
    circuit.reset_model_circuits()


def use_when_planner(body):
    """Chooses as the manifests' use_when reads, from what the planner is sent."""
    p, ev = body["profile"], body["evidence_summary"]
    offered = {a["id"] for a in body["agents"]}
    moments = [m["turn"] for m in ev["pivotal_moments"]]
    actions = []
    if "protocol_check" in offered and (p["risk_cue_turns"] or moments):
        actions.append(("protocol_check", p["risk_cue_turns"] or moments))
    if "history_deep" in offered and ev["skills"]["missed"]:
        actions.append(("history_deep", []))
    if "language_specialist" in offered and (p["code_mixed"] or p["script_mismatch"]):
        actions.append(("language_specialist", moments))
    chosen = {a for a, _ in actions}
    return {
        "plan": {
            "actions": [
                {"agent": a, "why": "use_when holds", "focus_turns": turns}
                for a, turns in actions
            ],
            "considered": [
                {"agent": a, "why_not": "use_when does not hold"}
                for a in sorted(offered - chosen)
            ],
        },
        "reasoning": "Followed use_when.",
    }


def history(case):
    by_date = {}
    for p in case["inputs"]["past_work_on_this"]:
        by_date.setdefault(p["date"], []).append({"skill": p["skill"]})
    return {
        "sessions": [{"date": d, "work_on_this": w} for d, w in sorted(by_date.items())]
    }


async def run_case(case):
    steps, gateway = FakeSteps(), FakeGateway()
    steps.answers["safety-reader"] = case["safety"]
    steps.answers["analyst"] = {"evidence": case["evidence"], "reasoning": ""}
    steps.answers["planner"] = use_when_planner
    steps.answers["agent-protocol-check"] = {
        "findings": (case.get("expectedFindings") or {}).get("protocol_check", []),
        "reasoning": "",
    }
    gateway.answers["get_org_protocols"] = {
        "protocols": DATA["organisation"]["protocols"],
        "procedures": None,
    }
    gateway.answers["get_learner_history"] = history(case)
    result = await run(
        steps,
        gateway,
        bundle=orchestrated_bundle(),
        session={**SESSION, **case["session"]},
        transcript=case["transcript"],
        inputs={**CONTEXT, **case["inputs"]},
    )
    planner_body = next(c["body"] for c in steps.calls if c["path"] == "planner")
    return result, planner_body, steps


@pytest.mark.parametrize("case_id", sorted(CASES))
async def test_the_right_agents_are_offered_chosen_and_run(case_id):
    case = CASES[case_id]
    exp = case["expected"]
    result, body, steps = await run_case(case)

    offered = {a["id"] for a in body["agents"]}
    assert set(exp["offered"]) <= offered
    assert offered.isdisjoint(exp["notOffered"])

    plan = next(p for p in result["workspace"]["plans"] if p["phase"] == "plan")
    chosen = {c["agent"] for c in plan["chosen"]}
    assert set(exp["choose"]) <= chosen
    assert chosen.isdisjoint(exp["never"])
    ran = {s["step"] for s in result["steps"] if s["status"] == "done"}
    assert set(exp["choose"]) <= ran
    assert steps.count("analyst") == 1  # the floor, every non-Short session

    # The planner read the signal, never the session's words.
    sent = json.dumps(body, ensure_ascii=False)
    for turn in case["transcript"]:
        assert turn["text"] not in sent
    assert plan["evidenceSummary"] == body["evidence_summary"]


@pytest.mark.parametrize(
    "case_id",
    sorted(
        c for c in CASES if "protocol_check" in (CASES[c].get("expectedFindings") or {})
    ),
)
async def test_protocol_check_findings_name_the_protocol_and_keep_their_quotes(
    case_id,
):
    case = CASES[case_id]
    result, body, _ = await run_case(case)
    got = result["workspace"]["findings"]["protocol_check"]
    assert got["droppedQuotes"] == 0
    expected = case["expectedFindings"]["protocol_check"]
    assert [
        (f["kind"], f["turnIndex"], f["quote"], f["source"]) for f in got["findings"]
    ] == [(f["kind"], f["turnIndex"], f["quote"], f["source"]) for f in expected]
    # The planner saw the risk turn (when there is one) and the protocols' count.
    assert body["profile"]["org_protocols"] == 2
    assert body["profile"]["risk_cue_turns"] == [
        c["turn_index"] for c in case["safety"]["risk_cues"]
    ]


async def test_language_cases_carry_the_language_signal():
    _, hinglish, _ = await run_case(CASES["language_hinglish_romanised"])
    assert hinglish["profile"]["indic"] is True
    assert hinglish["profile"]["script_mismatch"] is True
    _, mixed, _ = await run_case(CASES["language_code_mixed_devanagari"])
    assert mixed["profile"]["code_mixed"] is True


async def test_history_case_carries_the_repeated_miss():
    _, body, _ = await run_case(CASES["history_repeated_miss"])
    assert body["profile"]["past_debriefs"] == 4
    assert body["evidence_summary"]["skills"]["missed"] == ["reflecting feelings"]
