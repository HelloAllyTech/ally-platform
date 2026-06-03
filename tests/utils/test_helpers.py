"""Test helper utilities."""

import json
from typing import Any, Dict, Optional
from unittest.mock import Mock, patch


class DataBuilder:
    """Builder pattern for creating test data."""

    def __init__(self):
        self.data = {}

    def with_version(self, version: str) -> "DataBuilder":
        """Add version to test data."""
        self.data["version"] = version
        return self

    def with_scenario(self, **scenario_data) -> "DataBuilder":
        """Add scenario data."""
        self.data["scenario"] = scenario_data
        return self

    def with_voice(self, name: str, provider: str, **config) -> "DataBuilder":
        """Add voice configuration."""
        if "scenario" not in self.data:
            self.data["scenario"] = {}

        self.data["scenario"]["voice"] = {
            "name": name,
            "provider": provider,
            "config": config,
        }
        return self

    def with_prompt_data(self, **prompt_data) -> "DataBuilder":
        """Add prompt data."""
        if "scenario" not in self.data:
            self.data["scenario"] = {}

        self.data["scenario"]["promptData"] = prompt_data
        return self

    def build(self) -> Dict[str, Any]:
        """Build the final test data."""
        return self.data.copy()

    def build_json(self) -> str:
        """Build as JSON string."""
        return json.dumps(self.build())


class MockLogger:
    """Mock logger for testing."""

    def __init__(self):
        self.debug_calls = []
        self.info_calls = []
        self.warning_calls = []
        self.error_calls = []
        self.exception_calls = []

    def debug(self, msg, *args):
        self.debug_calls.append((msg, args))

    def info(self, msg, *args):
        self.info_calls.append((msg, args))

    def warning(self, msg, *args):
        self.warning_calls.append((msg, args))

    def error(self, msg, *args):
        self.error_calls.append((msg, args))

    def exception(self, msg, *args):
        self.exception_calls.append((msg, args))

    def assert_debug_called_with(self, expected_msg: str):
        """Assert debug was called with specific message."""
        assert any(expected_msg in str(call[0]) for call in self.debug_calls)

    def assert_error_called_with(self, expected_msg: str):
        """Assert error was called with specific message."""
        assert any(expected_msg in str(call[0]) for call in self.error_calls)

    def assert_exception_called(self):
        """Assert exception was called."""
        assert len(self.exception_calls) > 0


def create_mock_scenario(name: str = "Test Scenario", **kwargs):
    """Create a mock scenario object."""
    mock_scenario = Mock()
    mock_scenario.name = name
    mock_scenario.events = kwargs.get("events", [])
    mock_scenario.metadata = kwargs.get("metadata", {})
    mock_scenario.voice = kwargs.get("voice", None)
    mock_scenario.prompt_data = kwargs.get("prompt_data", None)
    return mock_scenario


def create_mock_room_metadata_envelope(version: str = "1.0", scenario=None):
    """Create a mock RoomMetadataEnvelope."""
    mock_envelope = Mock()
    mock_envelope.version = version
    mock_envelope.scenario = scenario or create_mock_scenario()
    return mock_envelope


class AssertionHelpers:
    """Helper methods for common test assertions."""

    @staticmethod
    def assert_valid_room_metadata_envelope(
        envelope, expected_version: Optional[str] = None
    ):
        """Assert that an envelope is valid."""
        assert envelope is not None
        assert hasattr(envelope, "version")
        assert hasattr(envelope, "scenario")

        if expected_version:
            assert envelope.version == expected_version

    @staticmethod
    def assert_scenario_has_required_fields(scenario):
        """Assert scenario has all required fields."""
        required_fields = ["name"]
        for field in required_fields:
            assert hasattr(scenario, field)

    @staticmethod
    def assert_voice_config_valid(voice_config):
        """Assert voice configuration is valid."""
        assert hasattr(voice_config, "model")
        assert hasattr(voice_config, "voice_id")
        assert hasattr(voice_config, "speaker")

    @staticmethod
    def assert_prompt_data_valid(prompt_data):
        """Assert prompt data has required fields."""
        required_fields = [
            "name",
            "age",
            "gender",
            "current_location",
            "context",
            "character_profile_text",
            "opening_statements",
        ]
        for field in required_fields:
            assert hasattr(prompt_data, field)


def parametrize_json_scenarios():
    """Common parametrized scenarios for JSON testing."""
    return [
        ('{"valid": "json"}', True, "Valid JSON"),
        ('{"invalid": json}', False, "Invalid JSON - missing quotes"),
        ('{"incomplete":', False, "Incomplete JSON"),
        ("", True, "Empty string"),
        ("null", True, "Null JSON"),
        ("[]", True, "Empty array"),
        ("{}", True, "Empty object"),
    ]


def parametrize_metadata_scenarios():
    """Common parametrized scenarios for metadata testing."""
    return [
        ({"version": "1.0", "scenario": {"title": "Test"}}, "Full metadata"),
        ({"scenario": {"title": "Test"}}, "No version"),
        ({"version": "1.0"}, "No scenario"),
        ({}, "Empty metadata"),
    ]


class PerformanceTestHelpers:
    """Helpers for performance testing."""

    @staticmethod
    def create_large_metadata(size_multiplier: int = 1):
        """Create large metadata for performance testing."""
        return {
            "version": "1.0",
            "scenario": {
                "title": "Large Scenario" * size_multiplier,
                "description": "A" * (1000 * size_multiplier),
                "promptData": {
                    "name": "Large Character",
                    "age": 35,
                    "gender": "female",
                    "currentLocation": "Large City",
                    "context": "C" * (500 * size_multiplier),
                    "lifeHistory": "D" * (1500 * size_multiplier),
                    "openingStatements": [
                        f"Statement {i}" for i in range(100 * size_multiplier)
                    ],
                },
            },
        }

    @staticmethod
    def measure_execution_time(func, *args, **kwargs):
        """Measure function execution time."""
        import time

        start_time = time.time()
        result = func(*args, **kwargs)
        end_time = time.time()
        return result, end_time - start_time


def patch_logger(module_path: str):
    """Context manager for patching logger in a module."""
    return patch(f"{module_path}.logger", MockLogger())


def create_test_events(count: int = 3):
    """Create mock test events."""
    events = []
    for i in range(count):
        event = Mock()
        event.id = f"event_{i}"
        event.type = f"test_event_{i}"
        event.data = {"test": f"data_{i}"}
        events.append(event)
    return events
