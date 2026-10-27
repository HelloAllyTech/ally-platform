"""Prompts moved from inline code into the Skills Store still run on their defaults.

Production runs each prompt's live text from the store; the `.txt` default is a
minimal base a fresh clone runs on. These tests check the base keeps what the
code depends on (every placeholder its contract declares, the output literals
the parsers read) and that each call site renders it with every placeholder
filled. Store text still wins over the default.
"""

import re
from pathlib import Path

import pytest

from app.core.analytics_agent.prompt import (
    AgentTurn,
    build_answer_prompt,
    build_plan_prompt,
)
from app.core.analytics_agent.schemas import ChartType, PlanIntent
from app.core.helpline.prompt import nudge_instruction, risk_instruction
from app.prompts.contracts import PROMPT_CONTRACTS, available_variables
from app.prompts.resolver import load_and_format

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "app" / "prompts"
PLACEHOLDER = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")

MOVED = [
    "analytics/planner",
    "analytics/answer",
    "summary/condense_chunk",
    "audio/gemini_transcription",
    "helpline/copilot_nudge_requested",
    "helpline/copilot_risk_flagged",
]


def _code(path: str) -> str:
    return f"ally_ai_{path.replace('/', '_')}"


def _default(path: str) -> str:
    return (PROMPTS_DIR / f"{path}.txt").read_text(encoding="utf-8")


@pytest.mark.parametrize("path", MOVED)
def test_default_uses_exactly_the_declared_placeholders(path):
    code = _code(path)
    assert code in PROMPT_CONTRACTS
    declared = {variable["name"] for variable in available_variables(code)}
    assert set(PLACEHOLDER.findall(_default(path))) == declared


# The literals each parser or schema reads from the answer.
MARKERS = {
    "analytics/planner": [f'intent="{intent.value}"' for intent in PlanIntent]
    + ["`sql`", "`rationale`", "`message`", "LIMIT"],
    "analytics/answer": ["`answer`", "`caveats`", "`chart`", "`follow_ups`"]
    + [chart.value for chart in ChartType],
    "audio/gemini_transcription": ["seconds", "empty list of segments"],
    "helpline/copilot_nudge_requested": ["`nudge`"],
    "helpline/copilot_risk_flagged": ["tagged harm"],
}


@pytest.mark.parametrize("path", sorted(MARKERS))
def test_default_keeps_the_literals_the_code_parses(path):
    default = _default(path)
    missing = [marker for marker in MARKERS[path] if marker not in default]
    assert not missing, f"{path}: the default lost {missing}"


def _assert_filled(text: str) -> None:
    assert text.strip()
    assert not PLACEHOLDER.findall(text), "an unfilled placeholder reached the model"


HISTORY = [
    AgentTurn(question="sessions last month?", sql="SELECT 1 LIMIT 1", answer="12")
]


@pytest.mark.parametrize("history", [None, HISTORY])
def test_planner_default_renders_every_input(history):
    text = build_plan_prompt(
        "How many sessions ran last week?",
        schema_catalog="TABLE scenario_sessions\n  COLUMNS: id uuid",
        today="2026-10-26",
        row_limit=500,
        history=history,
        prompts={},
    )
    _assert_filled(text)
    for value in (
        "How many sessions ran last week?",
        "TABLE scenario_sessions",
        "2026-10-26",
        "500",
    ):
        assert value in text
    assert ("sessions last month?" in text) == bool(history)


@pytest.mark.parametrize("history", [None, HISTORY])
def test_answer_default_renders_every_input(history):
    text = build_answer_prompt(
        "How many sessions per week?",
        sql="SELECT COUNT(*) AS n FROM t LIMIT 5",
        columns=["n"],
        rows_csv="n\n12",
        row_count=1,
        truncated=False,
        history=history,
        prompts={},
    )
    _assert_filled(text)
    for value in ("How many sessions per week?", "SELECT COUNT(*) AS n", "columns: n"):
        assert value in text
    assert ("sessions last month?" in text) == bool(history)


def test_condense_default_renders_every_input():
    text = load_and_format(
        "summary/condense_chunk",
        prompts={},
        part_number=2,
        part_count=3,
        chunk="Client: hi",
    )
    _assert_filled(text)
    assert "2/3" in text and "Client: hi" in text


def test_helpline_defaults_render():
    _assert_filled(nudge_instruction(True, prompts={}))
    flagged = risk_instruction("HIGH", "OTHER", prompts={})
    _assert_filled(flagged)
    assert "high, about someone else the talker knows" in flagged
    # The "not asked" / "not flagged" sentences stay in code.
    assert nudge_instruction(False, prompts={}) == "Leave `nudge` as an empty string."
    assert "has not flagged" in risk_instruction("NONE", "SELF", prompts={})


def test_store_text_wins_over_the_default():
    prompts = {
        "ally_ai_helpline_copilot_risk_flagged": {"prompt": "FLAGGED {level}{about}"},
        "ally_ai_helpline_copilot_nudge_requested": {"prompt": "NUDGE NOW"},
        "ally_ai_analytics_answer": {"prompt": "A {question} | {result_block}"},
        "ally_ai_analytics_planner": {"prompt": "P {question} {row_limit}"},
        "ally_ai_summary_condense_chunk": {"prompt": "C {part_number} {chunk}"},
    }
    assert risk_instruction("HIGH", "OTHER", prompts=prompts) == (
        "FLAGGED high, about someone else the talker knows"
    )
    assert nudge_instruction(True, prompts=prompts) == "NUDGE NOW"
    assert build_plan_prompt(
        "q?", schema_catalog="t", today="d", row_limit=7, prompts=prompts
    ) == ("P q? 7")
    assert build_answer_prompt(
        "q?",
        sql="s",
        columns=["n"],
        rows_csv="n\n1",
        row_count=1,
        truncated=False,
        prompts=prompts,
    ) == ("A q? | columns: n\nrows returned: 1\nn\n1\n")
    assert (
        load_and_format(
            "summary/condense_chunk",
            prompts=prompts,
            part_number=1,
            part_count=2,
            chunk="x",
        )
        == "C 1 x"
    )
