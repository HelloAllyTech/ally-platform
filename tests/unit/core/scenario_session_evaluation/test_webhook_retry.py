from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.core.scenario_session_evaluation.schemas import ActorEvaluationWebhookPayload
from app.core.scenario_session_evaluation.service import _send_webhook


class AsyncContextManagerMock:
    def __init__(self, mock_client):
        self.mock_client = mock_client

    async def __aenter__(self):
        return self.mock_client

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        pass


@pytest.mark.asyncio
async def test_send_webhook_retries_on_502():
    """
    Verify that _send_webhook retries on 502 errors and eventually succeeds.
    """
    mock_response_502 = httpx.Response(
        502, request=httpx.Request("PATCH", "http://test")
    )
    mock_response_200 = httpx.Response(
        200, request=httpx.Request("PATCH", "http://test")
    )

    mock_client = AsyncMock()
    mock_client.patch.side_effect = [
        httpx.HTTPStatusError(
            "Server Error",
            request=mock_response_502.request,
            response=mock_response_502,
        ),
        httpx.HTTPStatusError(
            "Server Error",
            request=mock_response_502.request,
            response=mock_response_502,
        ),
        mock_response_200,
    ]

    payload = ActorEvaluationWebhookPayload(status="COMPLETED")

    with (
        patch("httpx.AsyncClient", return_value=AsyncContextManagerMock(mock_client)),
        # The backoff is real seconds; the test only cares that it retries.
        patch(
            "app.core.scenario_session_evaluation.service.asyncio.sleep",
            new_callable=AsyncMock,
        ),
    ):
        await _send_webhook("test-session-id", payload)

    assert mock_client.patch.call_count == 3
