import logging
from unittest.mock import patch

import pytest

from app.core.events.coherence_guard import build_default_coherence_guardrail


@pytest.mark.parametrize(
    "exception", [ValueError, TypeError, RuntimeError, ImportError]
)
@patch("app.core.events.event_types.guardrail.guardrail_event.GuardrailEvent.create")
def test_build_default_coherence_guardrail_logs_warning_on_exception(
    mock_create, exception, caplog
):
    """
    This test is written to fail with the original code (which logs at ERROR level)
    and pass with the fixed code (which logs at WARNING level).
    """
    mock_create.side_effect = exception("Test exception")

    with caplog.at_level(logging.WARNING):
        result = build_default_coherence_guardrail(
            model="test-model", llm_base_url=None
        )

    assert result is None
    assert "failed to build the platform-default guardrail" in caplog.text
    assert "Test exception" in caplog.text
    # Check that it's a WARNING log, not an ERROR
    assert len(caplog.records) == 1
    assert caplog.records[0].levelname == "WARNING"
