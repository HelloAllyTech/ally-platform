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
async def test_run_actor_evaluation_sends_traceback_on_exception(
    mock_evaluate_actor_goals, mock_send_webhook
):
    """
    Test that a generic exception during evaluation is caught and the traceback
    is included in the error message.
    This is the regression test for bug 1d275c1f-0188-470e-abac-59686bbcb96a.
    """
    error_message = "Something went wrong"
    mock_evaluate_actor_goals.side_effect = Exception(error_message)

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
    assert error_message in payload.error_message
    assert "traceback" in payload.error_message.lower()
    assert "evaluate_actor_goals" in payload.error_message
