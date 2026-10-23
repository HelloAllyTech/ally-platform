from unittest.mock import AsyncMock, patch

import pytest

from app.core.scenario_session_evaluation.schemas import (
    ActorEvaluationGoal,
    ActorEvaluationRequest,
    ActorEvaluationTurn,
)
from app.core.scenario_session_evaluation.service import run_actor_evaluation


@pytest.mark.asyncio
@patch(
    "app.core.scenario_session_evaluation.service._send_webhook", new_callable=AsyncMock
)
@patch("app.core.scenario_session_evaluation.service.evaluate_actor_goals")
async def test_run_actor_evaluation_handles_key_error(
    mock_evaluate_actor_goals, mock_send_webhook
):
    mock_evaluate_actor_goals.side_effect = KeyError("actor_id")

    request = ActorEvaluationRequest(
        scenario_session_id="test_session_id",
        transcript=[ActorEvaluationTurn(role="user", content="Hello")],
        goals=[ActorEvaluationGoal(id="1", title="Test Goal", category="Test")],
    )

    await run_actor_evaluation(request)

    mock_send_webhook.assert_called_once()
    args, _ = mock_send_webhook.call_args
    payload = args[1]
    assert payload.status == "FAILED"
    assert (
        "Evaluation failed due to a missing key in the result." in payload.error_message
    )
