from unittest.mock import AsyncMock, patch

import pytest

from app.core.scenario_session_evaluation.schemas import ActorEvaluationRequest
from app.core.scenario_session_evaluation.service import (
    ActorEvaluationWebhookPayload,
    run_actor_evaluation,
)


@pytest.mark.asyncio
async def test_run_actor_evaluation_logs_raw_response_on_key_error():
    """
    Given a malformed evaluation result that causes a KeyError, the service should
    log the raw LLM response and the exception traceback.
    """
    request = ActorEvaluationRequest(
        scenario_session_id="test-session-id",
        transcript=[{"role": "user", "content": "hello"}],
        goals=[{"id": "g1", "title": "Test Goal", "category": "quality"}],
    )
    raw_response_from_llm = (
        '{"some_other_key": "some_value", "report_markdown": "report"}'
    )

    with (
        patch(
            "app.core.scenario_session_evaluation.service.evaluate_actor_goals",
            new_callable=AsyncMock,
        ) as mock_evaluate,
        patch("app.core.scenario_session_evaluation.service.logger") as mock_logger,
        patch(
            "app.core.scenario_session_evaluation.service._send_webhook",
            new_callable=AsyncMock,
        ) as mock_send_webhook,
    ):

        # Simulate a successfully returned result from the evaluator that is
        # "malformed" for the service because it's missing an expected key.
        # This will cause a KeyError inside run_actor_evaluation.
        mock_evaluate.return_value = (
            # This is the `result` dict, missing the `metrics` key.
            {"not_applicable": [], "report_markdown": "report"},
            raw_response_from_llm,
        )

        await run_actor_evaluation(request)

        # Assert logging
        mock_logger.warning.assert_called_once()
        args, kwargs = mock_logger.warning.call_args

        expected_log_message = (
            "Actor evaluation failed for session=%s due to a missing key in the "
            "evaluation result. This is expected if the LLM judge returns a "
            "malformed response. Raw LLM response: %s"
        )
        assert args[0] == expected_log_message
        assert args[1] == request.scenario_session_id
        assert args[2] == raw_response_from_llm
        assert kwargs["exc_info"] is True

        # Assert webhook payload
        mock_send_webhook.assert_called_once()
        sent_payload = mock_send_webhook.call_args[0][1]
        assert sent_payload.status == "FAILED"
        assert (
            sent_payload.error_message
            == "Evaluation failed due to a missing key in the result."
        )
