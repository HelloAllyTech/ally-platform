"""Tests for the goal-based actor evaluator, focused on goal applicability.

The agent test cases are configured globally, so a session is scored against
goals it may have had no occasion to exercise. Marking those not-applicable is
what keeps an irrelevant goal from dragging the composite down.
"""

from unittest.mock import AsyncMock, patch

import pytest

from app.core.scenario_session_evaluation.evaluator import (
    ActorGoalEvaluationResult,
    build_actor_goal_system_prompt,
    evaluate_actor_goals,
)
from app.core.scenario_session_evaluation.schemas import (
    ActorEvaluationGoal,
    ActorEvaluationTurn,
)


def _goal(title, **overrides):
    defaults = {"id": f"id-{title}", "title": title, "category": "quality"}
    defaults.update(overrides)
    return ActorEvaluationGoal(**defaults)


def _transcript():
    return [
        ActorEvaluationTurn(role="user", content="hello"),
        ActorEvaluationTurn(role="assistant", content="hi there"),
    ]


class TestActorGoalEvaluationResult:
    def test_clamps_scores_into_range(self):
        result = ActorGoalEvaluationResult(metrics={"a": 140, "b": -20})
        assert result.metrics == {"a": 100, "b": 0}

    def test_not_applicable_defaults_to_empty(self):
        result = ActorGoalEvaluationResult(metrics={"a": 80})
        assert result.not_applicable == []


class TestApplicabilityPrompt:
    # Applicability must key off whether the situation arose, never off how the
    # actor performed — otherwise the judge excuses bad handling as "N/A" and
    # the composite silently inflates.
    def test_prompt_separates_opportunity_from_performance(self):
        prompt = build_actor_goal_system_prompt([_goal("Build rapport")])

        assert "NOT\nAPPLICABLE" in prompt or "NOT APPLICABLE" in prompt
        assert "handled badly IS applicable" in prompt
        assert "When in doubt, treat the goal as applicable." in prompt

    def test_prompt_asks_for_not_applicable_key(self):
        prompt = build_actor_goal_system_prompt([_goal("Build rapport")])

        assert '"not_applicable"' in prompt
        # Every goal stays in metrics so Roleplay Logs can still show it.
        assert "including any you mark not applicable" in prompt


class TestEvaluateActorGoals:
    @pytest.mark.asyncio
    async def test_passes_through_matching_not_applicable_titles(self):
        goals = [_goal("Build rapport"), _goal("De-escalate acute risk")]
        judged = ActorGoalEvaluationResult(
            metrics={"Build rapport": 82, "De-escalate acute risk": 10},
            not_applicable=["De-escalate acute risk"],
            report_markdown="# Report",
        )

        with patch(
            "app.core.scenario_session_evaluation.evaluator._build_evaluator_llm"
        ) as build:
            build.return_value.with_structured_output.return_value.ainvoke = AsyncMock(
                return_value=judged
            )
            result = await evaluate_actor_goals(_transcript(), goals)

        assert result["not_applicable"] == ["De-escalate acute risk"]
        # The score stays in metrics — it is excluded from the composite
        # downstream, not erased.
        assert result["metrics"]["De-escalate acute risk"] == 10

    @pytest.mark.asyncio
    async def test_drops_titles_matching_no_configured_goal(self):
        # The judge keys applicability by verbatim title; a paraphrase would
        # otherwise silently drop a goal from the composite. Unmatched titles
        # must fail toward "applicable" — the pre-existing behaviour.
        goals = [_goal("Build rapport")]
        judged = ActorGoalEvaluationResult(
            metrics={"Build rapport": 82},
            not_applicable=["Building rapport with the user"],
        )

        with patch(
            "app.core.scenario_session_evaluation.evaluator._build_evaluator_llm"
        ) as build:
            build.return_value.with_structured_output.return_value.ainvoke = AsyncMock(
                return_value=judged
            )
            result = await evaluate_actor_goals(_transcript(), goals)

        assert result["not_applicable"] == []

    @pytest.mark.asyncio
    async def test_empty_transcript_returns_the_full_shape(self):
        result = await evaluate_actor_goals([], [_goal("Build rapport")])

        assert result == {
            "metrics": {},
            "not_applicable": [],
            "report_markdown": "",
        }

    @pytest.mark.asyncio
    async def test_no_goals_returns_the_full_shape(self):
        result = await evaluate_actor_goals(_transcript(), [])

        assert result == {
            "metrics": {},
            "not_applicable": [],
            "report_markdown": "",
        }
