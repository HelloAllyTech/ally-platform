"""Shared test fixtures and configuration."""

import os

import pytest

# CRITICAL: Set environment variables at MODULE LEVEL before any app imports
# This ensures they are set before Settings class is instantiated
_original_env_vars = {}


def _set_test_env_vars():
    """Set all required environment variables for testing."""
    test_env_vars = {
        # Slack settings
        "SLACK_ALERTS_API_TOKEN": "test-slack-token",
        "SLACK_ALERTS_CHANNEL_ID": "test-channel-id",
        # LiveKit settings
        "LIVEKIT_LOG_LEVEL": "INFO",
        "LIVEKIT_API_KEY": "test-livekit-key",
        "LIVEKIT_API_SECRET": "test-livekit-secret",
        "LIVEKIT_URL": "wss://test.livekit.cloud",
        # OpenAI settings
        "OPENAI_API_KEY": "test-openai-key",
        # Deepgram settings
        "DEEPGRAM_API_KEY": "test-deepgram-key",
        # AWS settings
        "AWS_ACCESS_KEY_ID": "test-aws-access-key",
        "AWS_SECRET_ACCESS_KEY": "test-aws-secret-key",
        "SQS_MESSAGE_EVENT_QUEUE_NAME": "test-queue",
        # Voice API settings
        "ELEVEN_API_KEY": "test-eleven-key",
        "SARVAM_API_KEY": "test-sarvam-key",
        "HUME_API_KEY": "test-hume-key",
        "CARTESIA_API_KEY": "test-cartesia-key",
        "SMALLEST_API_KEY": "test-smallest-key",
        # LLM settings
        "LLM_TEMPERATURE": "0.7",
        # Voice model settings
        "DEFAULT_MALE_VOICE_MODEL": "test-male-voice",
        "DEFAULT_FEMALE_VOICE_MODEL": "test-female-voice",
        "DEFAULT_NON_BINARY_VOICE_MODEL": "test-nonbinary-voice",
        # Core service settings
        "CORE_SERVICE_BASE_URL": "https://test.core-service.local",
        "CORE_SERVICE_API_KEY": "test-core-service-api-key",
        "SYNC_PROMPTS_TO_LOCAL": "True",
    }

    # Set environment variables and store originals
    for key, value in test_env_vars.items():
        if key not in _original_env_vars:
            _original_env_vars[key] = os.environ.get(key)
        os.environ[key] = value


# Set test environment variables immediately when conftest is imported
_set_test_env_vars()

# Now safe to import other modules
import json  # noqa: E402
from typing import Any, Dict  # noqa: E402
from unittest.mock import AsyncMock, patch  # noqa: E402


# Cleanup fixture to restore environment variables
@pytest.fixture(scope="session", autouse=True)
def cleanup_env_vars():
    """Restore original environment variables after all tests complete."""
    yield  # All tests run here

    # Restore original environment variables
    for key, original_value in _original_env_vars.items():
        if original_value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = original_value


# Test data fixtures
@pytest.fixture
def sample_room_metadata() -> Dict[str, Any]:
    """Sample room metadata for testing."""
    return {
        "version": "1.0",
        "scenario": {
            "title": "Test Scenario",
            "description": "A test learning scenario",
            "metadata": {"key": "value"},
            "voice": {
                "name": "test_voice",
                "provider": "deepgram",
                "config": {
                    "model": "nova-2",
                    "voice_id": "test_voice_id",
                    "speaker": "test_speaker",
                },
            },
            "promptData": {
                "name": "Test Character",
                "age": 25,
                "gender": "non-binary",
                "genderIdentity": "non-binary",
                "sexualOrientation": "pansexual",
                "currentLocation": "San Francisco",
                "profession": "Software Engineer",
                "context": "Test context",
                "characterProfileText": (
                    "Friendly, outgoing, warm and professional; "
                    "calm and ready; needs understanding and validation."
                ),
                "openingStatements": ["Hello!", "How are you today?"],
            },
            "events": [],
        },
    }


@pytest.fixture
def sample_room_metadata_json(sample_room_metadata) -> str:
    """JSON string version of sample room metadata."""
    return json.dumps(sample_room_metadata)


@pytest.fixture
def minimal_room_metadata() -> Dict[str, Any]:
    """Minimal room metadata for testing edge cases."""
    return {
        "scenario": {
            "title": "Minimal Scenario",
            "description": "Minimal test scenario",
            "promptData": {
                "name": "Minimal Character",
                "age": 30,
                "gender": "female",
                "currentLocation": "Test City",
                "context": "Minimal context",
                "lifeHistory": "Minimal history",
                "openingStatements": ["Hi there!"],
            },
            "voice": {"name": "test_voice", "provider": "deepgram", "config": {}},
        }
    }


@pytest.fixture
def invalid_json_metadata() -> str:
    """Invalid JSON string for testing error handling."""
    return '{"invalid": json, "missing": quotes}'


@pytest.fixture
def empty_metadata() -> str:
    """Empty metadata string."""
    return ""


@pytest.fixture
def null_metadata() -> None:
    """Null metadata for testing."""
    return None


# Mock fixtures
@pytest.fixture
def mock_logger():
    """Mock logger for testing."""
    with patch("app.core.agent.factory.logger") as mock_log:
        yield mock_log


@pytest.fixture
def mock_scenario_create():
    """Mock Scenario.create method."""
    with patch("app.core.scenario.base.Scenario.create") as mock_create:
        yield mock_create


@pytest.fixture
def mock_room_metadata_envelope_create():
    """Mock RoomMetadataEnvelope.create method."""
    with patch(
        "app.core.livekit.livekit_models.RoomMetadataEnvelope.create"
    ) as mock_create:
        yield mock_create


# Async fixtures
@pytest.fixture
async def async_mock_session():
    """Mock async database session."""
    session = AsyncMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    session.close = AsyncMock()
    return session


# Test utilities
@pytest.fixture
def assert_logs():
    """Utility fixture for asserting log calls."""

    def _assert_logs(mock_logger, level: str, message_contains: str):
        """Assert that a log was called with specific level and message content."""
        log_method = getattr(mock_logger, level)
        assert log_method.called
        call_args = log_method.call_args
        if call_args:
            args, kwargs = call_args
            if args:
                assert message_contains in str(args[0])

    return _assert_logs


# Parametrized fixtures for comprehensive testing
@pytest.fixture(params=[{"version": "1.0"}, {"version": "2.0"}, {}])  # No version
def version_variations(request):
    """Different version scenarios."""
    return request.param


@pytest.fixture(params=["deepgram", "elevenlabs", "openai", ""])  # Empty provider
def voice_provider_variations(request):
    """Different voice provider scenarios."""
    return request.param


# Factory fixtures
@pytest.fixture
def room_metadata_factory():
    """Factory for creating room metadata with variations."""

    def _create_metadata(**overrides):
        base = {
            "version": "1.0",
            "scenario": {
                "title": "Factory Scenario",
                "description": "Factory test scenario",
                "promptData": {
                    "name": "Factory Character",
                    "age": 28,
                    "gender": "male",
                    "currentLocation": "Factory City",
                    "context": "Factory context",
                    "lifeHistory": "Factory history",
                    "openingStatements": ["Factory greeting!"],
                },
            },
        }

        # Apply overrides recursively
        def deep_update(base_dict, update_dict):
            for key, value in update_dict.items():
                if isinstance(value, dict) and key in base_dict:
                    deep_update(base_dict[key], value)
                else:
                    base_dict[key] = value

        deep_update(base, overrides)
        return base

    return _create_metadata


# Performance testing fixtures
@pytest.fixture
def large_metadata():
    """Large metadata for performance testing."""
    return {
        "version": "1.0",
        "scenario": {
            "title": "Large Scenario",
            "description": "A" * 1000,  # Large description
            "promptData": {
                "name": "Large Character",
                "age": 35,
                "gender": "female",
                "currentLocation": "Large City",
                "context": "C" * 500,
                "lifeHistory": "D" * 1500,
                "openingStatements": [f"Statement {i}" for i in range(100)],
            },
            "voice": {
                "name": "test_voice",
                "provider": "deepgram",
                "config": {"model": "test-voice"},
            },
            "metadata": {f"key_{i}": f"value_{i}" for i in range(50)},
        },
    }


# Error simulation fixtures
@pytest.fixture
def exception_scenarios():
    """Different exception scenarios for testing."""
    return [
        (json.JSONDecodeError("Invalid JSON", "", 0), "json_decode_error"),
        (ValueError("Invalid value"), "value_error"),
        (KeyError("Missing key"), "key_error"),
        (Exception("Generic error"), "generic_error"),
    ]


@pytest.fixture
def ai_usage_calls(monkeypatch):
    """Capture every ``emit_ai_usage`` call as one dict (room_id + kwargs).

    Every emit helper (``emit_llm_usage``, ``emit_langchain_usage``,
    ``emit_openai_usage``, ``emit_embedding_usage``) funnels through
    ``emit_ai_usage`` by module-global lookup, so patching it here sees them
    all without touching SQS.
    """
    calls = []

    def _capture(room_id, **kwargs):
        calls.append({"room_id": room_id, **kwargs})

    monkeypatch.setattr("app.core.llm_usage.emitter.emit_ai_usage", _capture)
    return calls


@pytest.fixture
def graph_room(monkeypatch):
    """Run the test body as if inside a graph node for room ``graph-room``."""
    from app.core.graph import instrumentation

    token = instrumentation._room_id_var.set("graph-room")
    yield "graph-room"
    instrumentation._room_id_var.reset(token)


@pytest.fixture(autouse=True)
def _no_llm_usage_sqs(monkeypatch):
    """No test sends a real ``llm_usage`` message.

    Usage emission is fire-and-forget from inside the code under test, so any
    test exercising an instrumented call would otherwise schedule a real SQS
    send and leave it pending at loop close. Tests that assert on emissions use
    ``ai_usage_calls``; this only stubs the wire.
    """

    async def _noop_send(_body):
        return None

    monkeypatch.setattr("app.core.llm_usage.emitter._send", _noop_send)


@pytest.fixture(autouse=True)
def _no_clip_store(monkeypatch):
    """No test reads or writes the persistent clip store by accident.

    It is on whenever CLIP_STORE_BUCKET is set, and a developer's .env may set
    it for local v2v runs; tests that exercise the store turn it back on.
    """
    monkeypatch.setattr("app.core.config.settings.CLIP_STORE_BUCKET", "")
